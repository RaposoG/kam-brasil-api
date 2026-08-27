//! Autenticação contra a API do Kam Brasil.
//!
//! Todo o tráfego HTTP acontece aqui, no Rust, e não na webview. O motivo é o
//! token de sessão: se ele chegasse ao JavaScript teríamos que guardá-lo em
//! `localStorage` ou similar, onde qualquer script carregado na página o
//! alcançaria. Deste lado ele fica na memória do processo e é persistido no
//! cofre de credenciais do sistema.
//!
//! A webview conversa só por comandos Tauri e nunca vê o token.
//!
//! `ApiClient` é deliberadamente livre de tipos do Tauri: é o que permite
//! testá-lo contra a API real sem subir uma janela (ver os testes no fim).

use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::State;

/// Produção. Sobrescrevível em tempo de compilação para desenvolvimento:
/// `KAMBRASIL_API=http://localhost:3000 cargo build`
const DEFAULT_API_BASE: &str = "https://kam-api.melhorzin.com";

const KEYRING_SERVICE: &str = "br.com.kambrasil.launcher";
const KEYRING_USER: &str = "session-token";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Account {
    pub id: String,
    pub email: String,
    pub nickname: String,
    /// O "na comunidade desde" do Perfil. `default` porque a API pode responder
    /// sem o campo (versões antigas) e isso não pode derrubar o login.
    #[serde(rename = "createdAt", default)]
    pub created_at: Option<String>,
    /// Painel administrativo. `default` pelo mesmo motivo do `created_at`: uma
    /// sessão restaurada de uma API antiga não traz o campo, e isso não pode
    /// derrubar o login — sem ele a conta entra como jogador comum.
    #[serde(rename = "isAdmin", default)]
    pub is_admin: bool,
}

#[derive(Deserialize)]
struct LoginResponse {
    token: String,
    account: Account,
}

#[derive(Deserialize)]
struct AccountEnvelope {
    account: Account,
}

/// Corpo de erro da API: `{ "error": "..." }`
#[derive(Deserialize)]
struct ApiError {
    error: String,
}

/// Um camarada aceito, com a presença que a API calculou (visto há < 2 min).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Friend {
    pub friendship_id: String,
    pub account_id: String,
    pub nickname: String,
    pub online: bool,
    pub last_seen_at: Option<String>,
}

/// Convite pendente — só o necessário para aceitar/recusar/cancelar.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FriendRequest {
    pub friendship_id: String,
    pub nickname: String,
}

/// `GET /friends`: aceitos + pendentes nas duas direções, numa resposta só.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FriendsOverview {
    pub friends: Vec<Friend>,
    pub incoming: Vec<FriendRequest>,
    pub outgoing: Vec<FriendRequest>,
}

/// Mensagem da taverna. `id` é o cursor do poll (`GET /chat?after=`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub id: i64,
    pub nickname: String,
    pub body: String,
    pub at: String,
}

/// Sessão recém-criada: o token e a conta a que ele pertence.
pub struct Session {
    pub token: String,
    pub account: Account,
}

pub struct ApiClient {
    client: reqwest::Client,
    base: String,
}

impl ApiClient {
    pub fn new(base: impl Into<String>) -> Self {
        Self {
            client: reqwest::Client::new(),
            base: base.into().trim_end_matches('/').to_string(),
        }
    }

    pub fn base(&self) -> &str {
        &self.base
    }

    fn url(&self, path: &str) -> String {
        format!("{}{}", self.base, path)
    }

    /// Traduz uma resposta de erro da API para a mensagem que o usuário vê.
    async fn error_message(response: reqwest::Response) -> String {
        let status = response.status();
        match response.json::<ApiError>().await {
            Ok(body) => body.error,
            Err(_) => format!("erro inesperado do servidor ({status})"),
        }
    }

    pub async fn register(
        &self,
        email: &str,
        nickname: &str,
        password: &str,
    ) -> Result<Account, String> {
        let response = self
            .client
            .post(self.url("/auth/register"))
            .json(&serde_json::json!({
                "email": email, "nickname": nickname, "password": password
            }))
            .send()
            .await
            .map_err(|e| format!("não foi possível falar com o servidor: {e}"))?;

        if !response.status().is_success() {
            return Err(Self::error_message(response).await);
        }

        response
            .json::<AccountEnvelope>()
            .await
            .map(|r| r.account)
            .map_err(|e| format!("resposta inesperada do servidor: {e}"))
    }

