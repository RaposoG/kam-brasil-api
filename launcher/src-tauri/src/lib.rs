mod admin;
mod auth;
mod game;
mod install;
mod local;
mod mapas;
mod matches;
mod ranked;
mod ranked_ws;
mod replay;
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
            install::map_ready,
            install::download_map,
            mapas::mapas_sync,
            game::game_status,
            game::launch_game,
            social::friends_list,
            social::friend_add,
            social::friend_respond,
            social::chat_fetch,
            social::chat_send,
            social::presence_heartbeat,
            ranked::ranked_queue_join,
            ranked::ranked_queue_leave,
            ranked::ranked_queue_status,
            ranked::ranked_lobby,
            ranked::ranked_ban,
            ranked::ranked_me,
            ranked::ranked_leaderboard,
            ranked_ws::ranked_ws_start,
            ranked_ws::ranked_ws_stop,
            matches::matches_history,
            matches::account_stats,
            replay::upload_replay,
            local::list_replays,
            local::list_local_maps,
            admin::admin_call,
            admin::admin_map_folder,
            admin::admin_map_upload,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
