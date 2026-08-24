//! Leitura da instalação local do jogo: saves/replays e mapas instalados.
//!
//! Nada aqui toca a rede — é só varrer a pasta do jogo. Pasta ausente devolve
//! vetor vazio, nunca erro: antes da primeira instalação (ou da primeira
//! partida) essas pastas simplesmente não existem, e isso não é um problema
//! que o jogador possa resolver.

use std::path::Path;

use serde::Serialize;

use crate::install::game_dir;

/// Um save do jogo. `has_replay` = a pasta tem `.rpl` **e** `.bas`
/// (`EXT_SAVE_REPLAY`/`EXT_SAVE_BASE` no KM_Defaults). Os dois, não só o `.rpl`:
/// é esta flag que libera o botão de enviar em `Replays.vue`, e `enviar_replay`
/// sobe o par — com `.bas` faltando o botão apareceria só para falhar no envio.
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

/// Cada save é uma **pasta** `<dir>/<nome>/`, com `<nome>.sav`, `.rpl` e `.bas`
/// dentro — `TKMSavesCollection.Path` (`src/res/KM_Saves.pas:563`) monta assim, e
/// o próprio scanner do jogo (`:762-764`) procura o trio dentro do diretório.
/// Varrer `*.sav` solto na raiz devolve lista vazia em toda instalação real.
fn scan_saves(dir: &Path, mode: &str, out: &mut Vec<ReplayEntry>) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let pasta = entry.path();
        if !pasta.is_dir() {
            continue;
        }

        let Some(name) = pasta.file_name().and_then(|s| s.to_str()) else { continue };

        // O `.sav` é o que faz do diretório um save. Sem ele não há o que listar
        // — é o caso do `SavesMP/basesave/`, que é estado interno da engine e
        // não uma partida que o jogador salvou.
        let sav = pasta.join(format!("{name}.sav"));
        let Ok(meta) = std::fs::metadata(&sav) else { continue };

        out.push(ReplayEntry {
            name: name.to_string(),
            mode: mode.to_string(),
            // Data e tamanho do `.sav`, não da pasta: a pasta muda de mtime por
            // qualquer arquivo escrito dentro, e ordem por "save mais recente"
            // é o que o jogador espera.
            modified_ms: modified_ms(&meta),
            size_bytes: meta.len(),
            has_replay: pasta.join(format!("{name}.rpl")).is_file()
                && pasta.join(format!("{name}.bas")).is_file(),
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

    /// Monta um save no layout real do jogo: `<dir>/<nome>/<nome>.<ext>`.
    fn gravar_save(dir: &Path, nome: &str, partes: &[(&str, &str)]) {
        let pasta = dir.join(nome);
        std::fs::create_dir_all(&pasta).unwrap();
        for (ext, conteudo) in partes {
            std::fs::write(pasta.join(format!("{nome}.{ext}")), conteudo).unwrap();
        }
    }

    #[test]
    fn saves_com_modo_replay_e_tamanho() {
        let game = temp_dir("saves");
        let sp = game.join("Saves");
        let mp = game.join("SavesMP");
        std::fs::create_dir_all(&sp).unwrap();
        std::fs::create_dir_all(&mp).unwrap();

        gravar_save(&sp, "campanha", &[("sav", "12345"), ("rpl", "r"), ("bas", "b")]);
        gravar_save(&mp, "partida", &[("sav", "abc")]);
        // Lixo que não pode aparecer na lista.
        std::fs::write(sp.join("leiame.txt"), "x").unwrap();
        // Save antigo no layout de arquivo solto: não é assim que o jogo grava.
        std::fs::write(sp.join("solto.sav"), "x").unwrap();
        // `basesave` é estado interno da engine — pasta sem `.sav`, não é partida.
        gravar_save(&mp, "basesave", &[("bas", "b")]);

        let replays = replays_in(&game);
        assert_eq!(replays.len(), 2, "só pasta com .sav conta: {replays:?}");

        let camp = replays.iter().find(|r| r.name == "campanha").unwrap();
        assert_eq!(camp.mode, "SP");
        assert!(camp.has_replay, "tem o par .rpl + .bas");
        assert_eq!(camp.size_bytes, 5, "tamanho é o do .sav, não o da pasta");
        assert!(camp.modified_ms > 0);

        let part = replays.iter().find(|r| r.name == "partida").unwrap();
        assert_eq!(part.mode, "MP");
        assert!(!part.has_replay, "sem .rpl/.bas não dá para assistir nem enviar");

        let _ = std::fs::remove_dir_all(&game);
    }

    #[test]
    fn replay_exige_bas_alem_do_rpl() {
        // O botão de enviar sai desta flag e `enviar_replay` sobe o par: marcar
        // como pronto um save sem `.bas` ofereceria um envio que sempre falha.
        let game = temp_dir("saves-bas");
        let mp = game.join("SavesMP");
        std::fs::create_dir_all(&mp).unwrap();

        gravar_save(&mp, "so_rpl", &[("sav", "x"), ("rpl", "r")]);
        gravar_save(&mp, "completo", &[("sav", "x"), ("rpl", "r"), ("bas", "b")]);

        let replays = replays_in(&game);
        assert!(!replays.iter().find(|r| r.name == "so_rpl").unwrap().has_replay);
        assert!(replays.iter().find(|r| r.name == "completo").unwrap().has_replay);

        let _ = std::fs::remove_dir_all(&game);
    }

    #[test]
    fn saves_vem_do_mais_recente_para_o_mais_antigo() {
        let game = temp_dir("saves-ordem");
        let sp = game.join("Saves");
        std::fs::create_dir_all(&sp).unwrap();

        gravar_save(&sp, "antigo", &[("sav", "x")]);
        // Garante mtimes distintos mesmo em sistema de arquivos de resolução baixa.
        std::thread::sleep(std::time::Duration::from_millis(20));
        gravar_save(&sp, "recente", &[("sav", "x")]);

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
