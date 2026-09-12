#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

use std::collections::HashMap;
use std::fs;
use std::io::Read;
use std::net::TcpListener;
use std::path::PathBuf;
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use futures::StreamExt;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue, RANGE};
use serde::Deserialize;

const PLATFORMS: &[&str] = &["netease", "tencent", "kugou", "baidu", "kuwo"];

// 内嵌的 HTTP 服务器：静态文件 + 音乐代理
fn find_available_port(start: u16) -> u16 {
    for port in start..(start + 100) {
        if TcpListener::bind(("127.0.0.1", port)).is_ok() {
            return port;
        }
    }
    start
}

fn get_mime(ext: &str) -> &str {
    match ext {
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "application/javascript",
        "css" => "text/css",
        "json" => "application/json",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "svg" => "image/svg+xml",
        "ico" => "image/x-icon",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "flac" => "audio/flac",
        "m4a" => "audio/mp4",
        "ogg" => "audio/ogg",
        _ => "application/octet-stream",
    }
}

// Meting API 端点（国内服务器）
fn meting_url(server: &str, func: &str, query: &str) -> String {
    let host = match server {
        "tencent" => "https://api.i-meto.com/meting/api?server=tencent",
        "kugou" => "https://api.i-meto.com/meting/api?server=kugou",
        "baidu" => "https://api.i-meto.com/meting/api?server=baidu",
        "kuwo" => "https://api.i-meto.com/meting/api?server=kuwo",
        _ => "https://api.i-meto.com/meting/api?server=netease",
    };
    format!("{}&type={}&{}", host, func, query)
}

// 解析 API 返回的 URL
fn extract_url(text: &str) -> Option<String> {
    for part in text.split('"') {
        if part.starts_with("http") {
            return Some(part.to_string());
        }
    }
    None
}

async fn validate_cdn(url: &str) -> bool {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .build()
        .ok()?;
    let resp = client.head(url).send().await.ok()?;
    let len: u64 = resp
        .headers()
        .get("content-length")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);
    let status = resp.status();
    (status == reqwest::StatusCode::OK || status == reqwest::StatusCode::PARTIAL_CONTENT) && len > 2_000_000
}

async fn resolve_audio_url(server: &str, song_id: &str) -> Option<String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .ok()?;

    // 主平台
    let url = meting_url(server, "url", &format!("id={}&quality=320", song_id));
    if let Ok(resp) = client.get(&url).send().await {
        if let Ok(text) = resp.text().await {
            if let Some(audio) = extract_url(&text) {
                if validate_cdn(&audio).await {
                    return Some(audio);
                }
            }
        }
    }

    // fallback 跨平台
    for fb in PLATFORMS {
        if *fb == server {
            continue;
        }
        let url = meting_url(fb, "url", &format!("id={}&quality=320", song_id));
        if let Ok(resp) = client.get(&url).send().await {
            if let Ok(text) = resp.text().await {
                if let Some(audio) = extract_url(&text) {
                    if validate_cdn(&audio).await {
                        println!("[music] fallback 成功 -> {}", fb);
                        return Some(audio);
                    }
                }
            }
        }
    }
    None
}

fn start_http_server(dist_dir: PathBuf) -> u16 {
    let port = find_available_port(1420);
    let dist = dist_dir.clone();

    thread::spawn(move || {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        rt.block_on(async move {
            run_server(port, dist).await;
        });
    });

    // 等服务起来
    thread::sleep(Duration::from_millis(300));
    port
}

async fn run_server(port: u16, dist_dir: PathBuf) {
    let listener = match tokio::net::TcpListener::bind(("127.0.0.1", port)).await {
        Ok(l) => l,
        Err(e) => {
            eprintln!("[server] bind 失败: {}", e);
            return;
        }
    };
    println!("[server] 本地音乐服务已启动: http://localhost:{}", port);

    loop {
        let (stream, _) = match listener.accept().await {
            Ok(v) => v,
            Err(_) => continue,
        };
        let dist = dist_dir.clone();
        tokio::spawn(async move {
            handle_connection(stream, dist).await;
        });
    }
}