    /// Pede o código de redefinição por email. Rota pública — quem precisa
    /// dela é justamente quem não consegue entrar.
    pub async fn senha_esquecer(&self, email: &str) -> Result<(), String> {
        let response = self
            .client
            .post(self.url("/auth/esqueci"))
            .json(&serde_json::json!({ "email": email }))
            .send()
            .await
            .map_err(|e| format!("não foi possível falar com o servidor: {e}"))?;
        if !response.status().is_success() {
            return Err(Self::error_message(response).await);
        }
        Ok(())
    }

    /// Troca a senha com o código recebido por email.
    pub async fn senha_redefinir(&self, email: &str, codigo: &str, senha: &str) -> Result<(), String> {
        let response = self
            .client
            .post(self.url("/auth/redefinir"))
            .json(&serde_json::json!({ "email": email, "codigo": codigo, "senha": senha }))
            .send()
            .await
            .map_err(|e| format!("não foi possível falar com o servidor: {e}"))?;
        if !response.status().is_success() {
            return Err(Self::error_message(response).await);
        }
        Ok(())
    }

    pub async fn login(&self, login: &str, password: &str) -> Result<Session, String> {
        let response = self
            .client
            .post(self.url("/auth/login"))
            .json(&serde_json::json!({ "login": login, "password": password }))
            .send()
            .await
            .map_err(|e| format!("não foi possível falar com o servidor: {e}"))?;

        if !response.status().is_success() {
            return Err(Self::error_message(response).await);
        }

        let body: LoginResponse = response
            .json()
            .await
            .map_err(|e| format!("resposta inesperada do servidor: {e}"))?;

        Ok(Session {
            token: body.token,
            account: body.account,
        })
    }

    /// `Ok(None)` = token recusado (expirado ou revogado), não é erro de rede.
    pub async fn me(&self, token: &str) -> Result<Option<Account>, String> {
        let response = self
            .client
            .get(self.url("/auth/me"))
            .bearer_auth(token)
            .send()
            .await
            .map_err(|e| format!("não foi possível falar com o servidor: {e}"))?;

        if !response.status().is_success() {
            return Ok(None);
        }

        response
            .json::<AccountEnvelope>()
            .await
            .map(|r| Some(r.account))
            .map_err(|e| format!("resposta inesperada do servidor: {e}"))
    }

    /// Troca a sessão por um ticket de partida — credencial curta e de escopo
    /// restrito, que e a unica coisa que o jogo chega a ver.
    pub async fn play_ticket(&self, token: &str) -> Result<String, String> {
        #[derive(Deserialize)]
        struct TicketResponse {
            ticket: String,
        }

        let response = self
            .client
            .post(self.url("/auth/ticket"))
            .bearer_auth(token)
            .send()
            .await
            .map_err(|e| format!("não foi possível falar com o servidor: {e}"))?;

        if !response.status().is_success() {
            return Err(Self::error_message(response).await);
        }

        response
            .json::<TicketResponse>()
            .await
            .map(|r| r.ticket)
            .map_err(|e| format!("resposta inesperada do servidor: {e}"))
    }

    pub async fn logout(&self, token: &str) -> Result<(), String> {
        self.client
            .post(self.url("/auth/logout"))
            .bearer_auth(token)
            .send()
            .await
            .map_err(|e| format!("não foi possível falar com o servidor: {e}"))?;
        Ok(())
    }

    pub async fn friends_list(&self, token: &str) -> Result<FriendsOverview, String> {
        let response = self
            .client
            .get(self.url("/friends"))
            .bearer_auth(token)
            .send()
            .await
            .map_err(|e| format!("não foi possível falar com o servidor: {e}"))?;

        if !response.status().is_success() {
            return Err(Self::error_message(response).await);
        }

        response
            .json::<FriendsOverview>()
            .await
            .map_err(|e| format!("resposta inesperada do servidor: {e}"))
    }

