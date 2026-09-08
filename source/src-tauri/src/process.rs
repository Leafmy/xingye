use crate::AppState;
use std::fs::OpenOptions;
use std::path::PathBuf;
use std::process::Command;
use tauri::Manager;

// ==================== Windows Job Object（进程树统一管理） ====================
// 将主进程（xingye.exe）与其后启动的所有子进程（node：SnowLuma / bot-backend，
// 以及它们的下级进程）纳入同一个 Job Object，并设置 KILL_ON_JOB_CLOSE：
// - 任务管理器中主进程与子进程保持真实父子链，可整组展开与统一结束；
// - 主进程无论以何种方式退出（正常退出 / 任务管理器结束任务 / 崩溃），
//   系统关闭 Job 句柄即终止全部成员，不会残留孤儿 node 进程；
// - 子进程通过标准 spawn 继承 Job，无需额外配置。
#[cfg(target_os = "windows")]
pub fn setup_process_tree_job() {
    use std::ffi::c_void;
    use std::mem::size_of;
    use std::ptr::null_mut;

    type Handle = *mut c_void;

    #[repr(C)]
    #[derive(Default)]
    struct IoCounters {
        read_operation_count: u64,
        write_operation_count: u64,
        other_operation_count: u64,
        read_transfer_count: u64,
        write_transfer_count: u64,
        other_transfer_count: u64,
    }

    #[repr(C)]
    struct BasicLimitInformation {
        per_process_user_time_limit: i64,
        per_job_user_time_limit: i64,
        limit_flags: u32,
        minimum_working_set_size: usize,
        maximum_working_set_size: usize,
        active_process_limit: u32,
        affinity: usize,
        priority_class: u32,
        scheduling_class: u32,
    }

    #[repr(C)]
    struct ExtendedLimitInformation {
        basic: BasicLimitInformation,
        io_counters: IoCounters,
        process_memory_limit: usize,
        job_memory_limit: usize,
        peak_process_memory_used: usize,
        peak_job_memory_used: usize,
    }

    const JOBOBJECTEXTENDEDLIMITINFORMATION_CLASS: i32 = 9;
    const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE: u32 = 0x0000_2000;

    #[link(name = "kernel32")]
    extern "system" {
        fn CreateJobObjectW(lp_job_attributes: *const c_void, lp_name: *const u16) -> Handle;
        fn SetInformationJobObject(
            h_job: Handle,
            job_object_information_class: i32,
            lp_job_object_information: *const c_void,
            cb_job_object_information_length: u32,
        ) -> i32;
        fn AssignProcessToJobObject(h_job: Handle, h_process: Handle) -> i32;
        fn GetCurrentProcess() -> Handle;
    }

    unsafe {
        let job = CreateJobObjectW(null_mut(), null_mut());
        if job.is_null() {
            eprintln!(
                "[Xingye] CreateJobObjectW failed ({}); child processes will not be job-bound",
                std::io::Error::last_os_error()
            );
            return;
        }
        let mut limits = ExtendedLimitInformation {
            basic: BasicLimitInformation {
                per_process_user_time_limit: 0,
                per_job_user_time_limit: 0,
                limit_flags: JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
                minimum_working_set_size: 0,
                maximum_working_set_size: 0,
                active_process_limit: 0,
                affinity: 0,
                priority_class: 0,
                scheduling_class: 0,
            },
            io_counters: IoCounters::default(),
            process_memory_limit: 0,
            job_memory_limit: 0,
            peak_process_memory_used: 0,
            peak_job_memory_used: 0,
        };
        let set_ok = SetInformationJobObject(
            job,
            JOBOBJECTEXTENDEDLIMITINFORMATION_CLASS,
            &mut limits as *mut _ as *const c_void,
            size_of::<ExtendedLimitInformation>() as u32,
        );
        let assign_ok = AssignProcessToJobObject(job, GetCurrentProcess());
        // 故意不 CloseHandle：句柄随主进程存活，进程退出时系统关闭句柄，
        // 按 KILL_ON_JOB_CLOSE 终止所有成员（即"进程树统一回收"）。
        if set_ok == 0 || assign_ok == 0 {
            eprintln!(
                "[Xingye] JobObject setup incomplete (set={} assign={}, err={}); continuing without job binding",
                set_ok,
                assign_ok,
                std::io::Error::last_os_error()
            );
        } else {
            println!("[Xingye] Process-tree job object active (KILL_ON_JOB_CLOSE)");
        }
    }
}

