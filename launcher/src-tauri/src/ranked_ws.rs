//! Canal de tempo real da fila e do lobby de bans.
//!
//! O socket vive aqui, no Rust, pelo mesmo motivo de todo o HTTP viver em
//! `auth.rs`: ele é autenticado com o token de sessão, e o token não pode
//! chegar à webview. A tela recebe cada mensagem como evento Tauri, no formato
//! exato das rotas de poll — quem interpreta o conteúdo é `src/api.ts`.
//!
//! **O poll continua existindo.** Este canal é o caminho rápido, não o único:
//! quem está numa fila de ranqueada não pode ficar cego porque a rede oscilou.
//! É para isso que serve o evento `conexao` — é ele que diz à tela quando ligar
//! e desligar o poll de reserva.

use std::sync::Mutex;
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, State};
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::Message;

use crate::auth::{require_token, AppState};

/// Um evento só. O `tipo` dentro do JSON distingue `fila`, `lobby` e `conexao`.
const EVENTO: &str = "ranked://tempo-real";

const CAMINHO: &str = "/ranked/tempo-real";

/// O que a API aceita como "me manda o estado atual".
const SYNC: &str = "sync";

/// Teto da espera entre tentativas. Antes dele a espera dobra: 1, 2, 4, 8...
const ESPERA_MAXIMA: Duration = Duration::from_secs(30);

/// Teto do handshake.
///
/// Sem isto o canal some para sempre em silêncio: `connect_async` não tem
/// prazo próprio, e uma API que aceita o TCP e nunca responde ao upgrade
/// deixa esta tarefa pendurada. `ranked_ws_start` vê a tarefa viva, considera
/// o canal ligado e nunca tenta de novo — nem quando a API volta. E isso
/// **não** é hipótese: com `RANKED_ENABLED=false` a rota não existe, e sob o
/// Bun um GET com `Upgrade: websocket` numa rota inexistente não recebe
/// resposta nenhuma; o socket fica aberto e mudo.
const TEMPO_DE_HANDSHAKE: Duration = Duration::from_secs(15);

/// O socket em curso e a sessão que o abriu.
///
/// Estático porque `AppState` mora em `auth.rs` e este módulo não tem por que
/// forçar um campo novo lá para guardar um handle. O token vem junto para
/// detectar troca de conta — ver `ranked_ws_start`.
static TAREFA: Mutex<Option<(String, tauri::async_runtime::JoinHandle<()>)>> = Mutex::new(None);

/// `https://api` → `wss://api/ranked/tempo-real`, `http://` → `ws://`.
///
/// Sem esquema assume TLS: errar para o lado seguro aqui custa uma falha de
/// conexão; errar para o outro manda o token de sessão em texto claro.
fn url_do_socket(base: &str) -> String {
    let base = base.trim_end_matches('/');

    let base = if let Some(resto) = base.strip_prefix("https://") {
        format!("wss://{resto}")
    } else if let Some(resto) = base.strip_prefix("http://") {
        format!("ws://{resto}")
    } else {
        format!("wss://{base}")
    };

    format!("{base}{CAMINHO}")
}

/// Espera crescente entre tentativas, com teto.
///
/// A primeira queda espera 1 s porque a maioria é oscilação de rede ou deploy da
/// API — e insistir de imediato só transformaria a queda de um jogador numa
/// enxurrada de handshakes contra uma API que ainda está subindo.
fn espera(tentativa: u32) -> Duration {
    ESPERA_MAXIMA.min(Duration::from_secs(1 << tentativa.min(5)))
}

fn avisar(app: &AppHandle, carga: Value) {
    // Falha de emissão significa janela fechando: não há a quem avisar, e
    // derrubar o laço por isso deixaria o socket aberto sem ninguém do outro lado.
    if let Err(e) = app.emit(EVENTO, carga) {
        eprintln!("aviso: não foi possível emitir evento do tempo real: {e}");
    }
}

