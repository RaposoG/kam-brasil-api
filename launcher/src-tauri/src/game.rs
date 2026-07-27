//! Configuração e lançamento do cliente do jogo.
//!
//! Download e versionamento vivem em `install.rs`; geração dos arquivos
//! derivados do jogo original, em `assets.rs`.

use std::path::PathBuf;

use serde::Serialize;
use tauri::State;

use crate::auth::AppState;
use crate::install::game_dir;

const EXE_NAME: &str = "KaM_Remake.exe";

#[derive(Debug, Clone, Serialize)]
pub struct GameStatus {
    pub path: String,
    pub installed: bool,
    pub version: Option<String>,
    pub assets_ready: bool,
}

#[tauri::command]
pub fn game_status() -> GameStatus {
    let dir = game_dir();
    GameStatus {
        path: dir.display().to_string(),
        installed: dir.join(EXE_NAME).is_file(),
        version: crate::install::read_installed(&dir).map(|i| i.version),
        assets_ready: crate::assets::assets_ready(&dir),
    }
}

/// A pasta de configurações que **todas** as instalações de KaM Remake do
/// usuário compartilham: `Documentos\My Games\Knights and Merchants Remake\`.
///
/// Não escrevemos mais aqui — só limpamos o que já escrevemos (ver
/// `reparar_configuracao_compartilhada`). Nossa build usa a própria pasta,
/// porque `USE_KMR_DIR_FOR_SETTINGS` está ligado nela.
///
/// Usa a API de pastas conhecidas em vez de montar `%USERPROFILE%\Documents`,
/// porque Documentos pode estar redirecionado (OneDrive, por exemplo).
fn pasta_compartilhada_do_kam() -> Option<PathBuf> {
    dirs::document_dir().map(|d| d.join("My Games").join("Knights and Merchants Remake"))
}

/// Desfaz o estrago que versões anteriores deste launcher causaram.
///
/// Até a 1.0.1 gravávamos o master server na pasta compartilhada acima. Como ela
/// vale para **qualquer** instalação de KaM Remake da máquina, quem tinha o KaM
/// oficial ao lado do nosso passava a ver só os servidores do Kam Brasil na
/// lista de multiplayer — para sempre, mesmo abrindo o outro jogo.
///
/// Removemos a linha apenas se o valor for o nosso: apagar um master server que
/// a pessoa configurou à mão seria trocar um estrago por outro. Sem a linha, o
/// KaM volta ao padrão dele (`http://master.kamremake.com/`).
fn reparar_configuracao_compartilhada(api_base: &str) {
    let Some(dir) = pasta_compartilhada_do_kam() else { return };
    let ini = dir.join("KaM Remake Server Settings.ini");

    let Ok(conteudo) = std::fs::read_to_string(&ini) else { return };

    let nosso = master_url(api_base);
    let mut mexeu = false;
    let limpo: Vec<&str> = conteudo
        .lines()
        .filter(|linha| {
            let e_nosso = linha
                .strip_prefix("MasterServerAddressNew=")
                .is_some_and(|v| v.trim().eq_ignore_ascii_case(nosso.trim()));
            if e_nosso {
                mexeu = true;
            }
            !e_nosso
        })
        .collect();

    if mexeu {
        let _ = std::fs::write(&ini, limpo.join("\r\n"));
    }
}

/// Substitui o valor de um atributo dentro de um elemento XML.
///
/// Edição textual pontual em vez de parsear e reescrever o XML: o jogo é dono
/// desse arquivo e reescreve-o inteiro ao sair. Preservar tudo que não é nosso
/// é mais seguro que reserializar.
fn replace_xml_attr(content: &str, element: &str, attr: &str, value: &str) -> Option<String> {
    let block_start = content.find(element)?;
    let block_end = content[block_start..].find('>').map(|i| block_start + i)?;
    let needle = format!("{attr}=\"");
    let attr_start = content[block_start..block_end].find(&needle)?;

    let value_start = block_start + attr_start + needle.len();
    let value_len = content[value_start..].find('"')?;

    let mut updated = String::with_capacity(content.len());
    updated.push_str(&content[..value_start]);
    updated.push_str(value);
    updated.push_str(&content[value_start + value_len..]);
    Some(updated)
}

