//! Envio do replay de uma partida para a API.
//!
//! **Isto é enriquecimento, nunca fonte de verdade.** Quem diz quem ganhou é o
//! servidor dedicado, a única peça do sistema que conhece a identidade
//! autenticada de cada jogador e a única que não tem interesse no resultado. O
//! launcher roda na máquina do jogador — ele tem. Por isso o que sobe daqui vai
//! parar em colunas que não alimentam resultado nem rating (`matches.replayCrc`
//! e `match_players.statsJson`), e a API recusa qualquer campo que cheire a
//! resultado. Se um dia parecer prático "aproveitar" este canal para reportar
//! vitória, a resposta é não.
//!
//! O KaM guarda cada save num diretório próprio: `SavesMP/<nome>/<nome>.bas`,
//! `.rpl` e `.sav` (`TKMSavesCollection.FullPath`, KM_Saves.pas:569). Sobem só
//! o `.bas` (estado inicial, alguns MB) e o `.rpl` (lista de comandos, pequeno)
//! — é o par mínimo para assistir. O `.sav` é o estado final e não serve para
//! reproduzir nada.

use std::path::{Path, PathBuf};

use serde_json::Value;
use tauri::State;

use crate::auth::{require_token, AppState};
use crate::install::game_dir;

/// As duas partes do multipart, na ordem em que são enviadas. Os nomes são o
/// contrato com `api/src/routes/replay.ts` — mudar aqui exige mudar lá.
const PARTES: [&str; 2] = ["bas", "rpl"];

/// Espelha o `LIMITE_BYTES` de `api/src/routes/replay.ts`. Conferir deste lado
/// não é redundância inútil: a API responde 413 sem corpo útil, e o jogador
/// merece saber que o problema é o tamanho do save, não a rede.
const LIMITE_BYTES: u64 = 32 * 1024 * 1024;

/// A pasta do save dentro da instalação — sem tocar em disco.
///
/// `nome` vem da interface, então é entrada não confiável: um `..` aqui
/// escaparia da pasta do jogo e mandaria para a API um arquivo qualquer da
/// máquina do jogador.
pub fn pasta_do_replay(game: &Path, nome: &str) -> Result<PathBuf, String> {
    let limpo = nome.trim();
    if limpo.is_empty()
        || limpo.contains(['/', '\\', ':'])
        || limpo.starts_with('.')
        || limpo.chars().any(|c| c.is_control())
    {
        return Err(format!("nome de replay inválido: {nome:?}"));
    }

    Ok(game.join("SavesMP").join(limpo))
}

/// Lê `.bas` e `.rpl` da pasta do save. Erro nomeia o arquivo que faltou: sem
/// isso o jogador vê "não deu" e não tem o que fazer com a informação.
async fn ler_partes(pasta: &Path, nome: &str) -> Result<Vec<(&'static str, Vec<u8>)>, String> {
    let mut partes = Vec::with_capacity(PARTES.len());
    let mut total = 0u64;

    for ext in PARTES {
        let caminho = pasta.join(format!("{nome}.{ext}"));
        let bytes = tokio::fs::read(&caminho)
            .await
            .map_err(|e| format!("não foi possível ler {}: {e}", caminho.display()))?;

        total += bytes.len() as u64;
        if total > LIMITE_BYTES {
            return Err(format!(
                "replay grande demais: {total} bytes, o limite é {LIMITE_BYTES}"
            ));
        }

        partes.push((ext, bytes));
    }

    Ok(partes)
}

fn contem(agulha: &[u8], palheiro: &[u8]) -> bool {
    palheiro.windows(agulha.len()).any(|janela| janela == agulha)
}

