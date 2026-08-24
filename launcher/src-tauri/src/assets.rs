//! Gera os arquivos derivados do Knights and Merchants original.
//!
//! Nada disto vem da nossa API: sprites, sons, músicas e os `.dat` de unidades e
//! casas pertencem ao jogo comercial. São produzidos aqui, na máquina do
//! jogador, a partir da cópia que ele possui — por isso o launcher exige achar a
//! instalação original antes de deixar jogar.
//!
//! São quatro operações, três triviais e uma cara:
//!
//! | Destino | Origem |
//! |---|---|
//! | `data/gfx/*.bbm`, `*.lbm`, `*.dat` | cópia direta (paletas) |
//! | `data/defines/houses.dat`, `unit.dat` | cópia direta |
//! | `data/sfx/` | cópia direta |
//! | `Music/*.mp2` | `data/sfx/songs/*.sng` renomeados |
//! | `data/Sprites/*.rxx` | **RXXPacker** sobre os `.rx` (~2 min) |
//!
//! O `.sng` do KaM é MP2 com outra extensão; renomear basta.

use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Emitter};

#[derive(Clone, Serialize)]
struct AssetProgress {
    step: String,
    detail: String,
}

fn copy_dir(from: &Path, to: &Path) -> Result<u32, String> {
    if !from.is_dir() {
        return Ok(0);
    }
    std::fs::create_dir_all(to).map_err(|e| format!("não foi possível criar {}: {e}", to.display()))?;

    let mut count = 0;
    for entry in std::fs::read_dir(from).map_err(|e| format!("não foi possível ler {}: {e}", from.display()))? {
        let entry = entry.map_err(|e| e.to_string())?;
        let target = to.join(entry.file_name());
        if entry.path().is_dir() {
            count += copy_dir(&entry.path(), &target)?;
        } else {
            std::fs::copy(entry.path(), &target)
                .map_err(|e| format!("não foi possível copiar {}: {e}", entry.path().display()))?;
            count += 1;
        }
    }
    Ok(count)
}

fn copy_glob(from: &Path, to: &Path, extensions: &[&str]) -> Result<u32, String> {
    if !from.is_dir() {
        return Ok(0);
    }
    std::fs::create_dir_all(to).map_err(|e| format!("não foi possível criar {}: {e}", to.display()))?;

    let mut count = 0;
    for entry in std::fs::read_dir(from).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let matches = path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| extensions.iter().any(|want| want.eq_ignore_ascii_case(e)))
            .unwrap_or(false);
        if matches {
            std::fs::copy(&path, to.join(entry.file_name()))
                .map_err(|e| format!("não foi possível copiar {}: {e}", path.display()))?;
            count += 1;
        }
    }
    Ok(count)
}



/// Roda todas as etapas locais. Bloqueante e demorado — chame de spawn_blocking.
/// Copia da instalação do KaM Remake o que não podemos distribuir.
///
/// Tudo aqui é **cópia direta**. Não empacotamos sprites, não convertemos áudio,
/// não renomeamos nada: o KaM Remake já entrega os arquivos no formato e no
/// lugar que o jogo espera.
///
/// Isso não é só economia de tempo (eram ~2 min de RXXPacker mais 22 s de
/// conversão de vozes). É correção: gerar localmente produzia arquivos
/// **diferentes** em cada máquina, e era a causa dos desyncs e do sprite da
/// mina de ferro aparecer na versão antiga.
pub fn generate(app: &AppHandle, game: &Path, remake: &Path) -> Result<(), String> {
    let step = |name: &str, detail: &str| {
        let _ = app.emit(
            "asset-progress",
            AssetProgress { step: name.into(), detail: detail.into() },
        );
    };

    step("sprites", "copiando gráficos");
    // Os .rxx ja vem empacotados. Antes rodavamos o RXXPacker sobre os .rx do
    // jogador, e o resultado nao batia com o do KaM Remake.
    copy_dir(&remake.join("data").join("Sprites"), &game.join("data").join("Sprites"))?;

    step("paletas", "copiando paletas de cores");
    copy_glob(&remake.join("data").join("gfx"), &game.join("data").join("gfx"), &["bbm", "lbm", "dat"])?;

    step("sons", "copiando sons e vozes");
    // Inclui as pastas speech.<idioma> com os .wav ja no formato certo. Antes
    // copiavamos speech/ com .snd do original, que o jogo nunca encontrava.
    copy_dir(&remake.join("data").join("sfx"), &game.join("data").join("sfx"))?;

    step("musicas", "copiando trilha sonora");
    // Ja sao .mp2. Antes renomeavamos os .sng do original.
    copy_dir(&remake.join("Music"), &game.join("Music"))?;

    step("pronto", "");
    Ok(())
}

