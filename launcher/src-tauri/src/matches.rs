//! Histórico de partidas e estatísticas de conta.
//!
//! Mesma casca de `ranked.rs`: o HTTP de verdade vive em `auth.rs`, porque o
//! token de sessão nunca pode chegar ao JavaScript. As respostas trafegam como
//! JSON cru — quem entende o formato é `src/api.ts`.
//!
//! O que **não** trafega por aqui é `mu`/`sigma`: a API já os deixa de fora
//! (`api/src/routes/matches.ts`), e este arquivo não reintroduz nada — ele
//! repassa o corpo que recebeu.

use reqwest::Method;
use serde_json::Value;
use tauri::State;

use crate::auth::{require_token, AppState};

/// Teto espelhado de `HISTORICO_LIMITE_MAX` da API: mandar mais que isso só
/// renderia 400 depois de uma ida ao servidor.
const LIMITE_MAX: u32 = 50;

/// O id vem da webview, e vai concatenado num caminho e numa querystring: um
/// `&` ou uma barra aqui viraria parâmetro extra ou outra rota. Um uuid só tem
/// hexadecimal e hífen, então a conferência é esta.
fn uuid_valido(id: &str) -> Result<&str, String> {
    if id.len() == 36 && id.chars().all(|c| c.is_ascii_hexdigit() || c == '-') {
        Ok(id)
    } else {
        Err(format!("identificador inválido: {id:?}"))
    }
}

/// O cursor é uma data ISO devolvida pela própria API no `proximoCursor`.
/// Mesma razão da conferência acima — ele entra cru na querystring.
fn cursor_valido(quando: &str) -> Result<&str, String> {
    if !quando.is_empty()
        && quando.len() <= 32
        && quando
            .chars()
            .all(|c| c.is_ascii_digit() || matches!(c, '-' | ':' | '.' | 'T' | 'Z' | '+'))
    {
        Ok(quando)
    } else {
        Err(format!("cursor inválido: {quando:?}"))
    }
}

async fn pedir(state: &AppState, path: &str) -> Result<Value, String> {
    let token = require_token(state)?;
    state.api().json_request(&token, Method::GET, path, None).await
}

/// `GET /matches` — sem `account_id` é o feed da comunidade; com ele, o
/// histórico de uma conta (a API tem rota própria, mas o parâmetro faz o mesmo).
#[tauri::command]
pub async fn matches_history(
    state: State<'_, AppState>,
    account_id: Option<String>,
    limit: Option<u32>,
    before: Option<String>,
) -> Result<Value, String> {
    let mut params: Vec<String> = Vec::new();

    if let Some(id) = account_id.as_deref() {
        params.push(format!("accountId={}", uuid_valido(id)?));
    }
    if let Some(limit) = limit {
        params.push(format!("limit={}", limit.clamp(1, LIMITE_MAX)));
    }
    if let Some(quando) = before.as_deref() {
        params.push(format!("before={}", cursor_valido(quando)?));
    }

    let path = if params.is_empty() {
        "/matches".to_string()
    } else {
        format!("/matches?{}", params.join("&"))
    };

    pedir(&state, &path).await
}

/// `GET /accounts/:id/stats` — o agregado do perfil. Tier, nunca pontuação.
#[tauri::command]
pub async fn account_stats(state: State<'_, AppState>, account_id: String) -> Result<Value, String> {
    pedir(&state, &format!("/accounts/{}/stats", uuid_valido(&account_id)?)).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn id_e_cursor_nao_viram_parametro_extra() {
        let id = "0f8b7c2a-1234-4abc-8def-9876543210ab";
        assert_eq!(uuid_valido(id).unwrap(), id);

        // O que a conferência existe para barrar: parâmetro grudado, rota trocada.
        assert!(uuid_valido("1&limit=999").is_err());
        assert!(uuid_valido("../accounts").is_err());
        assert!(uuid_valido("").is_err());

        assert_eq!(cursor_valido("2026-08-24T21:30:00.000Z").unwrap(), "2026-08-24T21:30:00.000Z");
        assert!(cursor_valido("2026-08-24&accountId=x").is_err());
        assert!(cursor_valido("").is_err());
    }
}
