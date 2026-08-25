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
        .setup(|app| {
            // O icone da BARRA DE TAREFAS nao vem do recurso embutido no .exe:
            // vem do icone da janela. Sem defini-lo, o Windows cai no cache do
            // atalho -- que continuava mostrando o icone padrao do Tauri, da
            // primeira instalacao, mesmo depois de o executavel ja trazer o
            // brasao (conferido: o .exe instalado tinha o icone certo e a barra
            // mostrava o antigo).
            //
            // Falhar aqui nao impede o launcher de abrir: perder o icone e feio,
            // nao fatal.
            use tauri::Manager;
            if let Some(janela) = app.get_webview_window("main") {
                match tauri::image::Image::from_bytes(include_bytes!("../icons/128x128.png")) {
                    Ok(icone) => {
                        let _ = janela.set_icon(icone);
                    }
                    Err(e) => eprintln!("icone da janela nao carregou: {e}"),
                }
            }
            Ok(())
        })
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
