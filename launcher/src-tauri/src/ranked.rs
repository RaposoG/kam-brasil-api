//! Comandos da ranqueada: fila, lobby de bans e vitrine do rank.
//!
//! Mesma casca de `social.rs` — o HTTP de verdade vive em `auth.rs`, porque o
//! token de sessão nunca pode chegar ao JavaScript.
//!
//! ponytail: as respostas trafegam como JSON cru (`serde_json::Value`). Quem
//! entende o formato é a tela (`src/api.ts`); repetir sete structs aqui seria o
//! mesmo contrato mantido em dois lugares, com o Rust nunca lendo um campo
//! sequer. Tipar aqui só passa a valer se o Rust precisar decidir algo com o
//! conteúdo — hoje ele só repassa.

use reqwest::Method;
use serde_json::{json, Value};
use tauri::State;

use crate::auth::{require_token, AppState};

async fn pedir(
    state: &AppState,
    method: Method,
    path: &str,
    body: Option<Value>,
) -> Result<Value, String> {
    let token = require_token(state)?;
    state.api().json_request(&token, method, path, body).await
}

#[tauri::command]
pub async fn ranked_queue_join(
    state: State<'_, AppState>,
    modes: Vec<String>,
) -> Result<Value, String> {
    // As versões vão junto porque a API recusa quem está desatualizado: numa
    // ranqueada, versão diferente entre jogadores é desync, e desync é rating
    // perdido de quem não fez nada errado.
    //
    // A do jogo sai da instalação, não de uma variável de tela: é o que o
    // jogador vai REALMENTE abrir. A do launcher é a compilada neste binário.
    let game_version = crate::install::read_installed(&crate::install::game_dir())
        .map(|i| i.version)
        .unwrap_or_default();

    pedir(
        &state,
        Method::POST,
        "/ranked/queue",
        Some(json!({
            "modes": modes,
            "gameVersion": game_version,
            "launcherVersion": env!("CARGO_PKG_VERSION"),
        })),
    )
    .await
}

#[tauri::command]
pub async fn ranked_queue_leave(state: State<'_, AppState>) -> Result<(), String> {
    pedir(&state, Method::DELETE, "/ranked/queue", None).await?;
    Ok(())
}

/// Poll de 3 s da tela de fila — e o heartbeat que mantém a entrada viva.
#[tauri::command]
pub async fn ranked_queue_status(state: State<'_, AppState>) -> Result<Value, String> {
    pedir(&state, Method::GET, "/ranked/queue/status", None).await
}

#[tauri::command]
pub async fn ranked_lobby(state: State<'_, AppState>, lobby_id: String) -> Result<Value, String> {
    pedir(&state, Method::GET, &format!("/ranked/lobby/{lobby_id}"), None).await
}

#[tauri::command]
pub async fn ranked_ban(
    state: State<'_, AppState>,
    lobby_id: String,
    map_id: String,
) -> Result<Value, String> {
    pedir(
        &state,
        Method::POST,
        &format!("/ranked/lobby/{lobby_id}/ban"),
        Some(json!({ "mapId": map_id })),
    )
    .await
}

#[tauri::command]
pub async fn ranked_me(state: State<'_, AppState>) -> Result<Value, String> {
    pedir(&state, Method::GET, "/ranked/me", None).await
}

#[tauri::command]
pub async fn ranked_leaderboard(state: State<'_, AppState>) -> Result<Value, String> {
    pedir(&state, Method::GET, "/ranked/leaderboard", None).await
}
