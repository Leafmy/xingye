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
            // 主动创建应用数据目录，确保关闭行为等设置首次即可持久化
            if let Err(e) = std::fs::create_dir_all(&_app_dir) {
                eprintln!("[Xingye] Failed to create app data dir: {}", e);
            }
            let app_resource_dir = app
                .path()
                .resource_dir()
                .expect("failed to get resource dir");

            // Windows：把主进程与全部子进程纳入同一 Job Object（进程树统一管理/回收）
            process::setup_process_tree_job();

            // 深浅色自适应窗口背景：WebView2 首帧前显示该背景色，
            // 配合页面内联启动页（splash）彻底消除启动白屏/闪白
            process::apply_theme_background(app.handle());

            // 设置系统托盘
            tray::setup_tray(app)?;

            // 启动子进程
            let app_handle = app.handle().clone();
            let resource_dir = app_resource_dir.clone();
            let module_enabled = process::load_module_enabled(app.handle());
            tauri::async_runtime::spawn(async move {
                if !module_enabled {
                    println!("[Xingye] Xingye module master switch is OFF, framework stays running without module processes");
                    return;
                }
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
        .on_page_load(|webview, payload| {
            // 页面加载事件日志（诊断用）；窗口始终可见，show_main_window 由前端
            // invoke 触发（幂等），此处不再负责显示
            println!(
                "[Xingye] page load event: label={}, event={:?}",
                webview.label(),
                payload.event()
            );
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
            commands::get_module_state,
            commands::set_module_enabled,
            commands::open_external,
            commands::show_main_window,
            commands::get_close_behavior,
            commands::set_close_behavior,
            commands::open_app_settings,
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                // App 设置第二窗口：直接关闭即可，不走主窗口的托盘/退出逻辑
                if window.label() == "app-settings" {
                    return;
                }
                let app = window.app_handle();
                let behavior = crate::process::get_close_behavior(app);
                match behavior.as_str() {
                    "close" => {
                        // 直接关闭：不阻止默认行为，窗口会被关闭
                        // 注意：关闭窗口后需要手动退出进程（Job Object 会回收子进程）
                        let app_handle = app.clone();
                        tauri::async_runtime::spawn(async move {
                            crate::process::kill_all_processes(&app_handle).await;
                            app_handle.exit(0);
                        });
                    }
                    "minimize" => {
                        // 最小化到托盘
                        window.hide().unwrap();
                        api.prevent_close();
                    }
                    _ => {
                        // 默认行为：最小化到托盘
                        window.hide().unwrap();
                        api.prevent_close();
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}