/// Endereço do master server, sempre em **HTTP puro** — de propósito.
///
/// `KM_HTTPClientOverbyte` usa o `THTTPCli` do ICS sem `SslContext` nenhum: não
/// existe uma linha de SSL em todo o cliente HTTP do jogo. Uma URL `https` faz
/// ele abortar com "SSL requires a context object" e a lista de servidores nunca
/// carrega. O default do próprio KaM é `http://master.kamremake.com/` — o
/// ecossistema inteiro fala plaintext aqui.
///
/// O que trafega assim é só a **lista pública de servidores**. Conta, senha e
/// ticket de jogo passam pelo launcher, que fala HTTPS de verdade — e o
/// `/auth/verify` só aceita 127.0.0.1, então nunca cruza a internet.
fn master_url(api_base: &str) -> String {
    let base = api_base.trim_end_matches('/');
    let host = base
        .strip_prefix("https://")
        .or_else(|| base.strip_prefix("http://"))
        .unwrap_or(base);
    format!("http://{host}/")
}

/// Aponta o jogo para a nossa infraestrutura antes de lançá-lo.
///
/// - **Nickname** em `KaM Remake Settings.xml`. É conveniência: quem manda de
///   verdade é o servidor, que impõe o nome da conta ao conectar.
/// - **Master server** em `KaM Remake Server Settings.ini`. Sem isto o jogo
///   lista os servidores oficiais em vez dos nossos.
fn configure_game(nickname: &str, api_base: &str) -> Result<(), String> {
    // Tira o nosso master server da pasta compartilhada, se alguma versão
    // anterior o tiver deixado lá.
    reparar_configuracao_compartilhada(api_base);

    // Daqui em diante, só a pasta do jogo. A build do Kam Brasil lê daqui
    // (USE_KMR_DIR_FOR_SETTINGS), então nada que escrevemos afeta outra
    // instalação de KaM Remake da máquina.
    let dir = game_dir();
    std::fs::create_dir_all(&dir).map_err(|e| format!("não foi possível criar {}: {e}", dir.display()))?;

    let xml_path = dir.join("KaM Remake Settings.xml");
    match std::fs::read_to_string(&xml_path) {
        Ok(content) => {
            if let Some(updated) = replace_xml_attr(&content, "<Multiplayer", "Name", nickname) {
                std::fs::write(&xml_path, updated)
                    .map_err(|e| format!("não foi possível gravar o nickname: {e}"))?;
            }
        }
        Err(_) => {
            // Primeira execução: o jogo ainda não criou o arquivo. Criamos o
            // mínimo; ele preenche o resto com os padrões e regrava ao sair.
            let minimal = format!(
                "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<Root>\n  <Game>\n    <Multiplayer Name=\"{nickname}\"/>\n  </Game>\n</Root>\n"
            );
            std::fs::write(&xml_path, minimal)
                .map_err(|e| format!("não foi possível criar as configurações do jogo: {e}"))?;
        }
    }

    let ini_path = dir.join("KaM Remake Server Settings.ini");
    let master = master_url(api_base);
    let ini = match std::fs::read_to_string(&ini_path) {
        Ok(content) if content.contains("MasterServerAddressNew=") => content
            .lines()
            .map(|line| {
                if line.starts_with("MasterServerAddressNew=") {
                    format!("MasterServerAddressNew={master}")
                } else {
                    line.to_string()
                }
            })
            .collect::<Vec<_>>()
            .join("\r\n"),
        Ok(content) => format!("{}\r\nMasterServerAddressNew={master}", content.trim_end()),
        Err(_) => format!("[Server]\r\nMasterServerAddressNew={master}\r\n"),
    };

    std::fs::write(&ini_path, ini).map_err(|e| format!("não foi possível apontar o master server: {e}"))?;

    Ok(())
}

