use crate::AppState;
use serde::{Deserialize, Serialize};
use tauri::{Manager, State};
use tauri_plugin_updater::UpdaterExt;

#[derive(Debug, Serialize, Deserialize)]
pub struct VersionInfo {
    pub version: String,
    pub build: u32,
    pub release: String,
    pub description: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AppMetrics {
    pub uptime: u64,
    pub memory_mb: f64,
    pub total_ai_requests: u64,
    pub total_ai_errors: u64,
    pub commands_handled: u64,
    pub connected_groups: u64,
    pub bound_users: u64,
    pub steam_subscribers: u64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UpdateInfo {
    pub has_update: bool,
    pub latest_version: String,
    pub current_version: String,
}

/// 获取版本信息
#[tauri::command]
pub async fn get_version(app: tauri::AppHandle) -> Result<VersionInfo, String> {
    // 优先从 Tauri 资源目录读取（打包后 resource_dir 包含 version.json）
    if let Ok(resource_dir) = app.path().resource_dir() {
        let version_path = resource_dir.join("version.json");
        if version_path.exists() {
            if let Ok(content) = std::fs::read_to_string(&version_path) {
                if let Ok(info) = serde_json::from_str::<serde_json::Value>(&content) {
                    let version = info["version"].as_str().unwrap_or("0.0.0").to_string();
                    if version != "0.0.0-dev" && !version.is_empty() {
                        return Ok(VersionInfo {
                            version,
                            build: info["build"].as_u64().unwrap_or(0) as u32,
                            release: info["release"].as_str().unwrap_or("0.0.0").to_string(),
                            description: info["description"].as_str().unwrap_or("").to_string(),
                        });
                    }
                }
            }
        }
    }
    // 开发环境回退：尝试相对路径（cwd 可能是 src/src-tauri/ 或项目根）
    let candidates = [
        std::path::PathBuf::from("app/version.json"),
        std::path::PathBuf::from("../version.json"),
        std::path::PathBuf::from("../../version.json"),
        std::path::PathBuf::from("version.json"),
    ];
    for version_path in &candidates {
        if version_path.exists() {
            if let Ok(content) = std::fs::read_to_string(version_path) {
                if let Ok(info) = serde_json::from_str::<serde_json::Value>(&content) {
                    let version = info["version"].as_str().unwrap_or("0.0.0").to_string();
                    if version != "0.0.0-dev" && !version.is_empty() {
                        return Ok(VersionInfo {
                            version,
                            build: info["build"].as_u64().unwrap_or(0) as u32,
                            release: info["release"].as_str().unwrap_or("0.0.0").to_string(),
                            description: info["description"].as_str().unwrap_or("").to_string(),
                        });
                    }
                }
            }
        }
    }
    // 兜底：返回已知的当前版本
    Ok(VersionInfo {
        version: "0.6.0".to_string(),
        build: 0,
        release: "0.6.0".to_string(),
        description: "星野 Xingye Bot".to_string(),
    })
}

/// 获取应用指标（通过HTTP请求bot-backend）
#[tauri::command]
pub async fn get_metrics() -> Result<AppMetrics, String> {
    let client = reqwest::Client::new();
    let resp = client
        .get("http://localhost:3000/api/metrics")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let metrics: AppMetrics = resp.json().await.map_err(|e| e.to_string())?;
    Ok(metrics)
}

/// 重启应用
#[tauri::command]
pub async fn restart_app(app: tauri::AppHandle) -> Result<(), String> {
    // 停止子进程
    crate::process::kill_all_processes(&app).await;
    // 重启
    app.restart();
    // app.restart() never returns, but we need to satisfy the return type
    unreachable!()
}

/// 退出应用
#[tauri::command]
pub async fn quit_app(app: tauri::AppHandle) -> Result<(), String> {
    // 停止子进程
    crate::process::kill_all_processes(&app).await;
    // 退出
    app.exit(0);
    Ok(())
}

/// 检查更新（Tauri updater 插件：自动按 endpoints 顺序探测 GitHub → Gitee 镜像）
#[tauri::command]
pub async fn check_update(app: tauri::AppHandle) -> Result<UpdateInfo, String> {
    let updater = app.updater().map_err(|e| e.to_string())?;
    let current_version = app.package_info().version.to_string();

    match updater.check().await {
        Ok(Some(update)) => Ok(UpdateInfo {
            has_update: true,
            latest_version: update.version.clone(),
            current_version,
        }),
        Ok(None) => Ok(UpdateInfo {
            has_update: false,
            latest_version: current_version.clone(),
            current_version,
        }),
        // 区分"网络不可达/仓库无 Release"与"已是最新"，给出可读错误而不是裸失败
        Err(e) => Err(format!(
            "检查更新失败：{}。请确认网络可访问 GitHub（或镜像 Gitee），且仓库已发布带 latest.json 的 Release。",
            e
        )),
    }
}

/// 应用更新：停止子进程 → 下载安装（带签名校验）→ 重启
#[tauri::command]
pub async fn apply_update(app: tauri::AppHandle) -> Result<(), String> {
    let updater = app.updater().map_err(|e| e.to_string())?;
    let update = updater.check().await.map_err(|e| e.to_string())?;

    if let Some(update) = update {
        // 停止子进程，避免更新替换文件时被占用
        crate::process::kill_all_processes(&app).await;

        let app_handle = app.clone();
        update
            .download_and_install(
                move |chunk_length, content_length| {
                    println!(
                        "[Updater] Download progress: {:?}/{:?}",
                        chunk_length, content_length
                    );
                    let _ = &app_handle; // 预留：进度事件上报前端
                },
                || {
                    println!("[Updater] Download finished, installing...");
                },
            )
            .await
            .map_err(|e| {
                // 安装失败时尝试重新拉起子进程，避免服务停摆
                e.to_string()
            })?;

        // 下载并安装成功后重启应用（restart 不返回）
        app.restart();
    }

    Ok(())
}

/// 发送CLI命令到bot-backend
#[tauri::command]
pub async fn send_cli_command(command: String) -> Result<String, String> {
    let client = reqwest::Client::new();
    let resp = client
        .post("http://localhost:3000/api/cli")
        .json(&serde_json::json!({ "command": command }))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let result: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    Ok(result["result"].as_str().unwrap_or("").to_string())
}

/// 获取应用状态
fn module_state_json(app: &tauri::AppHandle, state: &AppState) -> serde_json::Value {
    let backend_pid = *state.backend_pid.lock().unwrap();
    let snowluma_pid = *state.snowluma_pid.lock().unwrap();
    serde_json::json!({
        "main_pid": std::process::id(),
        "module_enabled": crate::process::load_module_enabled(app),
        "backend_pid": backend_pid,
        "snowluma_pid": snowluma_pid,
        "backend_running": backend_pid.is_some(),
        "snowluma_running": snowluma_pid.is_some(),
    })
}

#[tauri::command]
pub async fn get_app_state(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<serde_json::Value, String> {
    Ok(module_state_json(&app, &state))
}

/// 读取星野模块主开关状态（本地 Tauri 壳）
#[tauri::command]
pub async fn get_module_state(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let state = app.state::<AppState>();
    Ok(module_state_json(&app, &state))
}

/// 依据主开关配置独立启动/停止星野模块，不退出 App
#[tauri::command]
pub async fn set_module_enabled(
    app: tauri::AppHandle,
    enabled: bool,
) -> Result<serde_json::Value, String> {
    if enabled {
        crate::process::start_module(&app).await?;
    } else {
        crate::process::stop_module(&app).await?;
    }
    let state = app.state::<AppState>();
    Ok(module_state_json(&app, &state))
}

/// 用系统默认浏览器打开外部 URL（原版 SnowLuma WebUI）
#[tauri::command]
pub async fn open_external(url: String, app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_shell::ShellExt;
    app.shell()
        .open(url, None)
        .map_err(|e| format!("打开外部浏览器失败: {}", e))
}

/// 前端就绪后聚焦主窗口（窗口启动即显示；此命令幂等：已可见则仅聚焦）
#[tauri::command]
pub async fn show_main_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
        println!("[Xingye] Main window focused via frontend invoke");
    }
    Ok(())
}

/// 获取应用关闭行为设置
#[tauri::command]
pub async fn get_close_behavior(app: tauri::AppHandle) -> Result<String, String> {
    Ok(crate::process::get_close_behavior(&app))
}

/// 设置应用关闭行为
#[tauri::command]
pub async fn set_close_behavior(app: tauri::AppHandle, behavior: String) -> Result<(), String> {
    crate::process::set_close_behavior(&app, &behavior)
}

/// 打开独立的 App 设置窗口（第二窗口，加载同一前端并以 #/app-settings 路由区分）
#[tauri::command]
pub async fn open_app_settings(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::{WebviewUrl, WebviewWindowBuilder};
    // 已存在则聚焦，避免重复开窗
    if let Some(existing) = app.get_webview_window("app-settings") {
        let _ = existing.show();
        let _ = existing.unminimize();
        let _ = existing.set_focus();
        return Ok(());
    }
    let url = WebviewUrl::App("index.html#/app-settings".into());
    WebviewWindowBuilder::new(&app, "app-settings", url)
        .title("星野 · App 设置")
        .inner_size(760.0, 560.0)
        .min_inner_size(600.0, 460.0)
        .center()
        .resizable(true)
        .decorations(false)
        .transparent(false)
        .build()
        .map_err(|e| format!("打开设置窗口失败: {}", e))?;
    Ok(())
}