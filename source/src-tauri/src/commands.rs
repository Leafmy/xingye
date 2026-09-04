use crate::AppState;
use serde::{Deserialize, Serialize};
use tauri::State;
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
pub async fn get_version() -> Result<VersionInfo, String> {
    // 从 app/version.json 读取
    let version_path = std::path::Path::new("app/version.json");
    if version_path.exists() {
        let content = std::fs::read_to_string(version_path).map_err(|e| e.to_string())?;
        let info: serde_json::Value = serde_json::from_str(&content).map_err(|e| e.to_string())?;
        Ok(VersionInfo {
            version: info["version"]
                .as_str()
                .unwrap_or("0.0.0")
                .to_string(),
            build: info["build"].as_u64().unwrap_or(0) as u32,
            release: info["release"]
                .as_str()
                .unwrap_or("0.0.0-build.0")
                .to_string(),
            description: info["description"]
                .as_str()
                .unwrap_or("")
                .to_string(),
        })
    } else {
        Ok(VersionInfo {
            version: "0.6.0".to_string(),
            build: 0,
            release: "0.6.0".to_string(),
            description: "星野 Xingye Bot".to_string(),
        })
    }
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

/// 检查更新
#[tauri::command]
pub async fn check_update(app: tauri::AppHandle) -> Result<UpdateInfo, String> {
    let updater = app.updater().map_err(|e| e.to_string())?;
    let update = updater.check().await.map_err(|e| e.to_string())?;

    let current_version = app.package_info().version.to_string();

    match update {
        Some(update) => {
            let latest_version = update.version.clone();
            Ok(UpdateInfo {
                has_update: true,
                latest_version,
                current_version,
            })
        }
        None => Ok(UpdateInfo {
            has_update: false,
            latest_version: current_version.clone(),
            current_version,
        }),
    }
}

/// 应用更新
#[tauri::command]
pub async fn apply_update(app: tauri::AppHandle) -> Result<(), String> {
    let updater = app.updater().map_err(|e| e.to_string())?;
    let update = updater.check().await.map_err(|e| e.to_string())?;

    if let Some(update) = update {
        // 停止子进程
        crate::process::kill_all_processes(&app).await;

        // 下载并安装更新
        update
            .download_and_install(
                |chunk_length, content_length| {
                    println!(
                        "[Updater] Download progress: {:?}/{:?}",
                        chunk_length, content_length
                    );
                },
                || {
                    println!("[Updater] Download finished");
                },
            )
            .await
            .map_err(|e| e.to_string())?;

        // 重启应用
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
#[tauri::command]
pub async fn get_app_state(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let backend_pid = *state.backend_pid.lock().unwrap();
    let snowluma_pid = *state.snowluma_pid.lock().unwrap();

    Ok(serde_json::json!({
        "backend_pid": backend_pid,
        "snowluma_pid": snowluma_pid,
        "backend_running": backend_pid.is_some(),
        "snowluma_running": snowluma_pid.is_some(),
    }))
}