/// 非 Windows 平台占位（保持调用方代码无差别）
#[cfg(not(target_os = "windows"))]
pub fn setup_process_tree_job() {}

// ==================== 窗口背景色深浅自适应 ====================
// WebView2 首帧绘制前窗口显示背景色（消除启动白屏/闪白）。
// tauri.conf.json 默认浅色 #f3f3f3；此处读取系统"应用深浅色"设置，
// 深色系统下切换为 #202020，与页面启动页的 prefers-color-scheme 保持一致。
#[cfg(target_os = "windows")]
pub fn apply_theme_background(app: &tauri::AppHandle) {
    use std::ffi::c_void;

    type Handle = *mut c_void;
    const HKEY_CURRENT_USER: Handle = 0x8000_0001usize as Handle;
    const RRF_RT_REG_DWORD: u32 = 0x0000_0002;
    const KEY_READ: u32 = 0x0002_0019;

    const SUB_KEY: &[u16] = &[
        b'S' as u16, b'o' as u16, b'f' as u16, b't' as u16, b'w' as u16, b'a' as u16, b'r' as u16, b'e' as u16, 0,
        b'M' as u16, b'i' as u16, b'c' as u16, b'r' as u16, b'o' as u16, b's' as u16, b'o' as u16, b'f' as u16, b't' as u16, 0,
        b'W' as u16, b'i' as u16, b'n' as u16, b'd' as u16, b'o' as u16, b'w' as u16, b's' as u16, 0,
        b'C' as u16, b'u' as u16, b'r' as u16, b'r' as u16, b'e' as u16, b'n' as u16, b't' as u16, b'V' as u16, b'e' as u16, b'r' as u16, b's' as u16, b'i' as u16, b'o' as u16, b'n' as u16, 0,
        b'T' as u16, b'h' as u16, b'e' as u16, b'm' as u16, b'e' as u16, b's' as u16, 0,
        b'P' as u16, b'e' as u16, b'r' as u16, b's' as u16, b'o' as u16, b'n' as u16, b'a' as u16, b'l' as u16, b'i' as u16, b'z' as u16, b'e' as u16, 0, 0,
    ];
    const VALUE_NAME: &[u16] = &[b'A' as u16, b'p' as u16, b'p' as u16, b's' as u16, b'U' as u16, b's' as u16, b'e' as u16, b'L' as u16, b'i' as u16, b'g' as u16, b'h' as u16, b't' as u16, b'T' as u16, b'h' as u16, b'e' as u16, b'm' as u16, b'e' as u16, 0];

    #[link(name = "advapi32")]
    extern "system" {
        fn RegGetValueW(
            hkey: Handle,
            lp_sub_key: *const u16,
            lp_value: *const u16,
            dw_flags: u32,
            pdw_type: *mut u32,
            pv_data: *mut c_void,
            pcb_data: *mut u32,
        ) -> i32;
        fn RegOpenKeyExW(hkey: Handle, lp_sub_key: *const u16, ul_options: u32, sam_desired: u32, phk_result: *mut Handle) -> i32;
        fn RegCloseKey(hkey: Handle) -> i32;
    }

    // 默认浅色（与 tauri.conf.json 一致）；读取失败不阻断启动
    let mut prefers_light = true;
    unsafe {
        let mut data: u32 = 1;
        let mut size = 4u32;
        // RegGetValueW 在部分受限环境可能返回拒绝访问，先用标准 API 打开键再取值
        let mut opened: Handle = std::ptr::null_mut();
        let open_ok = RegOpenKeyExW(HKEY_CURRENT_USER, SUB_KEY.as_ptr(), 0, KEY_READ, &mut opened) == 0;
        if open_ok && !opened.is_null() {
            let read_ok = RegGetValueW(
                opened,
                std::ptr::null(),
                VALUE_NAME.as_ptr(),
                RRF_RT_REG_DWORD,
                std::ptr::null_mut(),
                &mut data as *mut u32 as *mut c_void,
                &mut size,
            ) == 0;
            let _ = RegCloseKey(opened);
            if read_ok {
                prefers_light = data != 0;
            }
        }
    }

    // tauri::window::Color 为 RGBA；不透明 alpha=255
    let rgb = if prefers_light { (0xf3, 0xf3, 0xf3) } else { (0x20, 0x20, 0x20) };
    for label in ["main", "app-settings"] {
        if let Some(window) = app.get_webview_window(label) {
            let _ = window.set_background_color(Some(tauri::window::Color(rgb.0, rgb.1, rgb.2, 255)));
        }
    }
    println!(
        "[Xingye] Window background applied ({} theme)",
        if prefers_light { "light" } else { "dark" }
    );
}