async fn handle_connection(stream: tokio::net::TcpStream, dist_dir: PathBuf) {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let mut buf = vec![0u8; 8192];
    let n = match stream.readable().await {
        Ok(_) => stream.read(&mut buf).await.unwrap_or(0),
        Err(_) => return,
    };
    if n == 0 {
        return;
    }

    let request = String::from_utf8_lossy(&buf[..n]);
    let mut lines = request.lines();
    let first = lines.next().unwrap_or("");
    let mut parts = first.split_whitespace();
    let method = parts.next().unwrap_or("GET");
    let raw_path = parts.next().unwrap_or("/");

    let (path, query) = match raw_path.find('?') {
        Some(i) => (&raw_path[..i], &raw_path[i + 1..]),
        None => (raw_path, ""),
    };

    let mut response = Vec::new();

    if path == "/api/music" {
        handle_api(method, query, &mut response, &buf[..n]).await;
    } else {
        serve_static(path, &dist_dir, &mut response);
    }

    let _ = stream.writable().await;
    let _ = stream.write_all(&response).await;
}

fn parse_query(query: &str) -> HashMap<String, String> {
    let mut map = HashMap::new();
    for pair in query.split('&') {
        if let Some((k, v)) = pair.split_once('=') {
            map.insert(
                url_decode(k).to_string(),
                url_decode(v).to_string(),
            );
        }
    }
    map
}

fn url_decode(s: &str) -> String {
    let mut result = Vec::new();
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(h) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                result.push(h);
                i += 3;
                continue;
            }
        }
        if bytes[i] == b'+' {
            result.push(b' ');
        } else {
            result.push(bytes[i]);
        }
        i += 1;
    }
    String::from_utf8_lossy(&result).to_string()
}