    /// Devolve o `status` da API: `pending` (convite enviado) ou `accepted`
    /// (existia convite reverso e virou amizade) — a UI trata diferente.
    pub async fn friend_add(&self, token: &str, nickname: &str) -> Result<String, String> {
        #[derive(Deserialize)]
        struct StatusResponse {
            status: String,
        }

        let response = self
            .client
            .post(self.url("/friends"))
            .bearer_auth(token)
            .json(&serde_json::json!({ "nickname": nickname }))
            .send()
            .await
            .map_err(|e| format!("não foi possível falar com o servidor: {e}"))?;

        if !response.status().is_success() {
            return Err(Self::error_message(response).await);
        }

        response
            .json::<StatusResponse>()
            .await
            .map(|r| r.status)
            .map_err(|e| format!("resposta inesperada do servidor: {e}"))
    }

    pub async fn friend_accept(&self, token: &str, friendship_id: &str) -> Result<(), String> {
        let response = self
            .client
            .post(self.url(&format!("/friends/{friendship_id}/accept")))
            .bearer_auth(token)
            .send()
            .await
            .map_err(|e| format!("não foi possível falar com o servidor: {e}"))?;

        if !response.status().is_success() {
            return Err(Self::error_message(response).await);
        }
        Ok(())
    }

    /// Recusa, cancela ou desfaz — a API aceita qualquer lado da amizade.
    pub async fn friend_remove(&self, token: &str, friendship_id: &str) -> Result<(), String> {
        let response = self
            .client
            .delete(self.url(&format!("/friends/{friendship_id}")))
            .bearer_auth(token)
            .send()
            .await
            .map_err(|e| format!("não foi possível falar com o servidor: {e}"))?;

        if !response.status().is_success() {
            return Err(Self::error_message(response).await);
        }
        Ok(())
    }

    /// `after` é o id da última mensagem que já temos; sem ele vêm as últimas 50.
    pub async fn chat_fetch(&self, token: &str, after: Option<i64>) -> Result<Vec<ChatMessage>, String> {
        #[derive(Deserialize)]
        struct ChatEnvelope {
            messages: Vec<ChatMessage>,
        }

        // URL montada à mão: o `.query()` do reqwest fica atrás de uma feature
        // que não usamos, e um i64 não precisa de percent-encoding.
        let url = match after {
            Some(after) => self.url(&format!("/chat?after={after}")),
            None => self.url("/chat"),
        };

        let response = self
            .client
            .get(url)
            .bearer_auth(token)
            .send()
            .await
            .map_err(|e| format!("não foi possível falar com o servidor: {e}"))?;

        if !response.status().is_success() {
            return Err(Self::error_message(response).await);
        }

        response
            .json::<ChatEnvelope>()
            .await
            .map(|r| r.messages)
            .map_err(|e| format!("resposta inesperada do servidor: {e}"))
    }

    pub async fn chat_send(&self, token: &str, body: &str) -> Result<ChatMessage, String> {
        #[derive(Deserialize)]
        struct MessageEnvelope {
            message: ChatMessage,
        }

        let response = self
            .client
            .post(self.url("/chat"))
            .bearer_auth(token)
            .json(&serde_json::json!({ "body": body }))
            .send()
            .await
            .map_err(|e| format!("não foi possível falar com o servidor: {e}"))?;

        if !response.status().is_success() {
            return Err(Self::error_message(response).await);
        }

        response
            .json::<MessageEnvelope>()
            .await
            .map(|r| r.message)
            .map_err(|e| format!("resposta inesperada do servidor: {e}"))
    }

    /// Requisição autenticada que devolve o JSON cru, sem tipar a resposta.
    ///
    /// Existe para as rotas do ranqueado: são sete formatos que só a interface
    /// interpreta (fila, lobby de bans, tier, leaderboard). Tipar cada um aqui
    /// manteria o mesmo contrato em dois lugares para o Rust nunca olhar para
    /// nenhum campo — e todo campo novo da API viraria release do launcher.
    pub async fn json_request(
        &self,
        token: &str,
        method: reqwest::Method,
        path: &str,
        body: Option<serde_json::Value>,
    ) -> Result<serde_json::Value, String> {
        let mut pedido = self.client.request(method, self.url(path)).bearer_auth(token);
        if let Some(body) = body {
            pedido = pedido.json(&body);
        }

        let response = pedido
            .send()
            .await
            .map_err(|e| format!("não foi possível falar com o servidor: {e}"))?;

        if !response.status().is_success() {
            return Err(Self::error_message(response).await);
        }

        // Sair da fila responde 204 sem corpo, e `serde_json` não engole vazio.
        let corpo = response
            .text()
            .await
            .map_err(|e| format!("resposta inesperada do servidor: {e}"))?;
        if corpo.trim().is_empty() {
            return Ok(serde_json::Value::Null);
        }

        serde_json::from_str(&corpo).map_err(|e| format!("resposta inesperada do servidor: {e}"))
    }