/// Um separador que não exista dentro de nenhum dos arquivos.
///
/// Se o boundary aparecesse no meio do savegame, o outro lado cortaria o corpo
/// ali e receberia um `.bas` truncado. Com nanossegundos no meio isso já é
/// praticamente impossível; a conferência custa um passe pelos bytes e tira o
/// "praticamente".
/// Recebe os conteúdos crus (e não as partes já nomeadas) porque o painel
/// administrativo sobe a pasta de um mapa pelo mesmo caminho — arquivos com
/// outro formato de parte, mesmo risco de colisão.
pub fn boundary_livre(conteudos: &[&[u8]]) -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);

    escolher_boundary(&nanos.to_string(), conteudos)
}

/// Separado de `boundary_livre` só para o teste poder ser determinístico — com
/// o relógio dentro, a repescagem nunca seria exercitada duas vezes igual.
fn escolher_boundary(semente: &str, conteudos: &[&[u8]]) -> String {
    let mut tentativa = 0u32;
    loop {
        let candidato = format!("----KamBrasil-{semente}-{tentativa}");
        if !conteudos
            .iter()
            .any(|bytes| contem(candidato.as_bytes(), bytes))
        {
            return candidato;
        }
        tentativa += 1;
    }
}

/// Monta o corpo `multipart/form-data` na mão.
///
/// ponytail: 15 linhas em vez da feature `multipart` do reqwest, que arrasta
/// `stream` + `mime_guess` para escrever exatamente estes cabeçalhos. Trocar
/// pela feature no dia em que o launcher precisar de upload com progresso ou de
/// arquivo grande demais para caber na memória.
pub fn corpo_multipart(boundary: &str, partes: &[(&str, Vec<u8>)]) -> Vec<u8> {
    let mut corpo = Vec::new();

    for (nome, bytes) in partes {
        corpo.extend_from_slice(
            format!(
                "--{boundary}\r\nContent-Disposition: form-data; name=\"{nome}\"; filename=\"{nome}\"\r\n\
                 Content-Type: application/octet-stream\r\n\r\n"
            )
            .as_bytes(),
        );
        corpo.extend_from_slice(bytes);
        corpo.extend_from_slice(b"\r\n");
    }
    corpo.extend_from_slice(format!("--{boundary}--\r\n").as_bytes());

    corpo
}

/// Empacota o replay `nome` e envia para `POST /matches/:id/replay`.
///
/// Separada do comando Tauri para poder ser exercitada com uma pasta qualquer.
pub async fn enviar_replay(
    base: &str,
    token: &str,
    game: &Path,
    match_id: &str,
    nome: &str,
) -> Result<Value, String> {
    let pasta = pasta_do_replay(game, nome)?;
    let partes = ler_partes(&pasta, nome).await?;

    let conteudos: Vec<&[u8]> = partes.iter().map(|(_, bytes)| bytes.as_slice()).collect();
    let boundary = boundary_livre(&conteudos);
    let corpo = corpo_multipart(&boundary, &partes);

    // Cliente próprio em vez do pool de `ApiClient`: upload de replay acontece
    // uma vez por partida, e o alternativo seria abrir `auth.rs` — arquivo de
    // outra gente — só para acrescentar um método usado por um lugar só.
    let resposta = reqwest::Client::new()
        .post(format!("{}/matches/{match_id}/replay", base.trim_end_matches('/')))
        .bearer_auth(token)
        .header(
            "content-type",
            format!("multipart/form-data; boundary={boundary}"),
        )
        .body(corpo)
        .send()
        .await
        .map_err(|e| format!("não foi possível falar com o servidor: {e}"))?;

    let status = resposta.status();
    let texto = resposta
        .text()
        .await
        .map_err(|e| format!("resposta inesperada do servidor: {e}"))?;

    let json: Value = serde_json::from_str(&texto)
        .map_err(|e| format!("resposta inesperada do servidor: {e}"))?;

    if !status.is_success() {
        // 409 é o caso que vale explicar: o `.bas` é gerado byte-idêntico em
        // todos os clientes de propósito, então divergir dele significa desync
        // ou cliente adulterado — e a API guarda o primeiro, não o último.
        return Err(json
            .get("error")
            .and_then(Value::as_str)
            .map(str::to_string)
            .unwrap_or_else(|| format!("erro inesperado do servidor ({status})")));
    }

    Ok(json)
}

