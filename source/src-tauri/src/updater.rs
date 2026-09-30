use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Serialize, Deserialize)]
pub struct UpdateManifest {
    pub version: String,
    pub build: u32,
    pub release: String,
    pub github_repo: String,
    pub files: std::collections::HashMap<String, FileInfo>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FileInfo {
    pub hash: String,
    pub size: u64,
    pub mtime: String,
}

/// 检查是否有更新
pub async fn check_for_updates(
    current_version: &str,
    github_repo: &str,
) -> Result<bool, String> {
    let url = format!(
        "https://raw.githubusercontent.com/{}/main/version.json",
        github_repo
    );

    let client = reqwest::Client::new();
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Failed to check updates: {}", e))?;

    let manifest: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse update manifest: {}", e))?;

    let latest_version = manifest["version"]
        .as_str()
        .unwrap_or("0.0.0")
        .to_string();

    // 简单版本比较
    Ok(latest_version != current_version)
}

/// 获取GitHub仓库信息
pub fn get_github_repo() -> String {
    // 从环境变量获取
    if let Ok(repo) = std::env::var("XINGYE_GITHUB_REPO") {
        return repo;
    }

    // 从version.json获取
    let version_path = PathBuf::from("app/version.json");
    if version_path.exists() {
        if let Ok(content) = std::fs::read_to_string(&version_path) {
            if let Ok(info) = serde_json::from_str::<serde_json::Value>(&content) {
                if let Some(repo) = info["github_repo"].as_str() {
                    return repo.to_string();
                }
            }
        }
    }

    "Leafmy/xingye".to_string()
}
