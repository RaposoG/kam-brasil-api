//! Instalação e atualização do jogo a partir do manifesto da API.
//!
//! Uma release é uma árvore, não um arquivo. O launcher busca o manifesto,
//! compara com o que existe em disco e baixa apenas a diferença — instalação
//! nova e atualização passam pelo mesmo caminho. Como os mapas são a maior parte
//! do payload e quase nunca mudam, uma correção no executável vira poucos MB em
//! vez de meio giga.
//!
//! A release traz a árvore **inteira** -- sprites, sons e músicas inclusive.
//! Nada é derivado na máquina do jogador, e nada exige o Knights and Merchants
//! original: o que sai daqui já está pronto para abrir.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, State};
use tokio::io::AsyncWriteExt;
use tokio::sync::Semaphore;
use tokio::task::JoinSet;

use crate::auth::AppState;

pub const VERSION_FILE: &str = "kambrasil.json";

/// O arquivo que decide se a instalacao esta mesmo completa.
///
/// Escolhido por mudar em toda release e por ser o que o jogador vai abrir: se
/// ele esta velho, nada mais importa.
const EXE_SENTINELA: &str = "KaM_Remake.exe";

/// O que a conferencia do executavel concluiu.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Sentinela {
    Igual,
    Divergente,
    /// Release antiga, empacotada antes de o executavel ter este nome.
    AusenteNoManifesto,
    /// Manifesto inacessivel -- sem internet, ou API fora do ar.
    NaoConferida,
}

impl Sentinela {
    fn rotulo(self) -> &'static str {
        match self {
            Sentinela::Igual => "igual",
            Sentinela::Divergente => "divergente",
            Sentinela::AusenteNoManifesto => "ausente no manifesto",
            Sentinela::NaoConferida => "nao conferida",
        }
    }
}

