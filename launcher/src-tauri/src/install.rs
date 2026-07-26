//! Instalação e atualização do jogo a partir do manifesto da API.
//!
//! Uma release é uma árvore, não um arquivo. O launcher busca o manifesto,
//! compara com o que existe em disco e baixa apenas a diferença — instalação
//! nova e atualização passam pelo mesmo caminho. Como os mapas são a maior parte
//! do payload e quase nunca mudam, uma correção no executável vira poucos MB em
//! vez de meio giga.
//!
//! O que a API **não** entrega são os arquivos derivados do Knights and
//! Merchants original. Esses são produzidos aqui, a partir da cópia do próprio
//! jogador (ver `assets.rs`).

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
    /// `verificando` | `baixando` | `assets` | `pronto`
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

/// Decide o que precisa ser baixado.
///
/// Tamanho diferente já reprova sem ler o arquivo inteiro — é o caso comum e
/// evita hashear centenas de MB à toa. Só quando o tamanho bate é que o sha256
/// decide, porque tamanho igual com conteúdo diferente existe.
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
        let local = dir.join(f.path.replace('/', std::path::MAIN_SEPARATOR_STR));
        let up_to_date = match std::fs::metadata(&local) {
            Ok(meta) if meta.len() == f.size => sha256_of(&local).as_deref() == Some(&f.sha256),
            _ => false,
        };

        if !up_to_date {
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

#[tauri::command]
pub async fn check_update(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let dir = game_dir();
    let installed = read_installed(&dir).map(|i| i.version);

    let response = reqwest::Client::new()
        .get(format!("{}/client/latest", state.api_base()))
        .send()
        .await
        .map_err(|e| format!("não foi possível consultar a versão: {e}"))?;

    if response.status().as_u16() == 404 {
        return Ok(serde_json::json!({
            "path": dir.display().to_string(),
            "installedVersion": installed,
            "latest": null,
            "needsUpdate": false,
        }));
    }
    if !response.status().is_success() {
        return Err(format!("a API respondeu {} ao consultar a versão", response.status()));
    }

    let latest: LatestRelease = response
        .json()
        .await
        .map_err(|e| format!("resposta inesperada da API: {e}"))?;

    let needs_update = installed.as_deref() != Some(latest.version.as_str());

    Ok(serde_json::json!({
        "path": dir.display().to_string(),
        "installedVersion": installed,
        "latest": latest,
        "needsUpdate": needs_update,
    }))
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
async fn download_one(
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
                    "install-progress",
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
        let base_url = release.base_url.clone();
        let dir = dir.clone();
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

    if let Some(error) = failure {
        return Err(error);
    }

    let bytes_done = bytes_done.load(Ordering::Relaxed);

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

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("kambrasil-inst-{name}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn manifest_of(files: &[(&str, &str)]) -> Manifest {
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