#[tauri::command]
pub async fn launch_game(state: State<'_, AppState>) -> Result<(), String> {
    let dir = game_dir();
    let exe = dir.join(EXE_NAME);

    if !exe.is_file() {
        return Err(format!("{EXE_NAME} não encontrado em {}", dir.display()));
    }

    if !crate::assets::assets_ready(&dir) {
        return Err("os arquivos do jogo original ainda não foram gerados".into());
    }

    if let Some(nickname) = state.nickname() {
        // Falhar aqui não impede de jogar — só significa que o jogo abre com a
        // configuração anterior.
        if let Err(e) = configure_game(&nickname, &state.api_base()) {
            eprintln!("aviso: {e}");
        }
    }

    let mut command = std::process::Command::new(&exe);
    command.current_dir(&dir);

    // Entrega da credencial: arquivo temporário cujo caminho vai por variável de
    // ambiente. NÃO por argumento de linha de comando — argumentos aparecem na
    // lista de processos para qualquer usuário da máquina.
    //
    // O que vai no arquivo é um **ticket de partida**, não o token de sessão: se
    // vazasse, não daria acesso à conta. O jogo apaga o arquivo assim que o lê.
    let token_path = std::env::temp_dir().join("kambrasil-session.token");
    match state.play_ticket().await {
        Some(ticket) => {
            tokio::fs::write(&token_path, ticket)
                .await
                .map_err(|e| format!("não foi possível preparar a sessão do jogo: {e}"))?;
            command.env("KAMBRASIL_TOKEN_FILE", &token_path);
        }
        None => {
            // Deixar um arquivo velho para trás faria o jogo usar a credencial
            // de outro login.
            let _ = tokio::fs::remove_file(&token_path).await;
        }
    }

    command
        .spawn()
        .map_err(|e| format!("não foi possível abrir o jogo: {e}"))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Uma URL https aqui trava o multiplayer inteiro: o cliente do jogo aborta
    /// com "SSL requires a context object" e nao lista servidor nenhum.
    /// O reparo so pode remover a linha que NOS escrevemos. Apagar um master
    /// server que a pessoa configurou a mao trocaria um estrago por outro.
    #[test]
    fn reparo_remove_so_o_nosso_master_server() {
        let nosso = master_url("https://kam-api.melhorzin.com");
        let alheio = "http://master.kamremake.com/";

        let filtrar = |conteudo: &str| -> Vec<String> {
            conteudo
                .lines()
                .filter(|l| {
                    !l.strip_prefix("MasterServerAddressNew=")
                        .is_some_and(|v| v.trim().eq_ignore_ascii_case(nosso.trim()))
                })
                .map(String::from)
                .collect()
        };

        let com_o_nosso = format!("[Server]\r\nServerName=Teste\r\nMasterServerAddressNew={nosso}\r\nMaxRooms=8");
        let r = filtrar(&com_o_nosso);
        assert_eq!(r.len(), 3, "so a nossa linha deveria sair");
        assert!(r.iter().any(|l| l.starts_with("ServerName=")), "o resto tem que ficar");
        assert!(r.iter().any(|l| l.starts_with("MaxRooms=")));

        let com_o_dele = format!("[Server]\r\nMasterServerAddressNew={alheio}\r\nMaxRooms=8");
        let r = filtrar(&com_o_dele);
        assert!(
            r.iter().any(|l| l.contains(alheio)),
            "master server de terceiro NAO pode ser removido"
        );
    }

    #[test]
    fn master_server_nunca_sai_em_https() {
        assert_eq!(master_url("https://kam-api.melhorzin.com"), "http://kam-api.melhorzin.com/");
        assert_eq!(master_url("https://kam-api.melhorzin.com/"), "http://kam-api.melhorzin.com/");
        assert_eq!(master_url("http://localhost:3000"), "http://localhost:3000/");
    }

    #[test]
    fn troca_nickname_preservando_o_resto_do_xml() {
        let xml = r#"<Root><Game><Multiplayer Name="NoName" LastIP="127.0.0.1"/><Misc A="1"/></Game></Root>"#;
        let updated = replace_xml_attr(xml, "<Multiplayer", "Name", "Raposo").unwrap();

        assert!(updated.contains(r#"Name="Raposo""#), "nickname nao trocado: {updated}");
        assert!(updated.contains(r#"LastIP="127.0.0.1""#), "atributo vizinho deveria sobreviver");
        assert!(updated.contains(r#"<Misc A="1"/>"#), "o resto do XML deveria ficar intacto");
    }

    #[test]
    fn nao_confunde_atributo_de_outro_elemento() {
        // "Name" aparece antes, noutro elemento. A troca tem que acontecer
        // dentro do Multiplayer, senao gravariamos o nick no lugar errado.
        let xml = r#"<Root><Menu Name="algo"/><Multiplayer Name="NoName"/></Root>"#;
        let updated = replace_xml_attr(xml, "<Multiplayer", "Name", "Raposo").unwrap();

        assert!(updated.contains(r#"<Menu Name="algo"/>"#), "elemento anterior foi alterado: {updated}");
        assert!(updated.contains(r#"<Multiplayer Name="Raposo"/>"#), "nickname nao trocado: {updated}");
    }

    #[test]
    fn atributo_ausente_devolve_none() {
        let xml = r#"<Root><Multiplayer LastIP="127.0.0.1"/></Root>"#;
        assert!(replace_xml_attr(xml, "<Multiplayer", "Name", "Raposo").is_none());
    }

    #[test]
    fn caminho_do_jogo_fica_em_localappdata() {
        // Nao pode ser Arquivos de Programas: escrever la exige elevacao, e um
        // launcher que pede UAC a cada atualizacao nao atualiza sozinho.
        std::env::remove_var("KAMBRASIL_GAME_DIR");
        let dir = game_dir();
        let s = dir.display().to_string();
        assert!(s.contains("KamBrasil"), "caminho inesperado: {s}");
        assert!(!s.contains("Program Files"), "nao deveria instalar em Program Files: {s}");
    }
}
