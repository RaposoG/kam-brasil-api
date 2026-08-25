//! Chamados de suporte: abrir, listar, conversar e fechar.
//!
//! Mesma casca de `matches.rs`: o HTTP de verdade vive em `auth.rs`, porque o
//! token de sessão nunca pode chegar ao JavaScript. As respostas trafegam como
//! JSON cru — quem entende o formato é `src/api.ts`.
//!
//! Só o lado do JOGADOR mora aqui. A caixa de entrada do painel usa as rotas
//! `/admin/chamados*` pelo `admin_call` de `admin.rs`, que já cobre qualquer
//! rota do painel sem comando novo.

use reqwest::Method;
use serde_json::{json, Value};
use tauri::State;

use crate::auth::{require_token, AppState};

/// O id vem da webview e vai concatenado num caminho: um `&` ou uma barra aqui
/// viraria outra rota. Um uuid só tem hexadecimal e hífen (ver `matches.rs`).
fn uuid_valido(id: &str) -> Result<&str, String> {
    if id.len() == 36 && id.chars().all(|c| c.is_ascii_hexdigit() || c == '-') {
        Ok(id)
    } else {
        Err(format!("identificador inválido: {id:?}"))
    }
}

async fn pedir(state: &AppState, method: Method, path: &str, body: Option<Value>) -> Result<Value, String> {
    let token = require_token(state)?;
    state.api().json_request(&token, method, path, body).await
}

#[tauri::command]
pub async fn chamados_list(state: State<'_, AppState>) -> Result<Value, String> {
    pedir(&state, Method::GET, "/chamados", None).await
}

#[tauri::command]
pub async fn chamado_abrir(
    state: State<'_, AppState>,
    tipo: String,
    titulo: String,
    mensagem: String,
) -> Result<Value, String> {
    // Validação fina é da API (zod); aqui só não mandamos um corpo malformado.
    pedir(
        &state,
        Method::POST,
        "/chamados",
        Some(json!({ "tipo": tipo, "titulo": titulo, "mensagem": mensagem })),
    )
    .await
}

#[tauri::command]
pub async fn chamado_ver(state: State<'_, AppState>, id: String) -> Result<Value, String> {
    let id = uuid_valido(&id)?;
    pedir(&state, Method::GET, &format!("/chamados/{id}"), None).await
}

#[tauri::command]
pub async fn chamado_responder(
    state: State<'_, AppState>,
    id: String,
    mensagem: String,
) -> Result<Value, String> {
    let id = uuid_valido(&id)?;
    pedir(
        &state,
        Method::POST,
        &format!("/chamados/{id}/mensagens"),
        Some(json!({ "mensagem": mensagem })),
    )
    .await
}

#[tauri::command]
pub async fn chamado_fechar(state: State<'_, AppState>, id: String) -> Result<Value, String> {
    let id = uuid_valido(&id)?;
    pedir(&state, Method::POST, &format!("/chamados/{id}/fechar"), None).await
}

#[cfg(test)]
mod tests {
    use super::uuid_valido;

    #[test]
    fn uuid_bom_passa_e_lixo_nao() {
        assert!(uuid_valido("44444444-4444-4444-8444-444444444444").is_ok());
        assert!(uuid_valido("../admin/chamados").is_err());
        assert!(uuid_valido("44444444-4444-4444-8444-44444444444?").is_err());
        assert!(uuid_valido("").is_err());
    }
}