/// Precisa baixar?
///
/// Versao diferente decide sozinha. Versao igual so passa se o executavel
/// tambem passar -- e a conferencia que faltava quando um jogo parado na 1.0.4
/// se apresentou como 1.3.0 pronto para jogar.
///
/// Nao conseguir conferir NAO reprova: quem esta sem internet nao deve ser
/// mandado a reinstalar 839 MB que provavelmente ja tem.
pub fn precisa_atualizar(instalada: Option<&str>, ultima: &str, sentinela: Sentinela) -> bool {
    if instalada != Some(ultima) {
        return true;
    }
    sentinela == Sentinela::Divergente
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ManifestFile {
    pub path: String,
    pub size: u64,
    pub sha256: String,
}

/// A árvore inteira num arquivo só, para instalação do zero.
#[derive(Debug, Clone, Deserialize)]
pub struct ManifestZip {
    pub name: String,
    pub size: u64,
    pub sha256: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Manifest {
    pub version: String,
    #[serde(rename = "gameRevision")]
    pub game_revision: String,
    /// Ausente em releases publicadas antes do zip existir.
    #[serde(default)]
    pub zip: Option<ManifestZip>,
    pub files: Vec<ManifestFile>,
}

/// `GET /client/latest`
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct LatestRelease {
    pub version: String,
    #[serde(rename = "gameRevision")]
    pub game_revision: String,
    #[serde(rename = "manifestUrl")]
    pub manifest_url: String,
    #[serde(rename = "baseUrl")]
    pub base_url: String,
    #[serde(rename = "totalBytes")]
    pub total_bytes: u64,
    #[serde(rename = "fileCount")]
    pub file_count: u32,
    pub notes: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct InstalledInfo {
    pub version: String,
}

/// Progresso emitido como evento `install-progress`.
#[derive(Clone, Serialize)]
pub struct Progress {
    /// `verificando` | `baixando` | `extraindo` | `pronto`
    pub phase: String,
    pub current_file: String,
    pub files_done: u32,
    pub files_total: u32,
    pub bytes_done: u64,
    pub bytes_total: u64,
    pub bytes_per_second: u64,
}

/// Onde o jogo é instalado: `%LOCALAPPDATA%\KamBrasil\game`.
///
/// Não é Arquivos de Programas de propósito. Escrever lá exige elevação, e um
/// launcher que precisa de UAC a cada atualização não atualiza sozinho.
pub fn game_dir() -> PathBuf {
    if let Ok(dir) = std::env::var("KAMBRASIL_GAME_DIR") {
        return PathBuf::from(dir);
    }
    dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("KamBrasil")
        .join("game")
}

pub fn read_installed(dir: &Path) -> Option<InstalledInfo> {
    let raw = std::fs::read_to_string(dir.join(VERSION_FILE)).ok()?;
    serde_json::from_str(&raw).ok()
}

fn sha256_of(path: &Path) -> Option<String> {
    let bytes = std::fs::read(path).ok()?;
    Some(format!("{:x}", Sha256::digest(&bytes)))
}

/// Este arquivo do manifesto ainda não está no disco como o manifesto o descreve?
///
/// Tamanho diferente já reprova sem ler o arquivo inteiro — é o caso comum e
/// evita hashear centenas de MB à toa. Só quando o tamanho bate é que o sha256
/// decide, porque tamanho igual com conteúdo diferente existe.
pub(crate) fn precisa_baixar(dir: &Path, f: &ManifestFile) -> bool {
    let local = dir.join(f.path.replace('/', std::path::MAIN_SEPARATOR_STR));
    match std::fs::metadata(&local) {
        Ok(meta) if meta.len() == f.size => sha256_of(&local).as_deref() != Some(&f.sha256),
        _ => true,
    }
}

/// Decide o que precisa ser baixado.
///
/// `on_checked` recebe quantos já foram conferidos. Numa instalação existente
/// isso lê e hasheia centenas de MB e leva dezenas de segundos — sem avisar, a
/// tela fica parada e parece travada.
pub fn files_to_download(
    dir: &Path,
    manifest: &Manifest,
    mut on_checked: impl FnMut(u32),
) -> Vec<ManifestFile> {
    let mut pending = Vec::new();

    for (index, f) in manifest.files.iter().enumerate() {
        if precisa_baixar(dir, f) {
            pending.push(f.clone());
        }

        // A cada 50 para nao inundar a webview de eventos.
        if index % 50 == 0 {
            on_checked(index as u32);
        }
    }

    on_checked(manifest.files.len() as u32);
    pending
}

async fn fetch_manifest(url: &str) -> Result<Manifest, String> {
    let response = reqwest::Client::new()
        .get(url)
        .send()
        .await
        .map_err(|e| format!("não foi possível buscar o manifesto: {e}"))?;

    if !response.status().is_success() {
        return Err(format!("a API respondeu {} ao buscar o manifesto", response.status()));
    }

    response
        .json()
        .await
        .map_err(|e| format!("manifesto inesperado: {e}"))
}

/// `GET /client/latest`. `None` quando a API ainda não publicou versão nenhuma
/// (404) — que é estado normal, não erro.
async fn latest_release(api_base: &str) -> Result<Option<LatestRelease>, String> {
    let response = reqwest::Client::new()
        .get(format!("{api_base}/client/latest"))
        .send()
        .await
        .map_err(|e| format!("não foi possível consultar a versão: {e}"))?;

    if response.status().as_u16() == 404 {
        return Ok(None);
    }
    if !response.status().is_success() {
        return Err(format!("a API respondeu {} ao consultar a versão", response.status()));
    }

    response
        .json()
        .await
        .map(Some)
        .map_err(|e| format!("resposta inesperada da API: {e}"))
}

#[tauri::command]
pub async fn check_update(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let dir = game_dir();
    let installed = read_installed(&dir).map(|i| i.version);

    let Some(latest) = latest_release(&state.api_base()).await? else {
        return Ok(serde_json::json!({
            "path": dir.display().to_string(),
            "installedVersion": installed,
            "latest": null,
            "needsUpdate": false,
        }));
    };

    // A versao gravada em disco diz o que a ULTIMA instalacao ACHOU que fez.
    // Nao basta.
    //
    // Aconteceu de verdade: instalacao interrompida perto do fim, o marcador
    // ficou na versao antiga -- e ate ai tudo bem, porque `installed != latest`
    // pediria a atualizacao. O que nao pode acontecer e o contrario: o marcador
    // dizer que esta tudo certo enquanto os arquivos nao estao.
    //
    // Por isso conferimos uma SENTINELA: o executavel do jogo. Ele muda a cada
    // release e e o arquivo que mais importa -- se ele diverge do manifesto, a
    // instalacao nao esta completa, diga o marcador o que disser. Um hash de
    // 10 MB custa milissegundos; hashear os 839 MB no boot custaria minutos.
    let mut sentinela = Sentinela::Igual;

    if installed.as_deref() == Some(latest.version.as_str()) {
        sentinela = match fetch_manifest(&latest.manifest_url).await {
            Ok(manifest) => match manifest.files.iter().find(|f| f.path == EXE_SENTINELA) {
                Some(exe) if precisa_baixar(&dir, exe) => Sentinela::Divergente,
                Some(_) => Sentinela::Igual,
                None => Sentinela::AusenteNoManifesto,
            },
            // Manifesto fora do ar nao e motivo para mandar reinstalar: fica com
            // o que o marcador diz, e a tela avisa que nao deu para conferir.
            Err(_) => Sentinela::NaoConferida,
        };
    }

    let needs_update = precisa_atualizar(installed.as_deref(), &latest.version, sentinela);

    Ok(serde_json::json!({
        "path": dir.display().to_string(),
        "installedVersion": installed,
        "latest": latest,
        "needsUpdate": needs_update,
        "sentinela": sentinela.rotulo(),
    }))
}

/// O jogo só enxerga um mapa quando a pasta tem o par `<nome>.dat` +
/// `<nome>.map` — é o que o próprio scanner dele exige
/// (`KM_Maps.pas:804`), e é desse par que sai o CRC que o servidor ranqueado
/// compara com o da reserva.
///
/// Por isso a conferência é pelo par, não pela pasta: uma pasta pela metade é
/// **pior** que pasta nenhuma. O jogo entra na sala sem o mapa, tenta baixá-lo
/// do host — e numa sala ranqueada o servidor impõe o setup e recusa o repasse
/// do host, então a barra fica em 0 kb para sempre e ninguém consegue sair
/// disso. Foi exatamente o que travou o teste ao vivo.
pub fn mapa_completo(dir: &Path, nome: &str) -> bool {
    let pasta = dir.join("MapsMP").join(nome);
    pasta.join(format!("{nome}.dat")).is_file() && pasta.join(format!("{nome}.map")).is_file()
}

/// Os arquivos da release que pertencem a `MapsMP/<nome>/`.
fn arquivos_do_mapa(manifest: &Manifest, nome: &str) -> Vec<ManifestFile> {
    // A barra no fim não é detalhe: sem ela "Arena" arrastaria junto os
    // arquivos de "Arena 2" — os dois existem em MapsMP/.
    //
    // Comparação sem caixa porque os dois lados vêm de fontes diferentes: o
    // nome sai da temporada na API, o caminho sai da árvore de arquivos.
    let prefixo = format!("mapsmp/{}/", nome.to_lowercase());
    manifest
        .files
        .iter()
        .filter(|f| f.path.to_lowercase().starts_with(&prefixo))
        .cloned()
        .collect()
}

/// Conferência instantânea, sem rede: o mapa da partida está no disco?
#[tauri::command]
pub fn map_ready(nome: String) -> bool {
    mapa_completo(&game_dir(), nome.trim())
}

/// Baixa **só** a pasta desse mapa — primeiro do catálogo global, depois da
/// release.
///
/// A ordem importa: o catálogo é o que o admin curou e o que a ranqueada sorteia,
/// e um mapa novo entra nele antes de entrar em qualquer release. Só quando o
/// mapa não está no catálogo é que a release responde — é o caso dos 211 mapas
/// que vieram dentro do jogo.
///
/// Reaproveita a mesma maquinaria da instalação: `precisa_baixar` decide o que
/// falta pelo sha256 e `download_one` baixa com verificação e troca atômica.
#[tauri::command]
pub async fn download_map(state: State<'_, AppState>, nome: String) -> Result<(), String> {
    let nome = nome.trim().to_string();
    let dir = game_dir();

    // Falha de rede aqui não pode fechar a porta da release: o mapa da partida
    // pode estar nas duas, e o jogador está esperando para entrar num lobby.
    match crate::mapas::baixar_do_catalogo(&state.api_base(), &nome).await {
        Ok(true) => return Ok(()),
        Ok(false) => {}
        Err(e) => eprintln!("aviso: catálogo de mapas indisponível ({e}); tentando pela release"),
    }

    let release = latest_release(&state.api_base())
        .await?
        .ok_or("a API não tem nenhuma versão do jogo publicada")?;
    let manifest = fetch_manifest(&release.manifest_url).await?;

    let mut so_o_mapa = manifest.clone();
    so_o_mapa.files = arquivos_do_mapa(&manifest, &nome);

    // Mapa de temporada que não está no catálogo nem entrou numa release:
    // baixar é impossível, e o jogador precisa saber disso em vez de ficar
    // olhando um download.
    if so_o_mapa.files.is_empty() {
        return Err(format!(
            "o mapa \"{nome}\" não está no catálogo nem na versão {} do jogo. Avise a organização da temporada — não há o que baixar.",
            release.version
        ));
    }

    let client = reqwest::Client::new();
    let bytes = AtomicU64::new(0);

    // ponytail: sequencial. Um mapa é ~10 arquivos (~270 KB), uns 10 s; o pior
    // caso real é "CiW 2x2", com 122 arquivos, perto de 2 min. Se incomodar,
    // o Semaphore + JoinSet de `install_update` logo abaixo já resolve.
    for file in files_to_download(&dir, &so_o_mapa, |_| {}) {
        download_one(&client, &release.base_url, &dir, &file, &bytes).await?;
    }

    // A release podia ter a pasta sem o par que o jogo exige. Devolver Ok aqui
    // faria a tela abrir o jogo achando que estava tudo certo.
    if !mapa_completo(&dir, &nome) {
        return Err(format!(
            "o mapa \"{nome}\" foi baixado incompleto (falta o .dat ou o .map). Reinstale o jogo pelas Configurações."
        ));
    }

    Ok(())
}

/// Quantos arquivos baixar ao mesmo tempo.
///
/// A release tem 8447 arquivos e **79% deles não chegam a 10 KB**. Baixados um
/// de cada vez, com ~250 ms de ida-e-volta por requisição, seriam ~35 minutos
/// gastos em latência — a banda fica ociosa o tempo todo, esperando resposta.
///
/// 16 é um meio-termo: derruba o tempo em uma ordem de grandeza sem transformar
/// a instalação de um jogador num teste de carga contra a nossa API. Medido em
/// ~6 MB/s com 12; o gargalo aqui é latência, não banda, então subir o número
/// ajuda até o ponto em que a VPS começa a reclamar — não além.
const CONCURRENCY: usize = 16;

/// A partir de quantos arquivos faltando vale baixar o zip em vez de um a um.
///
/// O custo aqui é por requisição, não por byte: as extensões do KaM não estão na
/// lista de cacheáveis do Cloudflare, então cada arquivo vai até o VPS a ~1s de
/// ida e volta. Medido: 7 arquivos/s. Instalar do zero levava ~20 minutos.
///
/// Acima deste número, um zip de ~400 MB numa requisição só ganha de longe.
/// Abaixo, não: atualizar da 1.0.1 para a 1.0.2 são 2 arquivos e 23 MB — baixar
/// o zip inteiro para trocar dois executáveis seria trocar 20 minutos por 30
/// segundos desnecessários.
const ZIP_THRESHOLD: usize = 500;

/// Baixa o zip da release, confere o sha256 e extrai por cima da pasta do jogo.
///
/// Grava em `.kbzip` e só extrai depois de conferir o hash: um zip truncado
/// extrairia meia release e o jogo abriria quebrado.
async fn install_from_zip(
    app: &AppHandle,
    client: &reqwest::Client,
    manifest_url: &str,
    dir: &Path,
    zip: &ManifestZip,
) -> Result<(), String> {
    let url = manifest_url
        .rsplit_once('/')
        .map(|(base, _)| format!("{base}/{}", zip.name))
        .ok_or("URL do manifesto inesperada")?;

    let temp = dir.join(".kambrasil-download.kbzip");
    let mut response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("não foi possível baixar o pacote: {e}"))?;

    if !response.status().is_success() {
        return Err(format!("servidor respondeu {} ao baixar o pacote", response.status()));
    }

    let mut out = tokio::fs::File::create(&temp)
        .await
        .map_err(|e| format!("não foi possível gravar o pacote: {e}"))?;

    let mut hasher = Sha256::new();
    let mut done: u64 = 0;
    let started = std::time::Instant::now();
    let mut last_emit = std::time::Instant::now();

    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| format!("download do pacote interrompido: {e}"))?
    {
        hasher.update(&chunk);
        done += chunk.len() as u64;
        out.write_all(&chunk)
            .await
            .map_err(|e| format!("erro ao gravar o pacote: {e}"))?;

        if last_emit.elapsed() >= std::time::Duration::from_millis(200) {
            last_emit = std::time::Instant::now();
            let secs = started.elapsed().as_secs_f64().max(0.001);
            let _ = app.emit(
                "install-progress",
                Progress {
                    phase: "baixando".into(),
                    current_file: String::new(),
                    files_done: 0,
                    files_total: 0,
                    bytes_done: done,
                    bytes_total: zip.size,
                    bytes_per_second: (done as f64 / secs) as u64,
                },
            );
        }
    }

    out.flush().await.map_err(|e| format!("erro ao finalizar o pacote: {e}"))?;
    drop(out);

    if format!("{:x}", hasher.finalize()) != zip.sha256.to_lowercase() {
        let _ = tokio::fs::remove_file(&temp).await;
        return Err("o pacote baixado não confere com o manifesto".into());
    }

    // Extrair é CPU e disco: fora da thread do runtime, senão a janela congela.
    let dir_owned = dir.to_path_buf();
    let temp_owned = temp.clone();
    let app_owned = app.clone();
    tokio::task::spawn_blocking(move || extract_zip(&app_owned, &temp_owned, &dir_owned))
        .await
        .map_err(|e| format!("falha ao extrair o pacote: {e}"))??;

    let _ = tokio::fs::remove_file(&temp).await;
    Ok(())
}

fn extract_zip(app: &AppHandle, zip_path: &Path, dir: &Path) -> Result<(), String> {
    extract_zip_to(zip_path, dir, |done, total| {
        let _ = app.emit(
            "install-progress",
            Progress {
                phase: "extraindo".into(),
                current_file: String::new(),
                files_done: done,
                files_total: total,
                bytes_done: 0,
                bytes_total: 0,
                bytes_per_second: 0,
            },
        );
    })
}

/// Extrai o zip por cima de `dir`.
///
/// Separado do `AppHandle` para poder ser testado: montar um Tauri num teste
/// unitário não vale o trabalho, e o que precisa de teste é o tratamento de
/// caminho, não a emissão de evento.
fn extract_zip_to(
    zip_path: &Path,
    dir: &Path,
    mut on_progress: impl FnMut(u32, u32),
) -> Result<(), String> {
    let file = std::fs::File::open(zip_path).map_err(|e| format!("não foi possível abrir o pacote: {e}"))?;
    let mut archive =
        zip::ZipArchive::new(file).map_err(|e| format!("pacote ilegível: {e}"))?;

    let total = archive.len() as u32;

    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| format!("entrada {i} ilegível no pacote: {e}"))?;

        // enclosed_name descarta caminhos com ".." ou raiz absoluta -- e o que
        // impede um zip malicioso de escrever fora da pasta do jogo.
        let Some(rel) = entry.enclosed_name() else {
            return Err(format!("pacote com caminho suspeito: {}", entry.name()));
        };
        let dest = dir.join(rel);

        if entry.is_dir() {
            std::fs::create_dir_all(&dest).map_err(|e| e.to_string())?;
            continue;
        }
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }

        let mut out = std::fs::File::create(&dest)
            .map_err(|e| format!("não foi possível gravar {}: {e}", dest.display()))?;
        std::io::copy(&mut entry, &mut out)
            .map_err(|e| format!("erro ao extrair {}: {e}", dest.display()))?;

        if i % 200 == 0 {
            on_progress(i as u32, total);
        }
    }

    Ok(())
}