/// Uma conexão, do handshake até a queda. `Ok` = caiu depois de ter funcionado.
async fn sessao(app: &AppHandle, url: &str, token: &str) -> Result<(), String> {
    let mut pedido = url
        .into_client_request()
        .map_err(|e| format!("endereço do canal inválido: {e}"))?;

    // Mesmo Bearer das rotas normais, e no cabeçalho — nunca na querystring, que
    // acaba em log de proxy e em histórico.
    let bearer = format!("Bearer {token}")
        .parse()
        .map_err(|_| "token inválido para o cabeçalho".to_string())?;
    pedido.headers_mut().insert("authorization", bearer);

    let (mut socket, _) = tokio::time::timeout(TEMPO_DE_HANDSHAKE, tokio_tungstenite::connect_async(pedido))
        .await
        .map_err(|_| "o canal não respondeu ao handshake a tempo".to_string())?
        .map_err(|e| format!("não foi possível abrir o canal: {e}"))?;

    // Reconectou: pede o estado atual em vez de supor que nada mudou enquanto
    // esteve fora. Um ban pode ter passado, o mapa pode ter sido sorteado e a
    // sala pode já estar de pé.
    socket
        .send(Message::text(SYNC))
        .await
        .map_err(|e| format!("canal abriu mas não aceitou o pedido de estado: {e}"))?;

    avisar(app, json!({ "tipo": "conexao", "ligado": true }));

    while let Some(recebida) = socket.next().await {
        match recebida.map_err(|e| format!("canal caiu: {e}"))? {
            Message::Text(texto) => match serde_json::from_str::<Value>(&texto) {
                Ok(evento) => avisar(app, evento),
                // Mensagem ilegível é bug da API, não motivo para derrubar o
                // canal e deixar o jogador sem lobby.
                Err(e) => eprintln!("aviso: mensagem ilegível no tempo real: {e}"),
            },
            Message::Close(_) => break,
            // Ping/pong a própria lib responde.
            _ => {}
        }
    }

    Ok(())
}

async fn laco(app: AppHandle, url: String, token: String) {
    let mut tentativa = 0u32;

    loop {
        match sessao(&app, &url, &token).await {
            // Caiu depois de ter funcionado (deploy da API, proxy reciclando):
            // a espera volta ao mínimo, porque a última tentativa deu certo.
            Ok(()) => tentativa = 0,
            Err(erro) => {
                eprintln!("tempo real: {erro}");
                tentativa = tentativa.saturating_add(1);
            }
        }

        // A tela precisa saber para voltar ao poll. Sem isto o jogador ficaria
        // olhando um lobby congelado sem nenhum sinal de que está congelado.
        avisar(&app, json!({ "tipo": "conexao", "ligado": false }));
        tokio::time::sleep(espera(tentativa)).await;
    }
}

/// Liga o canal. Idempotente: chamar de novo com o socket vivo não faz nada.
#[tauri::command]
pub async fn ranked_ws_start(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let token = require_token(&state)?;
    let url = url_do_socket(&state.api_base());

    // A árvore tem aws-lc-rs e ring compilados juntos (reqwest e quinn), e nesse
    // caso o rustls se recusa a escolher sozinho: sem esta linha o primeiro
    // wss:// entraria em pânico dentro da tarefa. Já instalado devolve Err, e é
    // exatamente o que queremos ignorar.
    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();

    let mut atual = TAREFA.lock().expect("mutex do tempo real envenenado");

    if let Some((aberto_com, tarefa)) = atual.as_ref() {
        if *aberto_com == token && !tarefa.inner().is_finished() {
            return Ok(());
        }
        // Sessão diferente: derruba a antiga. Sem isto, sair e entrar com outra
        // conta no mesmo launcher entregaria os eventos da conta anterior à tela
        // da nova — e o socket velho seguiria autenticado como quem já saiu.
        tarefa.abort();
    }

    *atual = Some((token.clone(), tauri::async_runtime::spawn(laco(app, url, token))));
    Ok(())
}