#[tauri::command]
pub async fn upload_replay(
    state: State<'_, AppState>,
    match_id: String,
    nome: String,
) -> Result<Value, String> {
    let token = require_token(&state)?;
    enviar_replay(&state.api_base(), &token, &game_dir(), &match_id, &nome).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nome_de_replay_nao_escapa_da_pasta_do_jogo() {
        let game = Path::new("C:\\jogo");

        assert!(pasta_do_replay(game, "..").is_err());
        assert!(pasta_do_replay(game, "../../Windows").is_err());
        assert!(pasta_do_replay(game, "..\\..\\Windows").is_err());
        assert!(pasta_do_replay(game, "C:\\Windows").is_err());
        assert!(pasta_do_replay(game, "  ").is_err());
        assert!(pasta_do_replay(game, "quebra\nlinha").is_err());

        // O nome que o jogo realmente gera continua passando.
        assert_eq!(
            pasta_do_replay(game, "2026-08-24 21-30-00").unwrap(),
            game.join("SavesMP").join("2026-08-24 21-30-00")
        );
    }

    #[tokio::test]
    async fn le_o_par_bas_rpl_e_reclama_do_que_faltar() {
        let game = std::env::temp_dir().join("kambrasil-replay-teste");
        let pasta = game.join("SavesMP").join("partida");
        let _ = std::fs::remove_dir_all(&game);
        std::fs::create_dir_all(&pasta).unwrap();

        // Só o .sav não serve: sem o .bas não há estado inicial para reproduzir.
        std::fs::write(pasta.join("partida.sav"), b"final").unwrap();
        assert!(ler_partes(&pasta, "partida").await.is_err());

        std::fs::write(pasta.join("partida.bas"), b"inicial").unwrap();
        std::fs::write(pasta.join("partida.rpl"), b"cmds").unwrap();

        let partes = ler_partes(&pasta, "partida").await.unwrap();
        assert_eq!(partes.len(), 2);
        assert_eq!(partes[0], ("bas", b"inicial".to_vec()));
        assert_eq!(partes[1], ("rpl", b"cmds".to_vec()));

        let _ = std::fs::remove_dir_all(&game);
    }

    #[test]
    fn corpo_multipart_sai_byte_a_byte_como_o_rfc_manda() {
        let partes = vec![("bas", vec![1u8, 2]), ("rpl", vec![3u8])];
        let corpo = corpo_multipart("XYZ", &partes);

        let esperado = [
            b"--XYZ\r\nContent-Disposition: form-data; name=\"bas\"; filename=\"bas\"\r\nContent-Type: application/octet-stream\r\n\r\n".to_vec(),
            vec![1, 2],
            b"\r\n--XYZ\r\nContent-Disposition: form-data; name=\"rpl\"; filename=\"rpl\"\r\nContent-Type: application/octet-stream\r\n\r\n".to_vec(),
            vec![3],
            b"\r\n--XYZ--\r\n".to_vec(),
        ]
        .concat();

        assert_eq!(corpo, esperado);
    }

    #[test]
    fn boundary_ocupado_pelo_savegame_e_descartado() {
        // Um savegame que contivesse o separador faria o outro lado cortar o
        // corpo no meio de um `.bas`. O candidato ocupado é pulado.
        let limpo: [&[u8]; 1] = [&[0u8; 8]];
        assert_eq!(escolher_boundary("FIXO", &limpo), "----KamBrasil-FIXO-0");

        let sujo = b"lixo----KamBrasil-FIXO-0lixo".to_vec();
        let ocupado: [&[u8]; 1] = [&sujo];
        assert_eq!(escolher_boundary("FIXO", &ocupado), "----KamBrasil-FIXO-1");

        // E o de produção, com o relógio, também sai livre.
        assert!(!contem(boundary_livre(&limpo).as_bytes(), limpo[0]));
    }
}