/// Baixa um arquivo, confere o sha256 e o instala.
///
/// Grava em `.kbpart` e só então renomeia: uma queda no meio não deixa um
/// arquivo truncado passando por bom na verificação seguinte.
pub(crate) async fn download_one(
    client: &reqwest::Client,
    base_url: &str,
    dir: &Path,
    file: &ManifestFile,
    bytes_done: &AtomicU64,
) -> Result<(), String> {
    let dest = dir.join(file.path.replace('/', std::path::MAIN_SEPARATOR_STR));
    if let Some(parent) = dest.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("não foi possível criar {}: {e}", parent.display()))?;
    }

    let url = format!("{}/{}", base_url.trim_end_matches('/'), file.path);
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("falha ao baixar {}: {e}", file.path))?;

    if !response.status().is_success() {
        return Err(format!("servidor respondeu {} ao baixar {}", response.status(), file.path));
    }

    // APPEND, nao with_extension: aquele SUBSTITUI a extensao, e numa pasta de
    // campanha "AED01.dat", "AED01.map" e "AED01.script" virariam todos
    // "AED01.kbpart". Sequencialmente nunca colidia, porque cada um era
    // renomeado antes do proximo; com downloads concorrentes, duas tarefas
    // gravam no mesmo arquivo ao mesmo tempo.
    let temp = {
        let mut p = dest.clone().into_os_string();
        p.push(".kbpart");
        PathBuf::from(p)
    };

    let mut out = tokio::fs::File::create(&temp)
        .await
        .map_err(|e| format!("não foi possível gravar {}: {e}", file.path))?;

    let mut hasher = Sha256::new();
    let mut stream = response;

    while let Some(chunk) = stream
        .chunk()
        .await
        .map_err(|e| format!("download de {} interrompido: {e}", file.path))?
    {
        hasher.update(&chunk);
        bytes_done.fetch_add(chunk.len() as u64, Ordering::Relaxed);
        out.write_all(&chunk)
            .await
            .map_err(|e| format!("erro ao gravar {}: {e}", file.path))?;
    }

    out.flush().await.map_err(|e| format!("erro ao finalizar {}: {e}", file.path))?;
    drop(out);

    if format!("{:x}", hasher.finalize()) != file.sha256.to_lowercase() {
        let _ = tokio::fs::remove_file(&temp).await;
        return Err(format!("{} não confere com o manifesto", file.path));
    }

    tokio::fs::rename(&temp, &dest)
        .await
        .map_err(|e| format!("não foi possível instalar {}: {e}", file.path))?;

    Ok(())
}

