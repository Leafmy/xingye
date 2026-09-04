use std::sync::Mutex;
use tauri::Manager;

mod commands;
mod process;
mod tray;
mod updater;

/// 应用全局状态
pub struct AppState {
    pub backend_pid: Mutex<Option<u32>>,
    pub snowluma_pid: Mutex<Option<u32>>,
}

/// Tauri 插件入口
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // 单实例锁必须最先注册：二次启动时聚焦已有窗口并退出新进程
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        // 开机自启（托盘菜单可切换）
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(AppState {
            backend_pid: Mutex::new(None),
            snowluma_pid: Mutex::new(None),
        })
        .setup(|app| {
            // 获取应用数据目录
            let _app_dir = app.path().app_data_dir().expect("failed to get app data dir");
            let app_resource_dir = app
                .path()
                .resource_dir()
                .expect("failed to get resource dir");

            // 设置系统托盘
            tray::setup_tray(app)?;

            // 启动子进程
            let app_handle = app.handle().clone();
            let resource_dir = app_resource_dir.clone();
            tauri::async_runtime::spawn(async move {
                // 先启动 SnowLuma
                if let Err(e) = process::start_snowluma(&app_handle, &resource_dir).await {
                    eprintln!("[Xingye] Failed to start SnowLuma: {}", e);
                }
                // 再启动 bot-backend
                if let Err(e) = process::start_backend(&app_handle, &resource_dir).await {
                    eprintln!("[Xingye] Failed to start backend: {}", e);
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_version,
            commands::get_metrics,
            commands::restart_app,
            commands::quit_app,
            commands::check_update,
            commands::apply_update,
            commands::send_cli_command,
            commands::get_app_state,
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                // 最小化到托盘而不是关闭
                window.hide().unwrap();
                api.prevent_close();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
