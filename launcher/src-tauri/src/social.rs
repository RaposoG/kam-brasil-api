//! Comandos sociais: camaradas, taverna (chat) e presença.
//!
//! Só a casca Tauri — o HTTP de verdade vive em `auth.rs` (`ApiClient`), pelo
//! mesmo motivo de sempre: o token nunca chega ao JavaScript. Cada comando pega
//! o token do estado e repassa; sem sessão, devolve erro em vez de bater na API
//! para receber um 401 que diria a mesma coisa.

use tauri::State;

use crate::auth::{require_token, AppState, ChatMessage, FriendsOverview};

#[tauri::command]
pub async fn friends_list(state: State<'_, AppState>) -> Result<FriendsOverview, String> {
    let token = require_token(&state)?;
    state.api().friends_list(&token).await
}

#[tauri::command]
pub async fn friend_add(state: State<'_, AppState>, nickname: String) -> Result<String, String> {
    let token = require_token(&state)?;
    state.api().friend_add(&token, &nickname).await
}

/// Aceitar ou não é a mesma decisão de UI, então é um comando só: recusar é
/// `DELETE /friends/:id`, que também serve para cancelar ou desfazer.
#[tauri::command]
pub async fn friend_respond(
    state: State<'_, AppState>,
    friendship_id: String,
    accept: bool,
) -> Result<(), String> {
    let token = require_token(&state)?;
    if accept {
        state.api().friend_accept(&token, &friendship_id).await
    } else {
        state.api().friend_remove(&token, &friendship_id).await
    }
}

#[tauri::command]
pub async fn chat_fetch(
    state: State<'_, AppState>,
    after: Option<i64>,
) -> Result<Vec<ChatMessage>, String> {
    let token = require_token(&state)?;
    state.api().chat_fetch(&token, after).await
}

#[tauri::command]
pub async fn chat_send(state: State<'_, AppState>, body: String) -> Result<ChatMessage, String> {
    let token = require_token(&state)?;
    state.api().chat_send(&token, &body).await
}

#[tauri::command]
pub async fn presence_heartbeat(state: State<'_, AppState>) -> Result<(), String> {
    let token = require_token(&state)?;
    state.api().presence_heartbeat(&token).await
}