/// 非 Windows 平台占位
#[cfg(not(target_os = "windows"))]
pub fn apply_theme_background(_app: &tauri::AppHandle) {}

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

// ==================== 星野模块主开关 ====================
// 星野模块 = SnowLuma（QQ 协议引擎）+ bot-backend（业务/面板后端）。
// 主开关独立于 App 生命周期持久化，App 启动时按此开关决定是否自动拉起模块；
// 托盘/面板可在运行期独立启动或停止模块，而不需要退出 App。
fn module_config_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    if let Ok(dir) = app.path().app_data_dir() {
        return Ok(dir.join("xingye_module.json"));
    }
    // 沙箱/受限环境可能无法解析 Known Folder，回退到用户 APPDATA，保证主开关可用
    if let Ok(base) = std::env::var("APPDATA") {
        return Ok(PathBuf::from(base).join("com.xingye.bot").join("xingye_module.json"));
    }
    Err("failed to resolve app data dir and APPDATA is unavailable".to_string())
}

/// 读取主开关配置；不存在时默认开启（兼容旧版本升级）
pub fn load_module_enabled(app: &tauri::AppHandle) -> bool {
    let Ok(path) = module_config_path(app) else {
        return true;
    };
    let mut enabled = true;
    if !path.exists() {
        println!("[Xingye] module config not found at {}, default enabled", path.display());
    } else {
        if let Ok(raw) = std::fs::read_to_string(&path) {
            if let Ok(value) = serde_json::from_str::<serde_json::Value>(&raw) {
                enabled = value["xingye_enabled"].as_bool().unwrap_or(true);
            }
        }
        println!("[Xingye] module config {} -> enabled={}", path.display(), enabled);
    }
    enabled
}

pub fn save_module_enabled(app: &tauri::AppHandle, enabled: bool) -> Result<(), String> {
    let path = module_config_path(app)?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("failed to create config dir: {}", e))?;
    }
    let payload = serde_json::json!({
        "xingye_enabled": enabled,
        "updated_at": std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0)
    });
    std::fs::write(&path, payload.to_string())
        .map_err(|e| format!("failed to save module switch: {}", e))
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
        "[Xingye] Starting SnowLuma: {} {:?} (parent pid={})",
        node_exec,
        script_path,
        std::process::id()
    );

    let log_dir = snowluma_dir.clone();
    let mut cmd = Command::new(&node_exec);
    cmd.arg(plain_path(&script_path))
        .current_dir(plain_path(&snowluma_dir))
        // 星野桌面壳启动 SnowLuma 时强制手动注入模式；
        // 用户需要在 QQ 管理页中自行指定 PID 后点击「注入」。
        .env("SNOWLUMA_HOOK_AUTOLOAD", "0")
        .stdout(std::process::Stdio::from(open_log(&log_dir, "snowluma.log")))
        .stderr(std::process::Stdio::from(open_log(&log_dir, "snowluma.log")));

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    let mut child = cmd.spawn().map_err(|e| format!("Failed to start SnowLuma: {}", e))?;

    let pid = child.id();
    println!(
        "[Xingye] SnowLuma started with PID: {} (parent pid={})",
        pid,
        std::process::id()
    );

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

    let node_exec = get_node_exec(resource_dir);

    // 只允许直接以 node.exe 拉起编译产物：经 npx/cmd 中转会产生短暂存活的
    // 中转进程，Windows 任务管理器按直接父子关系把后台进程归入前台应用组，
    // 中转进程退出后树形归属会变得不稳定。
    if !dist_script.exists() {
        return Err(
            "bot-backend/dist/index.js not found. Please run `npm run build` in src/bot-backend and copy dist/ to app/bot-backend/dist/ first.".to_string(),
        );
    }

    println!(
        "[Xingye] Starting backend: {} {:?} (parent pid={})",
        node_exec,
        dist_script,
        std::process::id()
    );

    let log_dir = backend_dir.clone();
    let mut cmd = Command::new(&node_exec);
    cmd.arg(plain_path(&dist_script))
        .current_dir(plain_path(&backend_dir))
        .stdout(std::process::Stdio::from(open_log(&log_dir, "backend.log")))
        .stderr(std::process::Stdio::from(open_log(&log_dir, "backend.log")));

    // 根目录布局下 app/bot-backend 是打包模板（无 node_modules），
    // 回退解析根目录源码 bot-backend/node_modules
    let src_modules = resource_dir.join("source").join("bot-backend").join("node_modules");
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
    println!(
        "[Xingye] Backend started with PID: {} (parent pid={})",
        pid,
        std::process::id()
    );

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

