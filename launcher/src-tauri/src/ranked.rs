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
    // Reenviar com os modos novos é como se troca de modo sem perder a espera
    // acumulada — a API atualiza a entrada em vez de criar outra.
    pedir(&state, Method::POST, "/ranked/queue", Some(json!({ "modes": modes }))).await
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