/// Desliga o canal — logout, ou sair das telas de ranqueada.
///
/// Importa no logout: com a sessão revogada o socket seria recusado para sempre,
/// e o laço ficaria batendo na API de 30 em 30 segundos até fechar o launcher.
#[tauri::command]
pub fn ranked_ws_stop() {
    if let Some((_, tarefa)) = TAREFA.lock().expect("mutex do tempo real envenenado").take() {
        tarefa.abort();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn traduz_o_endereco_da_api_para_o_do_socket() {
        assert_eq!(
            url_do_socket("https://kam-api.melhorzin.com"),
            "wss://kam-api.melhorzin.com/ranked/tempo-real"
        );
        // Desenvolvimento: sem TLS, senão o launcher local não conecta em nada.
        assert_eq!(
            url_do_socket("http://localhost:3000"),
            "ws://localhost:3000/ranked/tempo-real"
        );
        // Barra sobrando não pode virar caminho duplo.
        assert_eq!(
            url_do_socket("https://kam-api.melhorzin.com/"),
            "wss://kam-api.melhorzin.com/ranked/tempo-real"
        );
        // Sem esquema, assume TLS: o token viaja nesta conexão.
        assert!(url_do_socket("kam-api.melhorzin.com").starts_with("wss://"));
    }

    /// Abre o canal de verdade contra a API rodando em localhost:3000.
    ///
    /// `url_do_socket` comparar strings prova pouco: o que quebra em produção é
    /// o caminho não existir na API, o Bearer não ser aceito no upgrade, ou o
    /// anônimo passar. Só um handshake real responde as três. Para rodar:
    ///
    ///   cd brasil/api && bun run dev
    ///   cd brasil/launcher/src-tauri && cargo test -- --ignored --nocapture
    #[tokio::test]
    #[ignore]
    async fn abre_o_canal_contra_api_real() {
        let base = "http://localhost:3000";
        let api = crate::auth::ApiClient::new(base);

        let suffix = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs()
            % 100_000;
        let nickname = format!("wsrust{suffix}");
        let senha = "senha-de-teste-integracao";
        api.register(&format!("{nickname}@kambrasil.test"), &nickname, senha)
            .await
            .expect("registro deveria funcionar");
        let sessao = api.login(&nickname, senha).await.expect("login deveria funcionar");

        let url = url_do_socket(base);

        // Anônimo não entra: o canal carrega o lobby inteiro.
        let anonimo = tokio::time::timeout(
            TEMPO_DE_HANDSHAKE,
            tokio_tungstenite::connect_async(url.clone()),
        )
        .await
        .expect("a API travou o handshake anônimo em vez de recusá-lo");
        assert!(anonimo.is_err(), "socket sem token deveria ser recusado");

        // Com token: abre, aceita o `sync` e responde com o estado da fila.
        let mut pedido = url.into_client_request().expect("url válida");
        pedido.headers_mut().insert(
            "authorization",
            format!("Bearer {}", sessao.token).parse().unwrap(),
        );
        let (mut socket, _) = tokio::time::timeout(
            TEMPO_DE_HANDSHAKE,
            tokio_tungstenite::connect_async(pedido),
        )
        .await
        .expect("handshake não respondeu a tempo")
        .expect("socket com token deveria abrir");

        socket.send(Message::text(SYNC)).await.expect("sync deveria ser aceito");

        let evento = tokio::time::timeout(Duration::from_secs(10), socket.next())
            .await
            .expect("nenhum evento em 10 s")
            .expect("stream fechou sem evento")
            .expect("mensagem inválida");

        let Message::Text(texto) = evento else {
            panic!("esperava evento em texto, veio {evento:?}")
        };
        let json: Value = serde_json::from_str(&texto).expect("evento deveria ser JSON");
        // `fila` é o primeiro evento de quem acabou de conectar — inclusive
        // fora da fila. É o mesmo formato de `GET /ranked/queue/status`.
        assert_eq!(json["tipo"], "fila", "primeiro evento deveria ser a fila: {texto}");
        assert!(json["aguardando"].is_object(), "faltou `aguardando`: {texto}");
    }

    #[test]
    fn a_espera_cresce_e_para_de_crescer() {
        assert_eq!(espera(0), Duration::from_secs(1));
        assert_eq!(espera(1), Duration::from_secs(2));
        assert_eq!(espera(4), Duration::from_secs(16));
        // Teto: a décima tentativa não pode virar meia hora de silêncio.
        assert_eq!(espera(5), ESPERA_MAXIMA);
        assert_eq!(espera(50), ESPERA_MAXIMA);
    }
}
