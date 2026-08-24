mod assets;
mod auth;
mod game;
mod install;
mod local;
mod original;
mod speech;
mod webview2;
mod social;

use auth::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Sem WebView2 o Tauri nao consegue criar a janela e morre com uma mensagem
    // que nao ajuda ninguem. Detectamos antes e explicamos o que fazer.
    if !webview2::instalado() {
        webview2::avisar(webview2::RECADO);
        std::process::exit(1);
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            auth::register,
            auth::login,
            auth::logout,
            auth::restore_session,
            auth::api_base,
            install::check_update,
            install::install_update,
            game::game_status,
            game::launch_game,
            original::find_original_game,
            original::check_original_game,
            assets::assets_status,
            assets::generate_assets,
            social::friends_list,
            social::friend_add,
            social::friend_respond,
            social::chat_fetch,
            social::chat_send,
            social::presence_heartbeat,
            local::list_replays,
            local::list_local_maps,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
