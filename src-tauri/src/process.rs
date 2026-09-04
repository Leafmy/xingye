use crate::AppState;
use std::fs::OpenOptions;
use std::path::PathBuf;
use std::process::Command;
use tauri::Manager;

/// 打开子进程日志文件（追加模式），用于捕获子进程输出便于诊断
fn open_log(dir: &PathBuf, name: &str) -> std::fs::File {
    let log_dir = dir.join("logs");
    let _ = std::fs::create_dir_all(&log_dir);
    match OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_dir.join(name))
    {
        Ok(f) => f,
        Err(_) => OpenOptions::new()
            .create(true)
            .append(true)
            .open(std::env::temp_dir().join(name))
            .unwrap_or_else(|_| {
                OpenOptions::new()
                    .create(true)
                    .append(true)
                    .open("NUL")
                    .expect("cannot open NUL")
            }),
    }
}

/// 去掉 Windows verbatim 路径前缀（\\?\），node 等子进程无法处理该前缀
fn plain_path(p: &PathBuf) -> String {
    let s = p.to_string_lossy().to_string();
    if let Some(stripped) = s.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{}", stripped)
    } else if let Some(stripped) = s.strip_prefix(r"\\?\") {
        stripped.to_string()
    } else {
        s
    }
}

/// 获取内置Node.js路径
fn get_node_exec(resource_dir: &PathBuf) -> String {
    let builtin_node = resource_dir.join("node").join("node.exe");
    if builtin_node.exists() {
        plain_path(&builtin_node)
    } else {
        "node".to_string()
    }
}

/// 启动 SnowLuma 子进程
pub async fn start_snowluma(
    app: &tauri::AppHandle,
    resource_dir: &PathBuf,
) -> Result<(), String> {
    let snowluma_dir = resource_dir.join("SnowLuma");
    let script_path = snowluma_dir.join("index.mjs");

    if !script_path.exists() {
        eprintln!("[Xingye] SnowLuma script not found: {:?}", script_path);
        return Err("SnowLuma script not found".to_string());
    }

    let node_exec = get_node_exec(resource_dir);
    println!(
        "[Xingye] Starting SnowLuma: {} {:?}",
        node_exec, script_path
    );

    let log_dir = snowluma_dir.clone();
    let mut cmd = Command::new(&node_exec);
    cmd.arg(plain_path(&script_path))
        .current_dir(plain_path(&snowluma_dir))
        .stdout(std::process::Stdio::from(open_log(&log_dir, "snowluma.log")))
        .stderr(std::process::Stdio::from(open_log(&log_dir, "snowluma.log")));

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    let mut child = cmd.spawn().map_err(|e| format!("Failed to start SnowLuma: {}", e))?;

    let pid = child.id();
    println!("[Xingye] SnowLuma started with PID: {}", pid);

    // 保存PID
    let state = app.state::<AppState>();
    *state.snowluma_pid.lock().unwrap() = Some(pid);

    // 异步等待进程结束
    let app_handle = app.clone();
    tokio::spawn(async move {
        let status = child.wait();
        match status {
            Ok(s) => {
                println!("[SnowLuma] Exited with code: {}", s);
                use std::io::Write;
                if let Ok(mut f) = OpenOptions::new().append(true).open(log_dir.join("snowluma.log")) {
                    let _ = writeln!(f, "[wrapper] SnowLuma exited: {}", s);
                }
            }
            Err(e) => {
                eprintln!("[SnowLuma] Error: {}", e);
            }
        }
        // 清除PID
        let state = app_handle.state::<AppState>();
        *state.snowluma_pid.lock().unwrap() = None;
    });

    Ok(())
}

/// 启动 bot-backend 子进程
pub async fn start_backend(
    app: &tauri::AppHandle,
    resource_dir: &PathBuf,
) -> Result<(), String> {
    let backend_dir = resource_dir.join("app").join("bot-backend");
    let dist_script = backend_dir.join("dist").join("index.js");
    let _ts_script = backend_dir.join("index.ts");

    let node_exec = get_node_exec(resource_dir);

    // 判断使用编译后的JS还是TypeScript
    let (script, args) = if dist_script.exists() {
        (
            node_exec.clone(),
            vec![plain_path(&dist_script)],
        )
    } else {
        (
            "npx".to_string(),
            vec!["ts-node".to_string(), "index.ts".to_string()],
        )
    };

    println!("[Xingye] Starting backend: {} {:?}", script, args);

    let log_dir = backend_dir.clone();
    let mut cmd = Command::new(&script);
    cmd.args(&args)
        .current_dir(plain_path(&backend_dir))
        .stdout(std::process::Stdio::from(open_log(&log_dir, "backend.log")))
        .stderr(std::process::Stdio::from(open_log(&log_dir, "backend.log")));

    // 根目录布局下 app/bot-backend 是打包模板（无 node_modules），
    // 回退解析根目录源码 bot-backend/node_modules
    let src_modules = resource_dir.join("bot-backend").join("node_modules");
    if src_modules.exists() {
        cmd.env("NODE_PATH", plain_path(&src_modules));
    }

    // 设置环境变量
    cmd.env("NODE_ENV", "production");
    if let Ok(proxy) = std::env::var("STEAM_PROXY_URL") {
        cmd.env("STEAM_PROXY_URL", proxy);
    } else {
        cmd.env("STEAM_PROXY_URL", "http://127.0.0.1:7890");
    }

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to start backend: {}", e))?;

    let pid = child.id();
    println!("[Xingye] Backend started with PID: {}", pid);

    // 保存PID
    let state = app.state::<AppState>();
    *state.backend_pid.lock().unwrap() = Some(pid);

    // 异步等待进程结束
    let app_handle = app.clone();
    tokio::spawn(async move {
        let status = child.wait();
        match status {
            Ok(s) => {
                println!("[Backend] Exited with code: {}", s);
                use std::io::Write;
                if let Ok(mut f) = OpenOptions::new().append(true).open(log_dir.join("backend.log")) {
                    let _ = writeln!(f, "[wrapper] Backend exited: {}", s);
                }
            }
            Err(e) => {
                eprintln!("[Backend] Error: {}", e);
            }
        }
        // 清除PID
        let state = app_handle.state::<AppState>();
        *state.backend_pid.lock().unwrap() = None;
    });

    // 等待后端启动
    tokio::time::sleep(std::time::Duration::from_secs(2)).await;

    Ok(())
}

/// 杀死所有子进程
pub async fn kill_all_processes(app: &tauri::AppHandle) {
    let state = app.state::<AppState>();

    // 杀死 backend
    let backend_pid = *state.backend_pid.lock().unwrap();
    if let Some(pid) = backend_pid {
        println!("[Xingye] Killing backend process: {}", pid);
        kill_process(pid);
        *state.backend_pid.lock().unwrap() = None;
    }

    // 杀死 SnowLuma
    let snowluma_pid = *state.snowluma_pid.lock().unwrap();
    if let Some(pid) = snowluma_pid {
        println!("[Xingye] Killing SnowLuma process: {}", pid);
        kill_process(pid);
        *state.snowluma_pid.lock().unwrap() = None;
    }
}

/// 杀死指定PID的进程
fn kill_process(pid: u32) {
    #[cfg(target_os = "windows")]
    {
        let _ = Command::new("taskkill")
            .args(&["/PID", &pid.to_string(), "/F", "/T"])
            .output();
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = Command::new("kill")
            .args(&["-9", &pid.to_string()])
            .output();
    }
}