/// Baixa uma lista de arquivos em paralelo e devolve quantos bytes vieram da rede.
///
/// O progresso sai em `evento` — `install-progress` para a instalação do jogo,
/// `mapas-progress` para a sincronia do catálogo. São duas barras diferentes na
/// tela, e misturá-las faria a sincronia de mapas aparecer como se o jogo
/// estivesse sendo reinstalado.
pub(crate) async fn baixar_em_paralelo(
    app: &AppHandle,
    client: &reqwest::Client,
    base_url: &str,
    dir: &Path,
    pending: Vec<ManifestFile>,
    evento: &'static str,
) -> Result<u64, String> {
    let bytes_total: u64 = pending.iter().map(|f| f.size).sum();
    let files_total = pending.len() as u32;
    let started = std::time::Instant::now();
    let bytes_done = Arc::new(AtomicU64::new(0));
    let files_done = Arc::new(AtomicU32::new(0));

    // Progresso sai de um relógio próprio, não de dentro dos downloads. Com 12
    // tarefas concorrentes, emitir por chunk inundaria a webview com milhares
    // de eventos por segundo para atualizar uma barra.
    let ticker = {
        let app = app.clone();
        let bytes_done = bytes_done.clone();
        let files_done = files_done.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(std::time::Duration::from_millis(200));
            loop {
                interval.tick().await;
                let done = bytes_done.load(Ordering::Relaxed);
                let secs = started.elapsed().as_secs_f64().max(0.001);
                let _ = app.emit(
                    evento,
                    Progress {
                        phase: "baixando".into(),
                        current_file: String::new(),
                        files_done: files_done.load(Ordering::Relaxed),
                        files_total,
                        bytes_done: done,
                        bytes_total,
                        bytes_per_second: (done as f64 / secs) as u64,
                    },
                );
            }
        })
    };

    let semaphore = Arc::new(Semaphore::new(CONCURRENCY));
    let mut tasks = JoinSet::new();

    for file in pending {
        let permit = semaphore.clone();
        let client = client.clone();
        let base_url = base_url.to_string();
        let dir = dir.to_path_buf();
        let bytes_done = bytes_done.clone();
        let files_done = files_done.clone();

        tasks.spawn(async move {
            let _permit = permit.acquire().await.map_err(|e| e.to_string())?;
            download_one(&client, &base_url, &dir, &file, &bytes_done).await?;
            files_done.fetch_add(1, Ordering::Relaxed);
            Ok::<(), String>(())
        });
    }

    // Primeiro erro aborta o resto: insistir depois de uma falha so faria o
    // jogador esperar mais para receber a mesma mensagem.
    //
    // O PRIMEIRO erro e que vale. Depois do abort_all as demais tarefas
    // retornam "cancelada", e sobrescrever com elas trocaria a causa real por
    // ruido -- o jogador leria "tarefa cancelada" sem saber o que houve.
    let mut failure: Option<String> = None;
    while let Some(joined) = tasks.join_next().await {
        let result = match joined {
            Ok(inner) => inner,
            // Cancelamento e consequencia do nosso proprio abort_all.
            Err(e) if e.is_cancelled() => continue,
            Err(e) => Err(format!("tarefa de download falhou: {e}")),
        };

        if let Err(e) = result {
            if failure.is_none() {
                failure = Some(e);
                tasks.abort_all();
            }
        }
    }

    ticker.abort();

    match failure {
        Some(error) => Err(error),
        None => Ok(bytes_done.load(Ordering::Relaxed)),
    }
}

