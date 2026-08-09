//! Leitura da instalação local do jogo: saves/replays e mapas instalados.
//!
//! Nada aqui toca a rede — é só varrer a pasta do jogo. Pasta ausente devolve
//! vetor vazio, nunca erro: antes da primeira instalação (ou da primeira
//! partida) essas pastas simplesmente não existem, e isso não é um problema
//! que o jogador possa resolver.

use std::path::Path;

use serde::Serialize;

use crate::install::game_dir;

/// Um save do jogo. `has_replay` = existe o `.rpl` de mesmo nome
/// (`EXT_SAVE_REPLAY` no KM_Defaults) — sem ele o botão "assistir" não serve.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplayEntry {
    pub name: String,
    /// `SP` (Saves/) ou `MP` (SavesMP/).
    pub mode: String,
    pub modified_ms: u64,
    pub size_bytes: u64,
    pub has_replay: bool,
}

/// Um mapa instalado — cada mapa é um subdiretório de Maps/ ou MapsMP/.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalMap {
    pub name: String,
    pub mode: String,
    pub modified_ms: u64,
}

/// mtime em ms desde a epoch; 0 quando o sistema de arquivos não informa.
fn modified_ms(meta: &std::fs::Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn scan_saves(dir: &Path, mode: &str, out: &mut Vec<ReplayEntry>) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        let is_sav = path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.eq_ignore_ascii_case("sav"))
            .unwrap_or(false);
        if !is_sav || !path.is_file() {
            continue;
        }

        let Some(name) = path.file_stem().and_then(|s| s.to_str()) else { continue };
        let meta = entry.metadata().ok();

        out.push(ReplayEntry {
            name: name.to_string(),
            mode: mode.to_string(),
            modified_ms: meta.as_ref().map(modified_ms).unwrap_or(0),
            size_bytes: meta.as_ref().map(|m| m.len()).unwrap_or(0),
            // with_extension aqui é o comportamento desejado: mesmo tronco,
            // extensão trocada — exatamente como o jogo nomeia o par .sav/.rpl.
            has_replay: path.with_extension("rpl").is_file(),
        });
    }
}

/// Separado do comando para ser testável com um diretório qualquer.
pub fn replays_in(game: &Path) -> Vec<ReplayEntry> {
    let mut out = Vec::new();
    scan_saves(&game.join("Saves"), "SP", &mut out);
    scan_saves(&game.join("SavesMP"), "MP", &mut out);
    // Mais recente primeiro: é o save que o jogador veio procurar.
    out.sort_by(|a, b| b.modified_ms.cmp(&a.modified_ms));
    out
}

fn scan_maps(dir: &Path, mode: &str, out: &mut Vec<LocalMap>) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let Some(name) = path.file_name().and_then(|s| s.to_str()) else { continue };

        out.push(LocalMap {
            name: name.to_string(),
            mode: mode.to_string(),
            modified_ms: entry.metadata().ok().as_ref().map(modified_ms).unwrap_or(0),
        });
    }
}

pub fn maps_in(game: &Path) -> Vec<LocalMap> {
    let mut out = Vec::new();
    scan_maps(&game.join("Maps"), "SP", &mut out);
    scan_maps(&game.join("MapsMP"), "MP", &mut out);
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    out
}

#[tauri::command]
pub fn list_replays() -> Vec<ReplayEntry> {
    replays_in(&game_dir())
}

#[tauri::command]
pub fn list_local_maps() -> Vec<LocalMap> {
    maps_in(&game_dir())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("kambrasil-local-{name}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn pasta_inexistente_devolve_vazio() {
        // Antes da primeira instalação nenhuma dessas pastas existe. Isso tem
        // que ser lista vazia na tela, nunca um erro.
        let game = temp_dir("vazio");
        assert!(replays_in(&game).is_empty());
        assert!(maps_in(&game).is_empty());
        let _ = std::fs::remove_dir_all(&game);
    }

    #[test]
    fn saves_com_modo_replay_e_tamanho() {
        let game = temp_dir("saves");
        let sp = game.join("Saves");
        let mp = game.join("SavesMP");
        std::fs::create_dir_all(&sp).unwrap();
        std::fs::create_dir_all(&mp).unwrap();

        std::fs::write(sp.join("campanha.sav"), "12345").unwrap();
        std::fs::write(sp.join("campanha.rpl"), "r").unwrap();
        std::fs::write(mp.join("partida.sav"), "abc").unwrap();
        // Lixo que não pode aparecer na lista.
        std::fs::write(sp.join("leiame.txt"), "x").unwrap();
        std::fs::write(sp.join("orfao.rpl"), "r").unwrap();

        let replays = replays_in(&game);
        assert_eq!(replays.len(), 2, "só .sav conta: {replays:?}");

        let camp = replays.iter().find(|r| r.name == "campanha").unwrap();
        assert_eq!(camp.mode, "SP");
        assert!(camp.has_replay, "tem .rpl de mesmo nome");
        assert_eq!(camp.size_bytes, 5);
        assert!(camp.modified_ms > 0);

        let part = replays.iter().find(|r| r.name == "partida").unwrap();
        assert_eq!(part.mode, "MP");
        assert!(!part.has_replay, "sem .rpl não tem replay");

        let _ = std::fs::remove_dir_all(&game);
    }

    #[test]
    fn saves_vem_do_mais_recente_para_o_mais_antigo() {
        let game = temp_dir("saves-ordem");
        let sp = game.join("Saves");
        std::fs::create_dir_all(&sp).unwrap();

        std::fs::write(sp.join("antigo.sav"), "x").unwrap();
        // Garante mtimes distintos mesmo em sistema de arquivos de resolução baixa.
        std::thread::sleep(std::time::Duration::from_millis(20));
        std::fs::write(sp.join("recente.sav"), "x").unwrap();

        let nomes: Vec<_> = replays_in(&game).into_iter().map(|r| r.name).collect();
        assert_eq!(nomes, vec!["recente", "antigo"]);

        let _ = std::fs::remove_dir_all(&game);
    }

    #[test]
    fn mapas_em_ordem_alfabetica_ignorando_arquivos_soltos() {
        let game = temp_dir("mapas");
        std::fs::create_dir_all(game.join("Maps").join("Zumbido")).unwrap();
        std::fs::create_dir_all(game.join("MapsMP").join("Areia")).unwrap();
        std::fs::create_dir_all(game.join("Maps").join("brejo")).unwrap();
        // Cada mapa é um diretório; arquivo solto na raiz de Maps/ não é mapa.
        std::fs::write(game.join("Maps").join("solto.txt"), "x").unwrap();

        let maps = maps_in(&game);
        let nomes: Vec<_> = maps.iter().map(|m| m.name.as_str()).collect();
        assert_eq!(nomes, vec!["Areia", "brejo", "Zumbido"], "alfabética sem distinguir caixa");
        assert_eq!(maps[0].mode, "MP");
        assert_eq!(maps[2].mode, "SP");

        let _ = std::fs::remove_dir_all(&game);
    }
}
