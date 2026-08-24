//! Localiza a instalação do **KaM Remake**.
//!
//! Antes procurávamos o Knights and Merchants original e derivávamos tudo dele:
//! empacotávamos sprites com o RXXPacker, convertíamos vozes de `.snd` para
//! `.wav`, renomeávamos músicas. Cada jogador produzia os próprios arquivos.
//!
//! Isso era a causa raiz de dois problemas sérios:
//!
//! - **Desync.** `houses.dat` e `unit.dat` do original definem as regras de
//!   casas e unidades, e o KaM Remake as rebalanceou. Cada edição do jogo de
//!   1998 tem as suas, então cada jogador simulava diferente e a partida
//!   divergia no meio.
//! - **Sprites errados.** O `.rxx` que gerávamos localmente não é o mesmo que o
//!   KaM Remake distribui — daí a mina de ferro aparecer na versão antiga.
//!
//! O KaM Remake já traz tudo pronto e igual para todo mundo: sprites
//! empacotados, vozes em `.wav` na pasta com sufixo de idioma, músicas em
//! `.mp2` e as regras rebalanceadas. Copiar de lá elimina a geração local
//! inteira -- e, mais importante, faz os arquivos de todos serem idênticos.
//!
//! A detecção é uma sequência de palpites seguida de **validação**: só aceitamos
//! uma pasta se os arquivos que realmente vamos usar estiverem lá. Palpite que
//! não valida é palpite descartado.

use std::path::{Path, PathBuf};

use serde::Serialize;

/// Arquivos que o Kam Brasil precisa da instalação do KaM Remake. A presença de
/// todos é o que define uma pasta como válida — não o nome dela.
///
/// Escolhidos para distinguir o KaM Remake do jogo original: `data/Sprites`
/// só existe no Remake (o original tem `data/gfx/res/*.rx` crus), e
/// `speech.eng` com sufixo de idioma também.
const REQUIRED: &[&str] = &[
    "data/Sprites/GUI.rxx",
    "data/Sprites/Houses.rxx",
    "data/Sprites/Units.rxx",
    "data/Sprites/Tileset.rxx",
    "data/defines/houses.dat",
    "data/defines/unit.dat",
    "data/sfx/sounds.dat",
    "data/gfx/pal0.bbm",
];

#[derive(Debug, Clone, Serialize)]
pub struct OriginalGame {
    pub path: String,
    /// Como foi encontrada — útil para a UI explicar ao jogador.
    pub source: String,
}

/// Uma pasta serve se contém tudo que vamos ler dela.
///
/// Comparar por nome de pasta seria frágil: instalações vêm de CD, GOG, Steam e
/// de pastas renomeadas à mão, cada uma com um nome diferente.
pub fn is_valid_install(dir: &Path) -> bool {
    REQUIRED.iter().all(|rel| dir.join(rel).is_file())
}

/// Lê o caminho de uma biblioteca Steam a partir do `libraryfolders.vdf`.
///
/// Formato simplificado: linhas `"path"  "C:\\algum\\lugar"`. Não vale trazer um
/// parser de VDF para extrair um campo.
fn steam_libraries(vdf: &str) -> Vec<PathBuf> {
    vdf.lines()
        .filter_map(|line| {
            let line = line.trim();
            let rest = line.strip_prefix("\"path\"")?;
            let start = rest.find('"')? + 1;
            let end = rest[start..].find('"')? + start;
            Some(PathBuf::from(rest[start..end].replace("\\\\", "\\")))
        })
        .collect()
}

fn candidates() -> Vec<(PathBuf, String)> {
    let mut found: Vec<(PathBuf, String)> = Vec::new();

    // Override explícito ganha de tudo: é a saída para instalações exóticas.
    // O nome da variável ficou de quando procurávamos o jogo original; mantido
    // para não quebrar quem já a configurou.
    for var in ["KAMBRASIL_REMAKE_DIR", "KAMBRASIL_ORIGINAL_DIR"] {
        if let Ok(dir) = std::env::var(var) {
            found.push((PathBuf::from(dir), "variável de ambiente".into()));
        }
    }

    let nomes = [
        "KaM Remake",
        "KaMRemake",
        "Knights and Merchants Remake",
        "KaM_Remake",
    ];

    // O instalador oficial sugere C:\KaM Remake, fora de Arquivos de Programas
    // -- o jogo grava saves e configuracoes ao lado do executavel, e ali isso
    // exigiria elevacao.
    for raiz in ["C:\\", "D:\\", "E:\\"] {
        for nome in &nomes {
            found.push((PathBuf::from(raiz).join(nome), "raiz do disco".into()));
        }
        found.push((PathBuf::from(raiz).join("Games").join("KaM Remake"), "pasta Games".into()));
    }

    let program_files: Vec<PathBuf> = ["ProgramFiles(x86)", "ProgramFiles", "ProgramW6432"]
        .iter()
        .filter_map(|var| std::env::var(var).ok())
        .map(PathBuf::from)
        .collect();

    for base in &program_files {
        for nome in &nomes {
            found.push((base.join(nome), "Arquivos de Programas".into()));
        }
    }

    // Instalado dentro da pasta do jogo original, que e o que o instalador do
    // KaM Remake faz quando o jogador aponta a instalacao existente.
    for base in &program_files {
        for antigo in ["KaM - The Peasants Rebellion", "Knights and Merchants"] {
            found.push((base.join(antigo), "sobre o jogo original".into()));
            for nome in &nomes {
                found.push((base.join(antigo).join(nome), "sobre o jogo original".into()));
            }
        }
    }


    // Steam: quem comprou o KaM ali pode ter instalado o Remake por cima, ou
    // numa subpasta. Percorremos as bibliotecas declaradas, nao so a padrao.
    for base in &program_files {
        let vdf = base.join("Steam").join("steamapps").join("libraryfolders.vdf");
        let Ok(conteudo) = std::fs::read_to_string(&vdf) else { continue };
        for lib in steam_libraries(&conteudo) {
            let comum = lib.join("steamapps").join("common");
            for antigo in ["Knights and Merchants", "KaM - The Peasants Rebellion"] {
                found.push((comum.join(antigo), "Steam".into()));
                for nome in &nomes {
                    found.push((comum.join(antigo).join(nome), "Steam".into()));
                }
            }
        }
    }
    found
}