/// 启动整个星野模块（SnowLuma + bot-backend）并把主开关持久化为开启
pub async fn start_module(app: &tauri::AppHandle) -> Result<(), String> {
    {
        let state = app.state::<AppState>();
        let backend_running = state.backend_pid.lock().unwrap().is_some();
        let snowluma_running = state.snowluma_pid.lock().unwrap().is_some();
        if backend_running && snowluma_running {
            println!("[Xingye] Xingye module is already running, skip duplicate start");
            save_module_enabled(app, true)?;
            return Ok(());
        }
    }
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("failed to resolve resource dir: {}", e))?;
    {
        let state = app.state::<AppState>();
        let snowluma_running = state.snowluma_pid.lock().unwrap().is_some();
        let backend_running = state.backend_pid.lock().unwrap().is_some();
        if !snowluma_running {
            if let Err(e) = start_snowluma(app, &resource_dir).await {
                return Err(format!("SnowLuma 启动失败: {}", e));
            }
        }
        if !backend_running {
            if let Err(e) = start_backend(app, &resource_dir).await {
                kill_all_processes(app).await;
                return Err(format!("bot-backend 启动失败: {}", e));
            }
        }
    }
    save_module_enabled(app, true)?;
    println!("[Xingye] Xingye module started (master switch on)");
    Ok(())
}

/// 停止整个星野模块并把主开关持久化为关闭；App 壳保持运行
pub async fn stop_module(app: &tauri::AppHandle) -> Result<(), String> {
    kill_all_processes(app).await;
    save_module_enabled(app, false)?;
    println!("[Xingye] Xingye module stopped (master switch off)");
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


// ==================== 应用设置（App Settings）====================
// 存储应用级别的配置（如关闭行为），与 Bot 模块配置分离。
fn app_settings_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    if let Ok(dir) = app.path().app_data_dir() {
        return Ok(dir.join("xingye_app_settings.json"));
    }
    if let Ok(base) = std::env::var("APPDATA") {
        return Ok(PathBuf::from(base).join("com.xingye.bot").join("xingye_app_settings.json"));
    }
    Err("failed to resolve app data dir".to_string())
}

pub fn load_app_settings(app: &tauri::AppHandle) -> serde_json::Value {
    let Ok(path) = app_settings_path(app) else {
        return serde_json::json!({"close_behavior": "minimize"});
    };
    if !path.exists() {
        return serde_json::json!({"close_behavior": "minimize"});
    }
    std::fs::read_to_string(&path)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_else(|| serde_json::json!({"close_behavior": "minimize"}))
}

pub fn save_app_settings(app: &tauri::AppHandle, settings: &serde_json::Value) -> Result<(), String> {
    let path = app_settings_path(app)?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("failed to create config dir: {}", e))?;
    }
    std::fs::write(&path, serde_json::to_string_pretty(settings).unwrap_or_default())
        .map_err(|e| format!("failed to save app settings: {}", e))
}

pub fn get_close_behavior(app: &tauri::AppHandle) -> String {
    let settings = load_app_settings(app);
    settings["close_behavior"].as_str().unwrap_or("minimize").to_string()
}

pub fn set_close_behavior(app: &tauri::AppHandle, behavior: &str) -> Result<(), String> {
    let mut settings = load_app_settings(app);
    settings["close_behavior"] = serde_json::Value::String(behavior.to_string());
    save_app_settings(app, &settings)
}