/// Pastas onde o JOGADOR põe coisa dele. A poda nunca entra aqui.
///
/// A regra é listar o que não se toca, e não o que se apaga: uma lista de
/// "apagar" esquecida cresce sozinha com a próxima release e come dado alheio.
/// Aqui, esquecer uma pasta significa deixar lixo — que é o erro barato.
///
/// As de mapa entram porque o jogador acrescenta mapa lá, e porque o catálogo
/// global também instala em `MapsMP/` com registro próprio (ver `mapas.rs`).
/// Duas coisas podando a mesma pasta com regras diferentes é como se apaga o
/// acervo de alguém sem ninguém ter decidido isso.
const NUNCA_PODAR: &[&str] = &[
    "saves/",
    "savesmp/",
    "savescmp/",
    "logs/",
    "replays/",
    "maps/",
    "mapsmp/",
    "mapsdl/",
    "campaigns/",
    "tutorials/",
];

/// Arquivos soltos na raiz que são do jogador ou nossos — nunca da release.
///
/// `KaM Remake Settings.xml` guarda nickname, resolução e volume: apagá-lo
/// zeraria a configuração de quem só queria atualizar o jogo.
const NUNCA_PODAR_ARQUIVO: &[&str] = &[
    "kam remake settings.xml",
    "kam remake server settings.ini",
    "kmr_dev.xml",
    "kambrasil.json",
];

fn protegido(rel: &str) -> bool {
    let baixo = rel.to_ascii_lowercase();
    NUNCA_PODAR.iter().any(|p| baixo.starts_with(p)) || NUNCA_PODAR_ARQUIVO.contains(&baixo.as_str())
}

/// Apaga o que a release não tem mais.
///
/// Existe por um caso concreto: enquanto os sprites e os sons eram gerados na
/// máquina do jogador, o launcher criava `data/sfx/speech/` — 118 MB de `.snd`
/// que o jogo não lê. Agora tudo vem pronto na release, aquela pasta ficou
/// órfã, e ninguém a limparia nunca.
///
/// Só apaga arquivo que (a) não está no manifesto e (b) não está sob nada
/// protegido. Falha em apagar não interrompe nada: arquivo travado pelo
/// antivírus ou sem permissão é motivo para deixar lixo, nunca para quebrar uma
/// instalação que deu certo.
fn podar_orfaos(dir: &Path, manifest: &Manifest) -> u32 {
    let esperados: std::collections::HashSet<String> = manifest
        .files
        .iter()
        .map(|f| f.path.to_ascii_lowercase())
        .collect();

    let mut apagados = 0;
    let mut pastas: Vec<PathBuf> = Vec::new();
    let mut fila = vec![dir.to_path_buf()];

    while let Some(atual) = fila.pop() {
        let Ok(entradas) = std::fs::read_dir(&atual) else { continue };
        for entrada in entradas.flatten() {
            let caminho = entrada.path();
            let Ok(rel) = caminho.strip_prefix(dir) else { continue };
            let Some(rel) = rel.to_str() else { continue };
            // Vem do sistema de arquivos: no Windows chega com barra invertida,
            // e o manifesto usa barra normal.
            let rel = rel.replace(std::path::MAIN_SEPARATOR, "/");

            if caminho.is_dir() {
                // Barra no fim para `saves/` não casar com `savesomething/`.
                if protegido(&format!("{rel}/")) {
                    continue;
                }
                pastas.push(caminho.clone());
                fila.push(caminho);
            } else if !esperados.contains(&rel.to_ascii_lowercase()) && !protegido(&rel) {
                if std::fs::remove_file(&caminho).is_ok() {
                    apagados += 1;
                }
            }
        }
    }

    // Pasta que ficou vazia some junto. `remove_dir` se recusa a apagar pasta
    // com conteúdo, e é essa recusa que preserva o que sobrou lá dentro.
    // De trás para frente: a mais funda primeiro, senão a de cima nunca esvazia.
    pastas.sort();
    for pasta in pastas.into_iter().rev() {
        let _ = std::fs::remove_dir(&pasta);
    }

    apagados
}

