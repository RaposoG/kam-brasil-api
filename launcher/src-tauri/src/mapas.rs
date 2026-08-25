//! Sincronia dos mapas do catálogo global com a pasta do jogo.
//!
//! O admin curou uma lista de mapas na API; aqui o launcher a compara com o que
//! existe em `MapsMP/`, baixa o que falta, atualiza o que mudou de sha256 e
//! apaga o que saiu do catálogo.
//!
//! ## Apagar é a parte perigosa
//!
//! O jogador tem mapas que não são nossos: feitos por ele, baixados de outro
//! servidor, herdados de outra instalação. Apagar tudo que não está no catálogo
//! destruiria o acervo dele — e não tem volta. Por isso só apagamos o que este
//! catálogo instalou, registrado em `kambrasil-mapas.json` ao lado do jogo. Sem
//! registro (primeira sincronia, ou arquivo apagado na mão) não se apaga NADA.
//!
//! ## Contrato com a API
//!
//! `GET {api_base}/catalog/mapas`, público (o download em si já é público em
//! `/downloads/`, e um mapa não é segredo):
//!
//! ```json
//! {
//!   "assinatura": "sha256 do catálogo inteiro",
//!   "baseUrl": "https://api.exemplo/downloads/mapas",
//!   "mapas": [
//!     {
//!       "nome": "Arena",
//!       "arquivos": [
//!         { "path": "MapsMP/Arena/Arena.dat", "size": 12345, "sha256": "..." },
//!         { "path": "MapsMP/Arena/Arena.map", "size": 67890, "sha256": "..." }
//!       ]
//!     }
//!   ]
//! }
//! ```
//!
//! `path` é relativo à pasta do jogo e **precisa** começar em `MapsMP/` — é o
//! que `caminho_seguro` exige. A URL do arquivo é `{baseUrl}/{path}`, igual ao
//! manifesto da release. 404 na rota = catálogo ainda não publicado, não é erro.

use std::collections::BTreeSet;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};

use crate::auth::AppState;
use crate::install::{
    baixar_em_paralelo, download_one, game_dir, precisa_baixar, ManifestFile, Progress,
};

/// O que ESTE catálogo instalou. Só o que está aqui pode ser apagado.
const REGISTRO: &str = "kambrasil-mapas.json";

const EVENTO: &str = "mapas-progress";

/// Barra própria: a instalação do jogo tem a dela, e as duas podem correr no
/// mesmo minuto.
fn emitir(app: &AppHandle, fase: &str, feitos: u32, total: u32) {
    let _ = app.emit(
        EVENTO,
        Progress {
            phase: fase.into(),
            current_file: String::new(),
            files_done: feitos,
            files_total: total,
            bytes_done: 0,
            bytes_total: 0,
            bytes_per_second: 0,
        },
    );
}