    /// Marca a conta como "launcher aberto" — é isto que alimenta o online dos
    /// camaradas e o `launcherOnline` do overview.
    pub async fn presence_heartbeat(&self, token: &str) -> Result<(), String> {
        let response = self
            .client
            .post(self.url("/presence"))
            .bearer_auth(token)
            .send()
            .await
            .map_err(|e| format!("não foi possível falar com o servidor: {e}"))?;

        if !response.status().is_success() {
            return Err(Self::error_message(response).await);
        }
        Ok(())
    }
}

pub struct AppState {
    token: Mutex<Option<String>>,
    /// Conta da sessão corrente. Guardada para o launcher poder usar o nickname
    /// sem ter que perguntar à API de novo a cada ação.
    account: Mutex<Option<Account>>,
    api: ApiClient,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            token: Mutex::new(None),
            account: Mutex::new(None),
            api: ApiClient::new(option_env!("KAMBRASIL_API").unwrap_or(DEFAULT_API_BASE)),
        }
    }
}

impl AppState {
    fn set_session(&self, token: Option<String>, account: Option<Account>) {
        *self.token.lock().expect("token mutex envenenado") = token;
        *self.account.lock().expect("account mutex envenenado") = account;
    }

    /// Visível ao módulo `game` para a entrega do token ao jogo. Nunca sai por
    /// comando Tauri — a webview não deve ver o token.
    pub(crate) fn token(&self) -> Option<String> {
        self.token.lock().expect("token mutex envenenado").clone()
    }

    pub fn nickname(&self) -> Option<String> {
        self.account
            .lock()
            .expect("account mutex envenenado")
            .as_ref()
            .map(|a| a.nickname.clone())
    }

    pub fn api_base(&self) -> String {
        self.api.base().to_string()
    }

    /// Visível ao módulo `social`: os comandos de lá usam o mesmo cliente para
    /// não abrir um pool de conexões novo por chamada.
    pub(crate) fn api(&self) -> &ApiClient {
        &self.api
    }

    /// Ticket de partida para entregar ao jogo. Visível ao módulo `game`.
    pub(crate) async fn play_ticket(&self) -> Option<String> {
        let token = self.token()?;
        match self.api.play_ticket(&token).await {
            Ok(ticket) => Some(ticket),
            Err(e) => {
                eprintln!("aviso: não foi possível obter o ticket de partida: {e}");
                None
            }
        }
    }
}

/// O texto que a UI mostra quando a sessão sumiu — mesmo destino de um 401.
/// Mora aqui, junto do estado que guarda o token, porque `social` e `ranked`
/// precisam da mesma resposta e a mensagem não pode divergir entre as telas.
pub(crate) fn require_token(state: &AppState) -> Result<String, String> {
    state
        .token()
        .ok_or_else(|| "sessão expirada — entre novamente".to_string())
}

fn keyring_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER)
        .map_err(|e| format!("não foi possível acessar o cofre de credenciais: {e}"))
}

fn save_token(token: &str) -> Result<(), String> {
    keyring_entry()?
        .set_password(token)
        .map_err(|e| format!("não foi possível salvar a sessão: {e}"))
}

fn clear_stored_token() {
    // Falha aqui não é fatal: o token já foi revogado no servidor.
    if let Ok(entry) = keyring_entry() {
        let _ = entry.delete_credential();
    }
}

fn read_stored_token() -> Option<String> {
    keyring_entry().ok()?.get_password().ok()
}

#[tauri::command]
pub async fn register(
    state: State<'_, AppState>,
    email: String,
    nickname: String,
    password: String,
) -> Result<Account, String> {
    state.api.register(&email, &nickname, &password).await
}

#[tauri::command]
pub async fn senha_esquecer(state: State<'_, AppState>, email: String) -> Result<(), String> {
    state.api.senha_esquecer(&email).await
}

#[tauri::command]
pub async fn senha_redefinir(
    state: State<'_, AppState>,
    email: String,
    codigo: String,
    senha: String,
) -> Result<(), String> {
    state.api.senha_redefinir(&email, &codigo, &senha).await
}