/// Baixa tudo que falta e grava a versão instalada.
#[tauri::command]
pub async fn install_update(app: AppHandle, release: LatestRelease) -> Result<(), String> {
    let dir = game_dir();
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|e| format!("não foi possível criar {}: {e}", dir.display()))?;

    let emit = |p: Progress| {
        let _ = app.emit("install-progress", p);
    };

    emit(Progress {
        phase: "verificando".into(),
        current_file: String::new(),
        files_done: 0,
        files_total: release.file_count,
        bytes_done: 0,
        bytes_total: release.total_bytes,
        bytes_per_second: 0,
    });

    let manifest = fetch_manifest(&release.manifest_url).await?;

    // Comparar é I/O pesado; sai da thread do runtime para não travar a janela.
    let mut pending = {
        let dir = dir.clone();
        let manifest = manifest.clone();
        let app = app.clone();
        let files_total = manifest.files.len() as u32;
        tokio::task::spawn_blocking(move || {
            files_to_download(&dir, &manifest, |checked| {
                let _ = app.emit(
                    "install-progress",
                    Progress {
                        phase: "verificando".into(),
                        current_file: String::new(),
                        files_done: checked,
                        files_total,
                        bytes_done: 0,
                        bytes_total: 0,
                        bytes_per_second: 0,
                    },
                );
            })
        })
        .await
        .map_err(|e| format!("falha ao comparar arquivos: {e}"))?
    };

    let client = reqwest::Client::new();

    // Muita coisa faltando = instalação do zero. Uma requisição em vez de
    // milhares, e depois a conferência normal valida o que chegou.
    if pending.len() >= ZIP_THRESHOLD {
        if let Some(zip) = manifest.zip.clone() {
            install_from_zip(&app, &client, &release.manifest_url, &dir, &zip).await?;

            // Confere o que foi extraído. Se algo faltar, o caminho normal
            // abaixo cobre a diferença -- que a essa altura são poucos arquivos.
            let dir2 = dir.clone();
            let manifest2 = manifest.clone();
            pending = tokio::task::spawn_blocking(move || files_to_download(&dir2, &manifest2, |_| {}))
                .await
                .map_err(|e| format!("falha ao conferir o pacote extraído: {e}"))?;
        }
    }

    let files_total = pending.len() as u32;
    let bytes_total: u64 = pending.iter().map(|f| f.size).sum();
    let bytes_done =
        baixar_em_paralelo(&app, &client, &release.base_url, &dir, pending, "install-progress").await?;

    // Depois de baixar, e só depois: uma poda antes do download apagaria
    // arquivo que a release ainda vai repor, e uma interrupção no meio deixaria
    // a instalação pior do que estava.
    //
    // Roda em `spawn_blocking` porque varre o disco inteiro da instalação, e
    // segurar o executor assíncrono nisso trava o progresso da tela.
    let dir_poda = dir.clone();
    let manifest_poda = manifest.clone();
    let apagados = tokio::task::spawn_blocking(move || podar_orfaos(&dir_poda, &manifest_poda))
        .await
        .unwrap_or(0);
    if apagados > 0 {
        eprintln!("poda: {apagados} arquivo(s) que a release não tem mais");
    }

    let info = InstalledInfo { version: manifest.version.clone() };
    tokio::fs::write(
        dir.join(VERSION_FILE),
        serde_json::to_vec_pretty(&info).map_err(|e| e.to_string())?,
    )
    .await
    .map_err(|e| format!("não foi possível registrar a versão instalada: {e}"))?;

    emit(Progress {
        phase: "pronto".into(),
        current_file: String::new(),
        files_done: files_total,
        files_total,
        bytes_done,
        bytes_total,
        bytes_per_second: 0,
    });

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    pub(super) fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("kambrasil-inst-{name}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    pub(super) fn manifest_of(files: &[(&str, &str)]) -> Manifest {
        Manifest {
            version: "1.0.0".into(),
            game_revision: "r16155".into(),
            zip: None,
            files: files
                .iter()
                .map(|(path, content)| ManifestFile {
                    path: (*path).into(),
                    size: content.len() as u64,
                    sha256: format!("{:x}", Sha256::digest(content.as_bytes())),
                })
                .collect(),
        }
    }

    /// with_extension substituiria a extensao, fazendo "AED01.dat" e
    /// "AED01.map" -- vizinhos reais numa pasta de campanha -- disputarem o
    /// mesmo arquivo temporario quando baixados em paralelo.
    #[test]
    fn temporarios_de_vizinhos_nao_colidem() {
        let dir = PathBuf::from("Campaigns").join("AED");
        let temp_of = |name: &str| {
            let mut p = dir.join(name).into_os_string();
            p.push(".kbpart");
            PathBuf::from(p)
        };

        assert_ne!(temp_of("AED01.dat"), temp_of("AED01.map"));
        assert_ne!(temp_of("AED01.dat"), temp_of("AED01.script"));
        assert!(temp_of("AED01.dat").to_string_lossy().ends_with("AED01.dat.kbpart"));
    }

    fn zip_com(entradas: &[(&str, &str)], destino: &Path) {
        use std::io::Write;
        let f = std::fs::File::create(destino).unwrap();
        let mut w = zip::ZipWriter::new(f);
        for (nome, conteudo) in entradas {
            w.start_file::<_, ()>(*nome, zip::write::SimpleFileOptions::default()).unwrap();
            w.write_all(conteudo.as_bytes()).unwrap();
        }
        w.finish().unwrap();
    }

    /// O zip da API sai de `zip -r -q -1 out.zip .`, entao as entradas podem vir
    /// com "./" na frente. Se isso virasse uma pasta chamada ".", o jogo seria
    /// instalado no lugar errado e a conferencia seguinte rebaixaria tudo -- o
    /// problema que o zip existe para resolver.
    #[test]
    fn extrai_normalizando_o_prefixo_de_diretorio_atual() {
        let dir = temp_dir("zip-prefixo");
        let z = dir.join("pacote.zip");
        zip_com(
            &[("./KaM_Remake.exe", "exe"), ("./data/text/a.libx", "texto"), ("bass.dll", "dll")],
            &z,
        );

        let saida = dir.join("jogo");
        extract_zip_to(&z, &saida, |_, _| {}).unwrap();

        assert!(saida.join("KaM_Remake.exe").is_file(), "deveria estar na raiz");
        assert!(saida.join("data").join("text").join("a.libx").is_file());
        assert!(saida.join("bass.dll").is_file());
        assert!(!saida.join(".").join("KaM_Remake.exe").exists() || saida.join("KaM_Remake.exe").is_file());

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Um zip com "../" no caminho escreveria fora da pasta do jogo. Quem
    /// impede e o enclosed_name(); trocar por entry.name() quebraria isto.
    #[test]
    fn zip_com_caminho_de_escape_e_recusado() {
        let dir = temp_dir("zip-escape");
        let z = dir.join("malicioso.zip");
        zip_com(&[("../../fora.txt", "nao deveria sair")], &z);

        let saida = dir.join("jogo");
        let r = extract_zip_to(&z, &saida, |_, _| {});

        assert!(r.is_err(), "caminho com .. deveria ser recusado");
        assert!(!dir.parent().unwrap().join("fora.txt").exists(), "escapou da pasta");

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// A conferencia e pelo par .dat + .map, nunca pela pasta. Uma pasta
    /// existente e vazia (download interrompido, release incompleta) e o pior
    /// caso: o jogo entra na sala sem o mapa, tenta baixar do host, o servidor
    /// ranqueado bloqueia o host, e a barra fica em 0 kb para sempre.
    #[test]
    fn mapa_so_conta_como_pronto_com_o_par_dat_e_map() {
        let dir = temp_dir("mapa-par");
        let pasta = dir.join("MapsMP").join("CiW 2x2");
        std::fs::create_dir_all(&pasta).unwrap();

        assert!(!mapa_completo(&dir, "CiW 2x2"), "pasta vazia nao e mapa instalado");

        std::fs::write(pasta.join("CiW 2x2.dat"), "d").unwrap();
        assert!(!mapa_completo(&dir, "CiW 2x2"), "so o .dat nao basta");

        // Lixo do download interrompido nao pode passar por mapa.
        std::fs::write(pasta.join("CiW 2x2.map.kbpart"), "m").unwrap();
        assert!(!mapa_completo(&dir, "CiW 2x2"), ".kbpart e download pela metade");

        std::fs::write(pasta.join("CiW 2x2.map"), "m").unwrap();
        assert!(mapa_completo(&dir, "CiW 2x2"), "com o par o jogo enxerga o mapa");

        assert!(!mapa_completo(&dir, "Babylon"), "mapa nunca instalado");

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// "Arena" e "Arena 2" sao mapas reais e vizinhos em MapsMP/. Sem a barra
    /// no fim do prefixo, baixar "Arena" arrastaria a pasta do outro junto.
    #[test]
    fn filtro_do_mapa_nao_vaza_para_o_vizinho_de_nome_parecido() {
        let m = manifest_of(&[
            ("MapsMP/Arena/Arena.dat", "d"),
            ("MapsMP/Arena/Arena.map", "m"),
            ("MapsMP/Arena 2/Arena 2.dat", "d2"),
            ("MapsMP/Arena 2/Arena 2.map", "m2"),
            ("KaM_Remake.exe", "exe"),
        ]);

        let so_arena: Vec<_> = arquivos_do_mapa(&m, "Arena").into_iter().map(|f| f.path).collect();
        assert_eq!(so_arena, vec!["MapsMP/Arena/Arena.dat", "MapsMP/Arena/Arena.map"]);

        assert_eq!(arquivos_do_mapa(&m, "Arena 2").len(), 2);

        // O nome vem da temporada na API; o caminho, da arvore de arquivos.
        assert_eq!(arquivos_do_mapa(&m, "arena").len(), 2, "caixa diferente nao pode zerar o filtro");

        // Vazio e o sinal de "nao esta na release" -- e a mensagem que o
        // jogador recebe depende disso.
        assert!(arquivos_do_mapa(&m, "Babylon").is_empty());
    }

    #[test]
    fn baixa_tudo_quando_nada_existe() {
        let dir = temp_dir("vazio");
        let m = manifest_of(&[("a.txt", "aaa"), ("sub/b.txt", "bbb")]);
        assert_eq!(files_to_download(&dir, &m, |_| {}).len(), 2);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn ignora_arquivo_identico() {
        let dir = temp_dir("identico");
        std::fs::write(dir.join("a.txt"), "aaa").unwrap();
        let m = manifest_of(&[("a.txt", "aaa")]);
        assert!(files_to_download(&dir, &m, |_| {}).is_empty(), "arquivo igual nao deveria ser rebaixado");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn rebaixa_conteudo_diferente_de_mesmo_tamanho() {
        // O caso que uma comparacao so por tamanho deixaria passar -- e que
        // deixaria o jogador com um arquivo corrompido para sempre.
        let dir = temp_dir("mesmo-tamanho");
        std::fs::write(dir.join("a.txt"), "xxx").unwrap();
        let m = manifest_of(&[("a.txt", "aaa")]);
        assert_eq!(files_to_download(&dir, &m, |_| {}).len(), 1);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn rebaixa_arquivo_truncado() {
        let dir = temp_dir("truncado");
        std::fs::write(dir.join("a.txt"), "aa").unwrap();
        let m = manifest_of(&[("a.txt", "aaa")]);
        assert_eq!(files_to_download(&dir, &m, |_| {}).len(), 1);
        let _ = std::fs::remove_dir_all(&dir);
    }
}

#[cfg(test)]
mod poda {
    use super::tests::{manifest_of, temp_dir};
    use super::*;

    fn escrever(dir: &Path, rel: &str, conteudo: &str) {
        let caminho = dir.join(rel.replace('/', std::path::MAIN_SEPARATOR_STR));
        std::fs::create_dir_all(caminho.parent().unwrap()).unwrap();
        std::fs::write(&caminho, conteudo).unwrap();
    }

    fn existe(dir: &Path, rel: &str) -> bool {
        dir.join(rel.replace('/', std::path::MAIN_SEPARATOR_STR)).exists()
    }

    /// Uma instalação como as que existem hoje: arquivos da release, lixo da
    /// conversão antiga, e as coisas do jogador no meio.
    fn instalacao(nome: &str) -> (PathBuf, Manifest) {
        let dir = temp_dir(nome);

        // Da release
        escrever(&dir, "data/Sprites/Units.rxx", "novo");
        escrever(&dir, "Music/track_00.mp2", "musica");

        // Órfãos: o launcher antigo gerava isto, e a release nova não tem
        escrever(&dir, "data/sfx/speech/AXEMAN/0.snd", "lixo");
        escrever(&dir, "Music/99 - sobra do experimento.mp2", "lixo");

        // Do JOGADOR — nada disto pode sumir
        escrever(&dir, "SavesMP/minha partida/minha partida.sav", "save");
        escrever(&dir, "MapsMP/Mapa Que Eu Baixei/Mapa Que Eu Baixei.dat", "mapa");
        escrever(&dir, "MapsDL/outro/outro.dat", "mapa baixado");
        escrever(&dir, "Logs/KaM 2026.log", "log");
        escrever(&dir, "KaM Remake Settings.xml", "nickname e volume");
        escrever(&dir, "kambrasil.json", "{}");

        let manifest = manifest_of(&[("data/Sprites/Units.rxx", "x"), ("Music/track_00.mp2", "y")]);
        (dir, manifest)
    }

    #[test]
    fn apaga_o_que_a_release_nao_tem_mais() {
        let (dir, manifest) = instalacao("poda-orfaos");
        let n = podar_orfaos(&dir, &manifest);

        assert!(!existe(&dir, "data/sfx/speech/AXEMAN/0.snd"), "órfão da conversão antiga devia sair");
        assert!(!existe(&dir, "Music/99 - sobra do experimento.mp2"), "sobra devia sair");
        assert_eq!(n, 2);
    }

    #[test]
    fn nao_encosta_no_que_e_do_jogador() {
        // O teste que importa. Um erro aqui apaga save e mapa de gente, e não
        // tem desfazer.
        let (dir, manifest) = instalacao("poda-jogador");
        podar_orfaos(&dir, &manifest);

        for dele in [
            "SavesMP/minha partida/minha partida.sav",
            "MapsMP/Mapa Que Eu Baixei/Mapa Que Eu Baixei.dat",
            "MapsDL/outro/outro.dat",
            "Logs/KaM 2026.log",
            "KaM Remake Settings.xml",
            "kambrasil.json",
        ] {
            assert!(existe(&dir, dele), "{dele} é do jogador e não podia ser apagado");
        }
    }

    #[test]
    fn preserva_o_que_esta_no_manifesto() {
        let (dir, manifest) = instalacao("poda-manifesto");
        podar_orfaos(&dir, &manifest);

        assert!(existe(&dir, "data/Sprites/Units.rxx"));
        assert!(existe(&dir, "Music/track_00.mp2"));
    }

    #[test]
    fn pasta_que_esvaziou_some_mas_a_com_conteudo_fica() {
        let (dir, manifest) = instalacao("poda-pastas");
        podar_orfaos(&dir, &manifest);

        assert!(!existe(&dir, "data/sfx/speech"), "pasta vazia devia sumir junto");
        assert!(existe(&dir, "Music"), "pasta com arquivo do manifesto fica");
        assert!(existe(&dir, "SavesMP"), "pasta do jogador fica");
    }

    #[test]
    fn rodar_duas_vezes_nao_muda_nada() {
        let (dir, manifest) = instalacao("poda-idempotente");
        let primeira = podar_orfaos(&dir, &manifest);
        let segunda = podar_orfaos(&dir, &manifest);

        assert_eq!(primeira, 2);
        assert_eq!(segunda, 0, "a segunda passada não tem o que apagar");
    }
}

#[cfg(test)]
mod testes_sentinela {
    use super::*;

    #[test]
    fn versao_diferente_sempre_pede_atualizacao() {
        assert!(precisa_atualizar(Some("1.0.4"), "1.3.0", Sentinela::Igual));
        assert!(precisa_atualizar(None, "1.3.0", Sentinela::Igual));
    }

    #[test]
    fn versao_igual_com_executavel_velho_pede_atualizacao() {
        // O caso que motivou tudo isto: o marcador dizia a versao certa e os
        // arquivos eram de um mes atras.
        assert!(precisa_atualizar(Some("1.3.0"), "1.3.0", Sentinela::Divergente));
    }

    #[test]
    fn versao_igual_e_executavel_igual_nao_pede_nada() {
        assert!(!precisa_atualizar(Some("1.3.0"), "1.3.0", Sentinela::Igual));
    }

    #[test]
    fn falha_ao_conferir_nao_manda_reinstalar() {
        // Sem internet nao se acusa instalacao quebrada.
        assert!(!precisa_atualizar(Some("1.3.0"), "1.3.0", Sentinela::NaoConferida));
        assert!(!precisa_atualizar(Some("1.3.0"), "1.3.0", Sentinela::AusenteNoManifesto));
    }
}