/// Um mapa do catálogo.
///
/// ponytail: os `alias` existem porque a API e o launcher são escritos em
/// paralelo e a casa mistura chave em inglês (manifesto da release) com chave em
/// português (rotas da ranqueada). Dois aliases custam duas linhas e evitam uma
/// release do launcher para consertar um nome de campo.
#[derive(Debug, Clone, Deserialize)]
pub struct MapaDoCatalogo {
    #[serde(alias = "nome")]
    pub name: String,
    #[serde(alias = "arquivos")]
    pub files: Vec<ManifestFile>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Catalogo {
    /// Hash do catálogo inteiro (`assinaturaDoCatalogo`, na API). É a mesma
    /// string que o canal de tempo real difunde, e é com ela que a tela sabe,
    /// numa comparação, que o aviso que chegou é de algo que ela já sincronizou.
    #[serde(default)]
    pub assinatura: String,
    #[serde(rename = "baseUrl")]
    pub base_url: String,
    #[serde(alias = "mapas")]
    pub maps: Vec<MapaDoCatalogo>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct Registro {
    arquivos: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ResumoMapas {
    /// Nada foi tocado; `motivo` diz por quê.
    pub adiado: bool,
    pub motivo: String,
    pub baixados: u32,
    pub apagados: u32,
    /// Quantos mapas o catálogo tem hoje.
    pub total: u32,
    /// A assinatura que acabou de ser sincronizada. Vazia quando foi adiado.
    pub assinatura: String,
}

impl ResumoMapas {
    fn adiado(motivo: &str) -> Self {
        Self {
            adiado: true,
            motivo: motivo.into(),
            baixados: 0,
            apagados: 0,
            total: 0,
            assinatura: String::new(),
        }
    }
}

/// `MapsMP/Arena/Arena.dat` → `<dir>/MapsMP/Arena/Arena.dat`. Qualquer outra
/// coisa vira `None`.
///
/// O catálogo vem da rede, e este é o ponto em que o que veio da rede vira
/// caminho de arquivo. Sem a trava, um `..` faria o download gravar fora da
/// pasta do jogo — e, muito pior, a remoção apagaria arquivo do jogador em
/// qualquer lugar do disco. Exigir o prefixo `MapsMP/` resolve os dois de uma
/// vez: é o único lugar onde o catálogo tem o que instalar.
fn caminho_seguro(dir: &Path, path: &str) -> Option<PathBuf> {
    let mut partes = Path::new(path).components().map(|c| match c {
        Component::Normal(s) => s.to_str(),
        _ => None,
    });

    let primeira = partes.next()??;
    if !primeira.eq_ignore_ascii_case("MapsMP") {
        return None;
    }

    let mut destino = dir.join(primeira);
    let mut tem_arquivo = false;
    for parte in partes {
        destino.push(parte?);
        tem_arquivo = true;
    }

    // "MapsMP" sozinho é a pasta inteira, não um arquivo dentro dela.
    tem_arquivo.then_some(destino)
}

fn ler_registro(dir: &Path) -> Option<Registro> {
    serde_json::from_str(&std::fs::read_to_string(dir.join(REGISTRO)).ok()?).ok()
}

fn gravar_registro(dir: &Path, arquivos: BTreeSet<String>) -> Result<(), String> {
    let registro = Registro { arquivos: arquivos.into_iter().collect() };
    std::fs::write(
        dir.join(REGISTRO),
        serde_json::to_vec_pretty(&registro).map_err(|e| e.to_string())?,
    )
    .map_err(|e| format!("não foi possível registrar os mapas instalados: {e}"))
}

/// Apaga o que o catálogo instalou e não instala mais. Devolve quantos foram.
///
/// **Só** olha para `registro`. Um mapa que o jogador pôs em `MapsMP/` nunca
/// esteve lá, então nunca é candidato — é essa a única garantia que separa uma
/// sincronia de uma faxina no acervo dos outros.
fn remover_o_que_saiu(dir: &Path, registro: &Registro, catalogo: &BTreeSet<String>) -> u32 {
    let mut apagados = 0;
    let mut pastas = BTreeSet::new();

    for path in &registro.arquivos {
        if catalogo.contains(path) {
            continue;
        }
        let Some(local) = caminho_seguro(dir, path) else { continue };

        // Erro aqui é quase sempre "o jogador já apagou na mão": não conta, não
        // reclama, e não é motivo para abortar a sincronia.
        if std::fs::remove_file(&local).is_ok() {
            apagados += 1;
        }
        if let Some(pasta) = local.parent() {
            pastas.insert(pasta.to_path_buf());
        }
    }

    // A pasta do mapa some junto — mas só se ficou vazia. `remove_dir` se recusa
    // a apagar pasta com conteúdo, e é justamente essa recusa que preserva o que
    // o jogador tenha deixado lá dentro.
    for pasta in pastas {
        let _ = std::fs::remove_dir(&pasta);
    }

    apagados
}

/// `GET /catalog/mapas`. `None` = a API ainda não publica catálogo (404).
async fn buscar(api_base: &str) -> Result<Option<Catalogo>, String> {
    let resposta = reqwest::Client::new()
        .get(format!("{}/catalog/mapas", api_base.trim_end_matches('/')))
        .send()
        .await
        .map_err(|e| format!("não foi possível consultar o catálogo de mapas: {e}"))?;

    if resposta.status().as_u16() == 404 {
        return Ok(None);
    }
    if !resposta.status().is_success() {
        return Err(format!("a API respondeu {} ao consultar o catálogo de mapas", resposta.status()));
    }

    resposta
        .json()
        .await
        .map(Some)
        .map_err(|e| format!("catálogo de mapas inesperado: {e}"))
}

/// O jogo está aberto?
///
/// ponytail: `tasklist` porque o Windows já o traz e a resposta não depende de
/// idioma — a linha de um processo encontrado contém o nome do executável, e a
/// de "nenhum" não. O launcher só roda em Windows; fora dele a sincronia segue
/// em frente, que é o que um dev de Linux quer nos testes.
#[cfg(windows)]
fn jogo_aberto() -> bool {
    use std::os::windows::process::CommandExt;
    /// Sem isto uma janela de console pisca na cara do jogador a cada sincronia.
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    std::process::Command::new("tasklist")
        .args(["/FI", &format!("IMAGENAME eq {}", crate::game::EXE_NAME), "/NH"])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map(|saida| String::from_utf8_lossy(&saida.stdout).contains(crate::game::EXE_NAME))
        .unwrap_or(false)
}

#[cfg(not(windows))]
fn jogo_aberto() -> bool {
    false
}

/// Uma sincronia por vez.
///
/// O boot chama, e o aviso do socket pode chegar no mesmo segundo. Duas
/// sincronias juntas baixariam o mesmo arquivo em duas tarefas e a segunda
/// gravaria o registro sem saber o que a primeira apagou.
static EM_CURSO: AtomicBool = AtomicBool::new(false);

/// Solta o `EM_CURSO` mesmo se a sincronia sair por `?`.
struct Tranca;

impl Drop for Tranca {
    fn drop(&mut self) {
        EM_CURSO.store(false, Ordering::Release);
    }
}

/// Compara o catálogo com `MapsMP/` e resolve a diferença.
#[tauri::command]
pub async fn mapas_sync(app: AppHandle, state: State<'_, AppState>) -> Result<ResumoMapas, String> {
    if EM_CURSO.swap(true, Ordering::AcqRel) {
        return Ok(ResumoMapas::adiado("uma sincronia já está em andamento"));
    }
    let _tranca = Tranca;

    let dir = game_dir();

    // Sem jogo instalado não há pasta a sincronizar, e a instalação já traz os
    // mapas dentro do pacote. Baixá-los antes seria pagar duas vezes.
    if crate::install::read_installed(&dir).is_none() {
        return Ok(ResumoMapas::adiado("o jogo ainda não está instalado"));
    }

    // Mexer em MapsMP/ com o jogo aberto é trocar o chão de quem está em pé: o
    // jogo lê a pasta ao abrir o multiplayer e mantém o arquivo aberto na
    // partida. Fica para depois — a tela tenta de novo.
    if jogo_aberto() {
        return Ok(ResumoMapas::adiado("o jogo está aberto"));
    }

    let Some(catalogo) = buscar(&state.api_base()).await? else {
        return Ok(ResumoMapas::adiado("a API ainda não publicou catálogo de mapas"));
    };

    let mut arquivos = Vec::new();
    let mut caminhos = BTreeSet::new();
    for mapa in &catalogo.maps {
        for f in &mapa.files {
            if caminho_seguro(&dir, &f.path).is_none() {
                // Não abortamos por causa de uma entrada torta: o resto do
                // catálogo continua válido, e o jogador não tem como consertar.
                eprintln!("aviso: catálogo com caminho recusado em \"{}\": {}", mapa.name, f.path);
                continue;
            }
            caminhos.insert(f.path.clone());
            arquivos.push(f.clone());
        }
    }

    emitir(&app, "verificando", 0, arquivos.len() as u32);

    // Hashear centenas de arquivos é I/O, não espera de rede: fora da thread do
    // runtime, senão a janela congela durante a conferência.
    let pendentes = {
        let dir = dir.clone();
        tokio::task::spawn_blocking(move || {
            arquivos.into_iter().filter(|f| precisa_baixar(&dir, f)).collect::<Vec<_>>()
        })
        .await
        .map_err(|e| format!("falha ao conferir os mapas: {e}"))?
    };

    let baixados = pendentes.len() as u32;
    if !pendentes.is_empty() {
        baixar_em_paralelo(
            &app,
            &reqwest::Client::new(),
            &catalogo.base_url,
            &dir,
            pendentes,
            EVENTO,
        )
        .await?;
    }

    // Sem registro é a primeira sincronia: tudo que está em MapsMP/ veio da
    // release ou do jogador, e nada disso é nosso para apagar.
    let apagados = match ler_registro(&dir) {
        Some(registro) => remover_o_que_saiu(&dir, &registro, &caminhos),
        None => 0,
    };

    gravar_registro(&dir, caminhos)?;

    emitir(&app, "pronto", baixados, baixados);

    Ok(ResumoMapas {
        adiado: false,
        motivo: String::new(),
        baixados,
        apagados,
        total: catalogo.maps.len() as u32,
        assinatura: catalogo.assinatura,
    })
}

/// Baixa um mapa só do catálogo. `Ok(false)` = o catálogo não tem esse mapa.
///
/// É o encaixe com o lobby: o launcher confere o mapa da partida antes de abrir
/// o jogo, e quando falta é daqui que ele vem. Não roda a sincronia inteira de
/// propósito — ninguém quer uma faxina de mapas no minuto em que a sala
/// ranqueada está esperando.
pub(crate) async fn baixar_do_catalogo(api_base: &str, nome: &str) -> Result<bool, String> {
    let Some(catalogo) = buscar(api_base).await? else { return Ok(false) };

    // Caixa diferente: o nome vem da temporada na API, o do catálogo vem da
    // pasta do mapa.
    let Some(mapa) = catalogo.maps.iter().find(|m| m.name.eq_ignore_ascii_case(nome)) else {
        return Ok(false);
    };

    let dir = game_dir();
    let client = reqwest::Client::new();
    let bytes = AtomicU64::new(0);

    // ponytail: sequencial. Um mapa são ~10 arquivos; o pior caso real ("CiW
    // 2x2") tem 122. Se incomodar, `baixar_em_paralelo` está a uma linha daqui.
    for f in &mapa.files {
        if caminho_seguro(&dir, &f.path).is_none() {
            return Err(format!("o catálogo descreve \"{}\" com um caminho inválido", mapa.name));
        }
        if precisa_baixar(&dir, f) {
            download_one(&client, &catalogo.base_url, &dir, f, &bytes).await?;
        }
    }

    // Entra no registro: um mapa que instalamos por aqui precisa poder sair
    // quando o admin o tirar do catálogo.
    let mut registro = ler_registro(&dir).unwrap_or_default();
    registro.arquivos.extend(mapa.files.iter().map(|f| f.path.clone()));
    gravar_registro(&dir, registro.arquivos.into_iter().collect())?;

    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(nome: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("kambrasil-mapas-{nome}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn escrever(dir: &Path, path: &str, conteudo: &str) {
        let alvo = caminho_seguro(dir, path).expect("caminho de teste deveria ser válido");
        std::fs::create_dir_all(alvo.parent().unwrap()).unwrap();
        std::fs::write(alvo, conteudo).unwrap();
    }

    fn existe(dir: &Path, path: &str) -> bool {
        dir.join(path.replace('/', std::path::MAIN_SEPARATOR_STR)).is_file()
    }

    fn registro(paths: &[&str]) -> Registro {
        Registro { arquivos: paths.iter().map(|p| p.to_string()).collect() }
    }

    fn catalogo(paths: &[&str]) -> BTreeSet<String> {
        paths.iter().map(|p| p.to_string()).collect()
    }

    /// O teste que justifica o registro existir.
    ///
    /// DUAS sincronias seguidas, na ordem exata de `mapas_sync`, sobre uma
    /// instalação que já tinha os mapas da release.
    ///
    /// Os outros testes exercitam as peças com um registro escrito à mão. O que
    /// pode dar errado na composição é o registro que a sincronia 1 GRAVA não
    /// ser o que a sincronia 2 LÊ para decidir o que apagar — e o erro aqui não
    /// tem desfazer. Por isso o registro deste teste não é inventado: é o que
    /// `gravar_registro` deixou em disco no passo anterior.
    #[test]
    fn duas_sincronias_seguidas_nao_encostam_no_acervo_do_jogador() {
        let dir = temp_dir("duas-sincronias");

        // Veio na release do jogo, e o admin nunca pôs no catálogo.
        escrever(&dir, "MapsMP/Cursed Ravine/Cursed Ravine.dat", "release");
        // Feito pelo jogador.
        escrever(&dir, "MapsMP/Mapa do Zé/Mapa do Zé.dat", "do jogador");
        // No catálogo desde o começo.
        escrever(&dir, "MapsMP/Arena/Arena.dat", "d");
        escrever(&dir, "MapsMP/Arena/Arena.map", "m");
        // No catálogo agora; o admin vai tirar antes da segunda sincronia.
        escrever(&dir, "MapsMP/Babylon/Babylon.dat", "d");

        // --- sincronia 1: primeira vez, ainda não há registro ---
        let primeira = catalogo(&[
            "MapsMP/Arena/Arena.dat",
            "MapsMP/Arena/Arena.map",
            "MapsMP/Babylon/Babylon.dat",
        ]);
        let apagados = match ler_registro(&dir) {
            Some(r) => remover_o_que_saiu(&dir, &r, &primeira),
            None => 0,
        };
        gravar_registro(&dir, primeira).unwrap();
        assert_eq!(apagados, 0, "sem registro, a primeira sincronia não apaga nada");

        // --- sincronia 2: o admin tirou "Babylon" do catálogo ---
        let segunda = catalogo(&["MapsMP/Arena/Arena.dat", "MapsMP/Arena/Arena.map"]);
        let registro_em_disco = ler_registro(&dir).expect("a sincronia 1 tinha que ter gravado");
        let apagados = remover_o_que_saiu(&dir, &registro_em_disco, &segunda);
        gravar_registro(&dir, segunda).unwrap();

        assert_eq!(apagados, 1, "só Babylon saiu do catálogo");
        assert!(!existe(&dir, "MapsMP/Babylon/Babylon.dat"), "Babylon deveria ter saído");
        assert!(existe(&dir, "MapsMP/Arena/Arena.dat"), "Arena continua no catálogo");
        assert!(
            existe(&dir, "MapsMP/Mapa do Zé/Mapa do Zé.dat"),
            "o mapa do jogador foi apagado — este é o erro sem volta"
        );
        assert!(
            existe(&dir, "MapsMP/Cursed Ravine/Cursed Ravine.dat"),
            "mapa que veio na release e nunca esteve no catálogo foi apagado"
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// O jogador tem mapas que não são nossos — feitos por ele, baixados de
    /// outro servidor. Apagar um deles não tem desfazer, e nenhuma sincronia
    /// vale isso.
    #[test]
    fn mapa_do_jogador_sobrevive_a_sincronia() {
        let dir = temp_dir("acervo-do-jogador");

        // Nosso, e ainda no catálogo.
        escrever(&dir, "MapsMP/Arena/Arena.dat", "d");
        escrever(&dir, "MapsMP/Arena/Arena.map", "m");
        // Nosso, e o admin tirou do catálogo.
        escrever(&dir, "MapsMP/Babylon/Babylon.dat", "d");
        escrever(&dir, "MapsMP/Babylon/Babylon.map", "m");
        // Do jogador: nunca passou pelo catálogo.
        escrever(&dir, "MapsMP/Mapa do Zé/Mapa do Zé.dat", "d");
        escrever(&dir, "MapsMP/Mapa do Zé/Mapa do Zé.map", "m");

        let apagados = remover_o_que_saiu(
            &dir,
            &registro(&[
                "MapsMP/Arena/Arena.dat",
                "MapsMP/Arena/Arena.map",
                "MapsMP/Babylon/Babylon.dat",
                "MapsMP/Babylon/Babylon.map",
            ]),
            &catalogo(&["MapsMP/Arena/Arena.dat", "MapsMP/Arena/Arena.map"]),
        );

        assert_eq!(apagados, 2, "só os dois arquivos de Babylon deveriam sair");
        assert!(existe(&dir, "MapsMP/Mapa do Zé/Mapa do Zé.dat"), "mapa do jogador foi apagado");
        assert!(existe(&dir, "MapsMP/Mapa do Zé/Mapa do Zé.map"), "mapa do jogador foi apagado");
        assert!(existe(&dir, "MapsMP/Arena/Arena.dat"), "mapa ainda no catálogo saiu");
        assert!(!existe(&dir, "MapsMP/Babylon/Babylon.dat"), "mapa fora do catálogo ficou");
        assert!(!dir.join("MapsMP").join("Babylon").exists(), "pasta vazia deveria sumir");

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Primeira sincronia numa instalação que já tinha 211 mapas da release.
    /// Sem registro não existe "o que instalamos" — e sem isso não se apaga.
    #[test]
    fn sem_registro_nao_se_apaga_nada() {
        let dir = temp_dir("sem-registro");
        escrever(&dir, "MapsMP/Arena/Arena.dat", "d");

        assert!(ler_registro(&dir).is_none(), "não deveria haver registro");
        assert!(existe(&dir, "MapsMP/Arena/Arena.dat"));

        // E o registro escrito na primeira sincronia é lido de volta igual.
        gravar_registro(&dir, catalogo(&["MapsMP/Arena/Arena.dat"])).unwrap();
        assert_eq!(ler_registro(&dir).unwrap().arquivos, vec!["MapsMP/Arena/Arena.dat"]);

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// O jogador pode ter posto um arquivo dentro de uma pasta nossa. A pasta
    /// não pode sumir com ele dentro.
    #[test]
    fn pasta_com_arquivo_do_jogador_nao_e_removida() {
        let dir = temp_dir("pasta-com-extra");
        escrever(&dir, "MapsMP/Arena/Arena.dat", "d");
        escrever(&dir, "MapsMP/Arena/anotacoes.txt", "minhas notas");

        remover_o_que_saiu(&dir, &registro(&["MapsMP/Arena/Arena.dat"]), &catalogo(&[]));

        assert!(!existe(&dir, "MapsMP/Arena/Arena.dat"), "o nosso deveria sair");
        assert!(existe(&dir, "MapsMP/Arena/anotacoes.txt"), "arquivo do jogador foi junto");
        assert!(dir.join("MapsMP").join("Arena").is_dir(), "a pasta não estava vazia");

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// O catálogo vem da rede. Um `..` aqui apagaria arquivo fora da pasta do
    /// jogo — e a remoção passa por este mesmo filtro.
    #[test]
    fn caminho_fora_de_mapsmp_e_recusado() {
        let dir = Path::new("C:").join("jogo");

        assert!(caminho_seguro(&dir, "MapsMP/Arena/Arena.dat").is_some());
        assert!(caminho_seguro(&dir, "mapsmp/Arena/Arena.dat").is_some(), "caixa não deveria importar");

        assert!(caminho_seguro(&dir, "../../Windows/System32/drivers/etc/hosts").is_none());
        assert!(caminho_seguro(&dir, "MapsMP/../../fora.txt").is_none());
        assert!(caminho_seguro(&dir, "MapsMP\\..\\..\\fora.txt").is_none());
        assert!(caminho_seguro(&dir, "/etc/passwd").is_none());
        assert!(caminho_seguro(&dir, "Saves/autosave.sav").is_none(), "só MapsMP/ é nosso");
        assert!(caminho_seguro(&dir, "KaM_Remake.exe").is_none(), "o executável não é mapa");
        assert!(caminho_seguro(&dir, "MapsMP").is_none(), "a pasta inteira não é arquivo");
        assert!(caminho_seguro(&dir, "").is_none());
    }

    /// Um caminho torto no catálogo não pode virar remoção de um arquivo
    /// vizinho nem abortar a limpeza dos outros.
    #[test]
    fn registro_com_caminho_torto_e_ignorado_na_remocao() {
        let dir = temp_dir("registro-torto");
        escrever(&dir, "MapsMP/Arena/Arena.dat", "d");
        std::fs::write(dir.join("KaM_Remake.exe"), "exe").unwrap();

        let apagados = remover_o_que_saiu(
            &dir,
            &registro(&["../KaM_Remake.exe", "KaM_Remake.exe", "MapsMP/Arena/Arena.dat"]),
            &catalogo(&[]),
        );

        assert_eq!(apagados, 1, "só o mapa deveria ter sido apagado");
        assert!(dir.join("KaM_Remake.exe").is_file(), "o executável foi apagado pelo catálogo");

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// A API e o launcher são escritos em paralelo: o catálogo precisa ser lido
    /// tanto em português quanto em inglês.
    ///
    /// O corpo em português NÃO é escrito à mão: é a resposta real de
    /// `GET /catalog/mapas` da API, capturada subindo a rota de verdade e
    /// mandando pelo painel a pasta real de "A Clash of Kings". Escrever o JSON
    /// à mão testaria o que este arquivo já acha — e o modo de falha aqui é
    /// justamente um nome de campo divergir entre os dois lados, que um JSON
    /// inventado nunca pegaria. Os campos que só a API usa (`id`, `mapCrc`,
    /// `modos`, `crcVerificado`) vêm junto de propósito: o `serde` tem que
    /// ignorá-los em silêncio, senão a sincronia inteira falha ao ler.
    #[test]
    fn le_o_catalogo_nas_duas_grafias() {
        let pt: Catalogo = serde_json::from_str(
            r#"{
              "assinatura": "dd8ea02d821702f76a26ba595132a43082f6cb8bead4fb67fa0de2a9a8dc2e69",
              "baseUrl": "http://api/downloads/mapas/dd8ea02d821702f76a26ba595132a43082f6cb8bead4fb67fa0de2a9a8dc2e69",
              "mapas": [{
                "id": "0af38f28-4937-4f37-882e-de3e3cc6ac23",
                "nome": "A Clash of Kings",
                "mapCrc": "80059674",
                "modos": ["1v1", "2v2"],
                "crcVerificado": true,
                "arquivos": [
                  { "path": "MapsMP/A Clash of Kings/A Clash of Kings.dat", "sha256": "39cc74f78ee38d2b92bd40aa8f380d89f6f6ae18406ec4e2f39044599881f471", "size": 51457 },
                  { "path": "MapsMP/A Clash of Kings/A Clash of Kings.map", "sha256": "660b0f9dd32d481c77496f880b7a16381aa66b875dbb3bffb97693f86dee7591", "size": 309806 },
                  { "path": "MapsMP/A Clash of Kings/A Clash of Kings.txt", "sha256": "b78f38026f1717f9ad9b52d01469d687b7e8121e88f335770d495344adef319c", "size": 327 }
                ]
              }]
            }"#,
        )
        .unwrap();
        assert_eq!(pt.maps[0].name, "A Clash of Kings");
        assert_eq!(pt.maps[0].files[0].path, "MapsMP/A Clash of Kings/A Clash of Kings.dat");
        assert_eq!(pt.maps[0].files[0].size, 51457);
        assert_eq!(pt.maps[0].files.len(), 3, "o .mi não é distribuído");
        assert!(pt.base_url.ends_with(&pt.assinatura), "a assinatura vai na URL de download");

        // Cada caminho do manifesto real tem que sobreviver ao filtro que decide
        // onde gravar e o que apagar. Um `None` aqui seria mapa que nunca baixa.
        let dir = Path::new("C:").join("jogo");
        for f in &pt.maps[0].files {
            assert!(caminho_seguro(&dir, &f.path).is_some(), "caminho recusado: {}", f.path);
        }

        let en: Catalogo = serde_json::from_str(
            r#"{"baseUrl":"https://x/downloads/mapas","maps":[
                 {"name":"Arena","files":[{"path":"MapsMP/Arena/Arena.dat","size":3,"sha256":"ab"}]}]}"#,
        )
        .unwrap();
        assert_eq!(en.maps[0].name, "Arena");
        assert_eq!(en.base_url, "https://x/downloads/mapas");

        // Catálogo sem assinatura ainda tem que ser lido: a assinatura é
        // otimização (evitar a sincronia repetida), não requisito.
        assert_eq!(en.assinatura, "");

        let assinado: Catalogo = serde_json::from_str(
            r#"{"assinatura":"deadbeef","baseUrl":"https://x/d","mapas":[]}"#,
        )
        .unwrap();
        assert_eq!(assinado.assinatura, "deadbeef");
    }
}