/// Procura a instalação original. `None` = precisa perguntar ao jogador.
#[tauri::command]
pub fn find_original_game() -> Option<OriginalGame> {
    candidates().into_iter().find_map(|(dir, source)| {
        if is_valid_install(&dir) {
            Some(OriginalGame { path: dir.display().to_string(), source })
        } else {
            None
        }
    })
}

/// Valida uma pasta escolhida à mão pelo jogador.
#[tauri::command]
pub fn check_original_game(path: String) -> Result<OriginalGame, String> {
    let dir = PathBuf::from(&path);

    if !dir.is_dir() {
        return Err("essa pasta não existe".into());
    }

    if !is_valid_install(&dir) {
        // Diz o que faltou em vez de um "inválido" seco: quase sempre o jogador
        // apontou para a pasta de cima ou para um atalho.
        let missing: Vec<&str> = REQUIRED.iter().copied().filter(|rel| !dir.join(rel).is_file()).collect();
        return Err(format!(
            "não parece uma instalação do Knights and Merchants — não encontrei: {}",
            missing.join(", ")
        ));
    }

    Ok(OriginalGame { path, source: "escolhida por você".into() })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("kambrasil-orig-{name}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn fake_install(dir: &Path, skip: &[&str]) {
        for rel in REQUIRED {
            if skip.contains(rel) {
                continue;
            }
            let path = dir.join(rel);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(&path, b"x").unwrap();
        }
    }

    #[test]
    fn instalacao_completa_e_valida() {
        let dir = temp_dir("completa");
        fake_install(&dir, &[]);
        assert!(is_valid_install(&dir));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn faltando_um_arquivo_nao_vale() {
        // Meia instalacao e pior que nenhuma: passaria na deteccao e quebraria
        // so na hora de copiar os arquivos.
        let dir = temp_dir("incompleta");
        fake_install(&dir, &["data/Sprites/Houses.rxx"]);
        assert!(!is_valid_install(&dir));

        let err = check_original_game(dir.display().to_string()).unwrap_err();
        assert!(err.contains("Houses.rxx"), "o erro deveria dizer o que faltou: {err}");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn pasta_inexistente_da_erro_claro() {
        let err = check_original_game("Z:\\nao\\existe".into()).unwrap_err();
        assert!(err.contains("não existe"), "mensagem inesperada: {err}");
    }

    #[test]
    fn le_bibliotecas_do_steam() {
        let vdf = r#"
"libraryfolders"
{
    "0"
    {
        "path"		"C:\\Program Files (x86)\\Steam"
    }
    "1"
    {
        "path"		"D:\\SteamLibrary"
    }
}
"#;
        let libs = steam_libraries(vdf);
        assert_eq!(libs.len(), 2, "deveria achar as duas bibliotecas");
        assert_eq!(libs[1], PathBuf::from("D:\\SteamLibrary"));
    }
}

#[cfg(test)]
mod deteccao_real {
    /// Roda contra a instalacao de verdade desta maquina. Deteccao que passa nos
    /// diretorios falsos do teste mas erra no KaM Remake real nao serve de nada.
    #[test]
    fn encontra_o_kam_remake_desta_maquina() {
        let achado = super::find_original_game();
        match achado {
            Some(g) => {
                eprintln!("achou em {} (via {})", g.path, g.source);
                assert!(super::is_valid_install(std::path::Path::new(&g.path)));
            }
            None => {
                // Se C:\KaM Remake existe e nao foi achado, a deteccao esta errada.
                let padrao = std::path::Path::new("C:\\KaM Remake");
                assert!(
                    !padrao.join("data").join("Sprites").join("GUI.rxx").is_file(),
                    "existe KaM Remake em C:\\KaM Remake e a deteccao nao achou"
                );
                eprintln!("sem KaM Remake nesta maquina -- nada a verificar");
            }
        }
    }
}
