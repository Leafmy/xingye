use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager,
};
use tauri_plugin_autostart::ManagerExt;

/// 设置系统托盘
pub fn setup_tray(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let app_handle = app.handle();

    // 创建托盘菜单
    let show_item = MenuItem::with_id(app_handle, "show", "显示窗口", true, None::<&str>)?;
    let restart_item = MenuItem::with_id(app_handle, "restart", "重启服务", true, None::<&str>)?;
    let autostart_enabled = app.autolaunch().is_enabled().unwrap_or(false);
    let autostart_item = CheckMenuItem::with_id(
        app_handle,
        "autostart",
        "开机自启",
        true,
        autostart_enabled,
        None::<&str>,
    )?;
    let quit_item = MenuItem::with_id(app_handle, "quit", "退出", true, None::<&str>)?;

    let menu = Menu::with_items(
        app_handle,
        &[&show_item, &restart_item, &autostart_item, &quit_item],
    )?;

    // 创建托盘图标
    let _tray = TrayIconBuilder::new()
        .icon(app.default_window_icon().unwrap().clone())
        .menu(&menu)
        .tooltip("星野 Xingye")
        .on_menu_event(move |app, event| match event.id.as_ref() {
            "show" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "restart" => {
                let app_handle = app.clone();
                tauri::async_runtime::spawn(async move {
                    let resource_dir = app_handle
                        .path()
                        .resource_dir()
                        .expect("failed to get resource dir");
                    // 先停旧子进程，再重新拉起（原实现只杀不启）
                    crate::process::kill_all_processes(&app_handle).await;
                    if let Err(e) = crate::process::start_snowluma(&app_handle, &resource_dir).await {
                        eprintln!("[Xingye] Tray restart SnowLuma failed: {}", e);
                    }
                    if let Err(e) = crate::process::start_backend(&app_handle, &resource_dir).await {
                        eprintln!("[Xingye] Tray restart backend failed: {}", e);
                    }
                    if let Some(window) = app_handle.get_webview_window("main") {
                        let _ = window.eval("location.reload()");
                    }
                });
            }
            "autostart" => {
                let autolaunch = app.autolaunch();
                let enabled = autolaunch.is_enabled().unwrap_or(false);
                let result = if enabled {
                    autolaunch.disable()
                } else {
                    autolaunch.enable()
                };
                match result {
                    Ok(_) => println!("[Xingye] autostart -> {}", !enabled),
                    Err(e) => eprintln!("[Xingye] autostart toggle failed: {}", e),
                }
            }
            "quit" => {
                let app_handle = app.clone();
                tauri::async_runtime::spawn(async move {
                    crate::process::kill_all_processes(&app_handle).await;
                    app_handle.exit(0);
                });
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        })
        .build(app_handle)?;

    Ok(())
}