#[tauri::command]
pub async fn login(
    state: State<'_, AppState>,
    login: String,
    password: String,
) -> Result<Account, String> {
    let session = state.api.login(&login, &password).await?;

    state.set_session(Some(session.token.clone()), Some(session.account.clone()));
    // Se o cofre falhar, o login continua valendo nesta execução — só não
    // sobrevive ao fechar o launcher. Não vale abortar por isso.
    let _ = save_token(&session.token);

    Ok(session.account)
}

/// Tenta reaproveitar a sessão guardada. `None` = precisa logar.
#[tauri::command]
pub async fn restore_session(state: State<'_, AppState>) -> Result<Option<Account>, String> {
    let Some(token) = read_stored_token() else {
        return Ok(None);
    };

    match state.api.me(&token).await? {
        Some(account) => {
            state.set_session(Some(token), Some(account.clone()));
            Ok(Some(account))
        }
        None => {
            // Expirado ou revogado: descarta em vez de insistir a cada abertura.
            clear_stored_token();
            Ok(None)
        }
    }
}

#[tauri::command]
pub async fn logout(state: State<'_, AppState>) -> Result<(), String> {
    if let Some(token) = state.token() {
        // Revogar no servidor é o que realmente invalida o token; apagar só
        // localmente deixaria a sessão viva até expirar.
        let _ = state.api.logout(&token).await;
    }

    state.set_session(None, None);
    clear_stored_token();
    Ok(())
}

/// Onde a API está apontada. Útil para a UI mostrar quando não é produção.
#[tauri::command]
pub fn api_base(state: State<'_, AppState>) -> String {
    state.api_base()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Exercita o fluxo completo contra a API rodando em localhost:3000.
    ///
    /// Marcado como `ignore` porque depende de serviço externo — não deve
    /// quebrar um `cargo test` de quem não subiu o ambiente. Para rodar:
    ///
    ///   cd brasil/api && bun run dev
    ///   cd brasil/launcher/src-tauri && cargo test -- --ignored --nocapture
    #[tokio::test]
    #[ignore]
    async fn fluxo_completo_contra_api_real() {
        let api = ApiClient::new("http://localhost:3000");

        // Nickname distinto a cada execução, senão a segunda rodada bate em 409.
        let suffix = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs()
            % 100_000;
        let nickname = format!("rust{suffix}");
        let email = format!("{nickname}@kambrasil.test");
        let password = "senha-de-teste-integracao";

        let created = api
            .register(&email, &nickname, password)
            .await
            .expect("registro deveria funcionar");
        assert_eq!(created.nickname, nickname);

        let duplicate = api.register(&email, &nickname, password).await;
        assert!(duplicate.is_err(), "email repetido deveria ser recusado");

        let wrong = api.login(&nickname, "senha-errada").await;
        assert!(wrong.is_err(), "senha errada deveria ser recusada");

        // Login por nickname em caixa alta: a API é case-insensitive.
        let session = api
            .login(&nickname.to_uppercase(), password)
            .await
            .expect("login deveria funcionar");
        assert_eq!(session.account.email, email);

        let me = api.me(&session.token).await.expect("me deveria responder");
        assert_eq!(me.as_ref().map(|a| a.nickname.as_str()), Some(nickname.as_str()));

        // Ticket de partida: credencial curta que o jogo recebe no lugar da sessao.
        let ticket = api
            .play_ticket(&session.token)
            .await
            .expect("deveria emitir ticket");
        assert_ne!(ticket, session.token, "o ticket nao pode ser o proprio token");

        let verify = |t: String| async move {
            reqwest::get(format!("http://localhost:3000/auth/verify?token={t}"))
                .await
                .unwrap()
                .text()
                .await
                .unwrap()
        };

        assert_eq!(verify(ticket.clone()).await, format!("ok {nickname}"));

        // O token de sessao NAO deve servir como ticket -- se servisse, o escopo
        // restrito seria so aparencia.
        assert_eq!(verify(session.token.clone()).await, "invalid");

        api.logout(&session.token).await.expect("logout deveria funcionar");

        let after = api.me(&session.token).await.expect("me deveria responder");
        assert!(after.is_none(), "token deveria estar revogado apos o logout");

        // E o ticket morre junto com a sessao: e isso que faz o logout expulsar
        // de dentro do jogo, e nao apenas do launcher.
        assert_eq!(verify(ticket).await, "invalid", "ticket deveria morrer com a sessao");
    }
}