async fn handle_api(method: &str, query: &str, response: &mut Vec<u8>, raw_req: &[u8]) {
    let q = parse_query(query);
    let server = q.get("server").cloned().unwrap_or_else(|| "netease".into());
    let api_type = q.get("type").cloned().unwrap_or_else(|| "url".into());
    let id = q.get("id").cloned().unwrap_or_default();

    let cors = "Access-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, OPTIONS\r\n";

    if method == "OPTIONS" {
        response.extend_from_slice(format!("HTTP/1.1 200 OK\r\n{}Content-Length: 0\r\n\r\n", cors).as_bytes());
        return;
    }

    if id.is_empty() {
        let body = r#"{"error":"缺少 id 参数"}"#;
        response.extend_from_slice(
            format!("HTTP/1.1 400 Bad Request\r\n{}Content-Type: application/json\r\nContent-Length: {}\r\n\r\n{}", cors, body.len(), body)
                .as_bytes(),
        );
        return;
    }

    match api_type.as_str() {
        "search" => {
            let client = reqwest::Client::builder().timeout(Duration::from_secs(15)).build().unwrap();
            let url = meting_url(&server, "search", &format!("id={}", id));
            match client.get(&url).send().await {
                Ok(resp) => match resp.text().await {
                    Ok(text) => {
                        response.extend_from_slice(
                            format!("HTTP/1.1 200 OK\r\n{}Content-Type: application/json; charset=utf-8\r\nContent-Length: {}\r\n\r\n{}", cors, text.len(), text)
                                .as_bytes(),
                        );
                    }
                    Err(_) => send_error(response, cors, "搜索失败"),
                },
                Err(_) => send_error(response, cors, "搜索请求失败"),
            }
        }
        "lrc" => {
            let client = reqwest::Client::builder().timeout(Duration::from_secs(15)).build().unwrap();
            let url = meting_url(&server, "lyric", &format!("id={}", id));
            match client.get(&url).send().await {
                Ok(resp) => match resp.text().await {
                    Ok(text) => {
                        // 过滤 metadata
                        let filtered: String = text
                            .lines()
                            .filter(|l| {
                                !l.contains("作曲") && !l.contains("作词") && !l.contains("编曲")
                                    && !l.contains("制作人") && !l.contains("OP") && !l.contains("SP")
                            })
                            .collect::<Vec<_>>()
                            .join("\n");
                        response.extend_from_slice(
                            format!("HTTP/1.1 200 OK\r\n{}Content-Type: text/plain; charset=utf-8\r\nContent-Length: {}\r\n\r\n{}", cors, filtered.len(), filtered)
                                .as_bytes(),
                        );
                    }
                    Err(_) => send_error(response, cors, "歌词获取失败"),
                },
                Err(_) => send_error(response, cors, "歌词请求失败"),
            }
        }
        "url" => {
            if let Some(audio_url) = resolve_audio_url(&server, &id).await {
                // 流式代理
                let client = reqwest::Client::builder().timeout(Duration::from_secs(30)).build().unwrap();
                let mut headers = HeaderMap::new();
                headers.insert("User-Agent", HeaderValue::from_static("Mozilla/5.0"));
                headers.insert("Referer", HeaderValue::from_static("https://music.126.net/"));

                // 提取 Range
                if let Some(range) = extract_header(raw_req, "range") {
                    if let Ok(v) = HeaderValue::from_str(&range) {
                        headers.insert(RANGE, v);
                    }
                }

                match client.get(&audio_url).headers(headers).send().await {
                    Ok(resp) => {
                        let status = resp.status().as_u16();
                        let mut resp_headers = String::new();
                        resp_headers.push_str(&format!("HTTP/1.1 {} {}\r\n", status, resp.status().canonical_reason().unwrap_or("")));
                        resp_headers.push_str(cors);
                        for (k, v) in resp.headers() {
                            if matches!(k.as_str(), "content-type" | "content-length" | "content-range" | "accept-ranges") {
                                resp_headers.push_str(&format!("{}: {}\r\n", k, v.to_str().unwrap_or("")));
                            }
                        }
                        resp_headers.push_str("\r\n");
                        response.extend_from_slice(resp_headers.as_bytes());

                        let mut stream = resp.bytes_stream();
                        while let Some(chunk) = stream.next().await {
                            if let Ok(bytes) = chunk {
                                response.extend_from_slice(&bytes);
                            }
                        }
                    }
                    Err(_) => send_error(response, cors, "音频代理失败"),
                }
            } else {
                send_error(response, cors, "未找到可播放资源");
            }
        }
        "pic" => {
            let client = reqwest::Client::builder().timeout(Duration::from_secs(15)).build().unwrap();
            let url = meting_url(&server, "pic", &format!("id={}", id));
            if let Ok(resp) = client.get(&url).send().await {
                if let Ok(text) = resp.text().await {
                    if let Some(pic_url) = extract_url(&text) {
                        response.extend_from_slice(
                            format!("HTTP/1.1 302 Found\r\nLocation: {}\r\nContent-Length: 0\r\n\r\n", pic_url).as_bytes(),
                        );
                        return;
                    }
                }
            }
            send_error(response, cors, "封面获取失败");
        }
        _ => {
            let body = format!(r#"{{"error":"不支持的 type: {}"}}"#, api_type);
            response.extend_from_slice(
                format!("HTTP/1.1 400 Bad Request\r\n{}Content-Type: application/json\r\nContent-Length: {}\r\n\r\n{}", cors, body.len(), body)
                    .as_bytes(),
            );
        }
    }
}

fn extract_header(raw: &[u8], name: &str) -> Option<String> {
    let text = String::from_utf8_lossy(raw);
    for line in text.lines() {
        let lower = line.to_lowercase();
        if lower.starts_with(&format!("{}:", name)) {
            return Some(line[name.len() + 1..].trim().to_string());
        }
    }
    None
}

fn send_error(response: &mut Vec<u8>, cors: &str, msg: &str) {
    let body = format!(r#"{{"error":"{}"}}"#, msg);
    response.extend_from_slice(
        format!("HTTP/1.1 502 Bad Gateway\r\n{}Content-Type: application/json\r\nContent-Length: {}\r\n\r\n{}", cors, body.len(), body)
            .as_bytes(),
    );
}

fn serve_static(path: &str, dist_dir: &PathBuf, response: &mut Vec<u8>) {
    let clean = path.trim_start_matches('/');
    let mut file_path = dist_dir.join(if clean.is_empty() { "index.html" } else { clean });

    // 防止路径穿越
    if !file_path.starts_with(dist_dir) {
        response.extend_from_slice(b"HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n");
        return;
    }

    if !file_path.exists() || file_path.is_dir() {
        file_path = dist_dir.join("index.html");
    }

    match fs::read(&file_path) {
        Ok(data) => {
            let ext = file_path
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("");
            let mime = get_mime(ext);
            response.extend_from_slice(
                format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: {}\r\nContent-Length: {}\r\nCache-Control: no-cache\r\n\r\n",
                    mime,
                    data.len()
                )
                .as_bytes(),
            );
            response.extend_from_slice(&data);
        }
        Err(_) => {
            response.extend_from_slice(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n");
        }
    }
}

#[cfg(feature = "embedded-mode")]
fn main() {
    let dist_dir = if cfg!(debug_assertions) {
        std::path::PathBuf::from("../dist")
    } else {
        let exe = std::env::current_exe().unwrap_or_default();
        exe.parent().unwrap().join("../dist")
    };

    let port = start_http_server(dist_dir);
    let url = format!("http://localhost:{}", port);

    tauri::Builder::default()
        .setup(move |app| {
            let win = app.get_webview_window("main").unwrap();
            let _ = win.set_fullscreen(true);
            let _ = win.eval(&format!("window.location.replace('{}')", url));
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(feature = "server-mode")]
fn main() {
    let dist_dir = if cfg!(debug_assertions) {
        std::path::PathBuf::from("../dist")
    } else {
        let exe = std::env::current_exe().unwrap_or_default();
        exe.parent().unwrap().join("../dist")
    };

    let port = start_http_server(dist_dir);
    let url = format!("http://localhost:{}", port);

    // 控制台 HTML
    let console_html = format!(
        r#"<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Achieve Music 服务控制台</title>
<style>
*{{margin:0;padding:0;box-sizing:border-box}}
body{{font-family:"Segoe UI","Microsoft YaHei",sans-serif;background:#0a0a0f;color:#e5e7eb;height:100vh;display:flex;flex-direction:column;padding:24px}}
.header{{display:flex;align-items:center;gap:12px;margin-bottom:20px}}
.logo{{width:40px;height:40px;border-radius:12px;background:linear-gradient(135deg,#10b981,#059669);display:flex;align-items:center;justify-content:center;font-size:20px}}
.title{{font-size:18px;font-weight:600}}.subtitle{{font-size:12px;color:#6b7280;margin-top:2px}}
.status-box{{flex:1;background:#111118;border:1px solid #1f1f2e;border-radius:12px;padding:16px;overflow-y:auto;font-family:Consolas,monospace;font-size:12px;line-height:1.7}}
.status-box::-webkit-scrollbar{{width:6px}}.status-box::-webkit-scrollbar-thumb{{background:#2a2a3a;border-radius:3px}}
.line{{color:#9ca3af}}.line.ok{{color:#10b981}}.line.warn{{color:#f59e0b}}.line.url{{color:#60a5fa}}
.footer{{margin-top:16px;display:flex;gap:8px}}
.btn{{flex:1;padding:10px;border:none;border-radius:10px;font-size:13px;font-weight:500;cursor:pointer;transition:opacity .2s}}
.btn:hover{{opacity:.85}}.btn-primary{{background:#10b981;color:#000}}
</style></head><body>
<div class="header"><div class="logo">♪</div><div><div class="title">Achieve Music</div><div class="subtitle">本地音乐服务</div></div></div>
<div class="status-box" id="log"></div>
<div class="footer"><button class="btn btn-primary" onclick="openBrowser()">打开播放器</button></div>
<script>
const port={port};const log=document.getElementById('log');
function addLine(text,cls){{const d=document.createElement('div');d.className='line'+(cls?' '+cls:'');d.textContent=text;log.appendChild(d);log.scrollTop=log.scrollHeight}}
function openBrowser(){{window.location.href='http://localhost:'+port}}
addLine('[启动] 服务地址: http://localhost:'+port,'url');
addLine('[启动] 浏览器将自动打开...','ok');
addLine('[提示] 关闭本窗口将停止服务','warn');
</script></body></html>"#
    );

    let console_data_url = "data:text/html;charset=utf-8,".to_string();
    console_data_url.push_str(&urlencoding::encode(&console_html));

    tauri::Builder::default()
        .setup(move |app| {
            let win = app.get_webview_window("main").unwrap();
            let _ = win.set_size(tauri::Size::Physical(tauri::PhysicalSize { width: 480, height: 320 }));
            let _ = win.set_resizable(false);
            let _ = win.set_title("Achieve Music 服务控制台");
            let _ = win.eval(&format!("window.location.replace('{}')", console_data_url));
            // 自动打开系统浏览器
            let url2 = url.clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(Duration::from_millis(800)).await;
                #[cfg(target_os = "windows")]
                {
                    let _ = std::process::Command::new("cmd")
                        .args(["/C", "start", "", &url2])
                        .spawn();
                }
                #[cfg(target_os = "macos")]
                {
                    let _ = std::process::Command::new("open").arg(&url2).spawn();
                }
                #[cfg(target_os = "linux")]
                {
                    let _ = std::process::Command::new("xdg-open").arg(&url2).spawn();
                }
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