/// Já geramos os assets nesta instalação?
pub fn assets_ready(game: &Path) -> bool {
    let sprites = game.join("data").join("Sprites");
    let required = ["GUI.rxx", "GUIMain.rxx", "Houses.rxx", "Trees.rxx", "Units.rxx", "Tileset.rxx"];

    // As vozes entram na conta: instalacoes antigas nao tem a pasta com sufixo
    // de idioma e as tropas ficam mudas. Sem
    // isto, ninguem seria convidado a refazer os arquivos.
    let fala_pronta = game
        .join("data")
        .join("sfx")
        .join(PASTA_FALA)
        .join("AXEMAN")
        .join("ATTACK0.wav")
        .is_file();

    required.iter().all(|f| sprites.join(f).is_file())
        && game.join("data").join("defines").join("unit.dat").is_file()
        && fala_pronta
}

#[tauri::command]
pub fn assets_status() -> bool {
    assets_ready(&crate::install::game_dir())
}

#[tauri::command]
pub async fn generate_assets(app: AppHandle, original_path: String) -> Result<(), String> {
    let game = crate::install::game_dir();
    let original = PathBuf::from(original_path);

    tokio::task::spawn_blocking(move || generate(&app, &game, &original))
        .await
        .map_err(|e| format!("falha ao gerar os arquivos do jogo: {e}"))?
}


/// Nome que o jogo espera para a pasta de vozes das unidades.
///
/// O KaM original guarda as falas em `data/sfx/speech/`, sem sufixo. O Remake
/// **sempre** monta `speech.` + idioma (KM_ResSound.pas): tenta o idioma do
/// jogador, depois o fallback declarado em locales.txt, e por fim `eng`.
///
/// Para quem joga em português nenhum dos três existe -- `ptb` não tem fallback
/// declarado --, então as tropas ficam mudas. Renomear para `speech.eng` faz a
/// última tentativa acertar, seja qual for o idioma do jogador.
const PASTA_FALA: &str = "speech.eng";


#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("kambrasil-assets-{name}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }



    #[test]
    fn copia_apenas_as_extensoes_pedidas() {
        let from = temp_dir("glob-origem");
        let to = temp_dir("glob-destino");
        std::fs::write(from.join("pal0.bbm"), "x").unwrap();
        std::fs::write(from.join("setup.lbm"), "x").unwrap();
        std::fs::write(from.join("leiame.txt"), "x").unwrap();

        let n = copy_glob(&from, &to, &["bbm", "lbm"]).unwrap();

        assert_eq!(n, 2);
        assert!(to.join("pal0.bbm").is_file());
        assert!(!to.join("leiame.txt").exists(), "txt nao deveria ter sido copiado");

        let _ = std::fs::remove_dir_all(&from);
        let _ = std::fs::remove_dir_all(&to);
    }


    #[test]
    fn assets_incompletos_nao_contam_como_prontos() {
        // Faltando um unico rxx o jogo abre em tela preta. Meio pronto e o pior
        // estado possivel: parece instalado e nao funciona.
        let game = temp_dir("assets-parciais");
        let sprites = game.join("data").join("Sprites");
        std::fs::create_dir_all(&sprites).unwrap();
        for f in ["GUI.rxx", "GUIMain.rxx", "Houses.rxx", "Trees.rxx", "Units.rxx"] {
            std::fs::write(sprites.join(f), "x").unwrap();
        }
        assert!(!assets_ready(&game), "faltando Tileset.rxx nao pode contar como pronto");

        let _ = std::fs::remove_dir_all(&game);
    }
}
