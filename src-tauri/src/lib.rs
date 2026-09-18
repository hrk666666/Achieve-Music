use std::collections::HashMap;
use std::fs;
use std::io::Read;
use std::net::TcpListener;
use std::path::PathBuf;
use std::sync::Arc;
use std::thread;
use std::time::Duration;
use tauri::Manager;

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
        "lrc" => "text/plain; charset=utf-8",
        "txt" => "text/plain; charset=utf-8",
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
    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .build()
    {
        Ok(c) => c,
        Err(_) => return false,
    };
    let resp = match client.head(url).send().await {
        Ok(r) => r,
        Err(_) => return false,
    };
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

    // 网易云：官方 outer/url 优先（无需登录、无需加密签名），成功后用真实 CDN 地址代理播放
    if server == "netease" {
        let outer = format!(
            "https://music.163.com/song/media/outer/url?id={}.mp3",
            song_id
        );
        if let Ok(resp) = client
            .get(&outer)
            .header("User-Agent", "Mozilla/5.0")
            .header("Referer", "https://music.163.com/")
            .send()
            .await
        {
            let final_url = resp.url().to_string();
            if resp.status().is_success() && validate_cdn(&final_url).await {
                println!("[music] netease 官方 outer/url 解析成功");
                return Some(final_url);
            }
        }
    }

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

fn start_http_server(dist_dir: PathBuf, music_dir: PathBuf) -> u16 {
    let port = find_available_port(1420);
    let dist = dist_dir.clone();
    let music = music_dir.clone();

    thread::spawn(move || {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        rt.block_on(async move {
            run_server(port, dist, music).await;
        });
    });

    // 等服务起来
    thread::sleep(Duration::from_millis(300));
    port
}

async fn run_server(port: u16, dist_dir: PathBuf, music_dir: PathBuf) {
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
        let music = music_dir.clone();
        tokio::spawn(async move {
            handle_connection(stream, dist, music).await;
        });
    }
}

async fn handle_connection(mut stream: tokio::net::TcpStream, dist_dir: PathBuf, music_dir: PathBuf) {
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
    } else if path == "/api/music-folder" {
        handle_music_folder(&mut response, &music_dir);
    } else if path == "/api/check-update" {
        handle_check_update(&mut response).await;
    } else if path.starts_with("/music/") {
        serve_music_file(path, &music_dir, &mut response);
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

// ===== 网易云官方接口直连（优先），失败时由调用方回落 Meting 代理 =====
fn netease_headers() -> reqwest::header::HeaderMap {
    let mut h = reqwest::header::HeaderMap::new();
    h.insert(
        reqwest::header::USER_AGENT,
        reqwest::header::HeaderValue::from_static(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
        ),
    );
    h.insert(
        reqwest::header::REFERER,
        reqwest::header::HeaderValue::from_static("https://music.163.com/"),
    );
    h
}

async fn netease_get_json(client: &reqwest::Client, url: &str) -> Option<serde_json::Value> {
    let resp = client.get(url).headers(netease_headers()).send().await.ok()?;
    let text = resp.text().await.ok()?;
    serde_json::from_str(&text).ok()
}

// 官方搜索，翻译成前端期望的 Meting 兼容数组
async fn netease_search(client: &reqwest::Client, keyword: &str) -> Option<String> {
    let url = format!(
        "https://music.163.com/api/search/get/?type=1&s={}&limit=20",
        urlencoding::encode(keyword)
    );
    let v = netease_get_json(client, &url).await?;
    if v.get("code").and_then(|c| c.as_i64()) != Some(200) {
        return None;
    }
    let songs = v.get("result")?.get("songs")?.as_array()?;
    let items: Vec<serde_json::Value> = songs
        .iter()
        .map(|s| {
            let id = s
                .get("id")
                .and_then(|x| x.as_i64())
                .unwrap_or(0)
                .to_string();
            let name = s.get("name").and_then(|x| x.as_str()).unwrap_or("").to_string();
            let artist = s
                .get("artists")
                .and_then(|a| a.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|a| a.get("name").and_then(|n| n.as_str()).map(ToString::to_string))
                        .collect::<Vec<_>>()
                        .join(", ")
                })
                .unwrap_or_default();
            let album = s
                .get("album")
                .and_then(|a| a.get("name"))
                .and_then(|n| n.as_str())
                .unwrap_or("")
                .to_string();
            let pic = s
                .get("album")
                .and_then(|a| a.get("picUrl"))
                .and_then(|p| p.as_str())
                .unwrap_or("")
                .to_string();
            let duration = s.get("duration").and_then(|d| d.as_i64()).unwrap_or(0);
            serde_json::json!({
                "id": id, "name": name, "artist": artist, "album": album,
                "pic_id": pic, "lyric_id": id, "url_id": id, "duration": duration
            })
        })
        .collect();
    Some(serde_json::to_string(&items).ok()?)
}

// 去掉 LRC 中的歌曲元信息行
fn filter_meta_lines(lrc: &str) -> String {
    lrc.lines()
        .map(str::trim_end)
        .filter(|l| {
            !l.contains("作词")
                && !l.contains("作曲")
                && !l.contains("编曲")
                && !l.contains("制作人")
                && !l.contains("OP")
                && !l.contains("SP")
        })
        .collect::<Vec<_>>()
        .join("\n")
}

// 官方歌词，返回前端期望的 {lyric, tlyric}
async fn netease_lyric(client: &reqwest::Client, song_id: &str) -> Option<String> {
    let url = format!(
        "https://music.163.com/api/song/lyric?id={}&lv=-1&kv=-1&tv=-1",
        song_id
    );
    let v = netease_get_json(client, &url).await?;
    if v.get("code").and_then(|c| c.as_i64()) != Some(200) {
        return None;
    }
    let lyric = filter_meta_lines(
        v.get("lrc")
            .and_then(|l| l.get("lyric"))
            .and_then(|x| x.as_str())
            .unwrap_or(""),
    );
    let tlyric = filter_meta_lines(
        v.get("tlyric")
            .and_then(|l| l.get("lyric"))
            .and_then(|x| x.as_str())
            .unwrap_or(""),
    );
    Some(serde_json::json!({ "lyric": lyric, "tlyric": tlyric }).to_string())
}

// 官方单曲封面 URL
async fn netease_song_pic(client: &reqwest::Client, song_id: &str) -> Option<String> {
    let url = format!(
        "https://music.163.com/api/song/detail/?id={}&ids=[{}]",
        song_id, song_id
    );
    let v = netease_get_json(client, &url).await?;
    v.get("songs")?
        .as_array()?
        .first()?
        .get("album")?
        .get("picUrl")?
        .as_str()
        .map(ToString::to_string)
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
            // 官方网易搜索优先（直连 music.163.com，不依赖第三方代理）
            if server == "netease" {
                if let Some(list) = netease_search(&client, &id).await {
                    response.extend_from_slice(
                        format!("HTTP/1.1 200 OK\r\n{}Content-Type: application/json; charset=utf-8\r\nContent-Length: {}\r\n\r\n{}", cors, list.len(), list).as_bytes(),
                    );
                    return;
                }
            }
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
            // 官方网易歌词优先（返回前端期望的 {lyric, tlyric} JSON）
            if server == "netease" {
                if let Some(body) = netease_lyric(&client, &id).await {
                    response.extend_from_slice(
                        format!("HTTP/1.1 200 OK\r\n{}Content-Type: application/json; charset=utf-8\r\nContent-Length: {}\r\n\r\n{}", cors, body.len(), body).as_bytes(),
                    );
                    return;
                }
            }
            // 回落 meting：把纯文本歌词包成前端期望的 JSON 结构
            let url = meting_url(&server, "lyric", &format!("id={}", id));
            match client.get(&url).send().await {
                Ok(resp) => match resp.text().await {
                    Ok(text) => {
                        let filtered = filter_meta_lines(&text);
                        let body = serde_json::json!({ "lyric": filtered, "tlyric": "" }).to_string();
                        response.extend_from_slice(
                            format!("HTTP/1.1 200 OK\r\n{}Content-Type: application/json; charset=utf-8\r\nContent-Length: {}\r\n\r\n{}", cors, body.len(), body).as_bytes(),
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
            // 官方优先：id 可能是完整封面 URL（官方搜索返回），也可能是歌曲 id
            if server == "netease" {
                if id.starts_with("http") {
                    response.extend_from_slice(
                        format!("HTTP/1.1 302 Found\r\nLocation: {}\r\nContent-Length: 0\r\n\r\n", id).as_bytes(),
                    );
                    return;
                }
                if let Some(pic_url) = netease_song_pic(&client, &id).await {
                    response.extend_from_slice(
                        format!("HTTP/1.1 302 Found\r\nLocation: {}\r\nContent-Length: 0\r\n\r\n", pic_url).as_bytes(),
                    );
                    return;
                }
            }
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

// 前端静态资源目录解析：
// - 绿色版（便携版）：exe 与 dist 同目录（./dist）
// - 安装版：exe 上一级下的 dist（../dist）
// 二者兼容，绿色版打成一个文件夹即可免安装运行。
fn find_dist_dir() -> PathBuf {
    if cfg!(debug_assertions) {
        return std::path::PathBuf::from("../dist");
    }
    let exe_parent = std::env::current_exe()
        .ok()
        .and_then(|e| e.parent().map(|p| p.to_path_buf()))
        .unwrap_or_default();
    let same_dir = exe_parent.join("dist");
    if same_dir.is_dir() {
        same_dir
    } else {
        exe_parent.join("../dist")
    }
}

// 音乐文件夹目录：与 dist 目录同级（绿色版 exe 同目录 / 安装版安装目录下）
fn find_music_dir() -> PathBuf {
    let base = find_dist_dir();
    base.parent()
        .map(|p| p.join("music"))
        .unwrap_or_else(|| PathBuf::from("music"))
}

// 启动时确保 music 目录存在；若首次创建则返回 true（供打开文件夹）
fn ensure_music_dir() -> bool {
    let music = find_music_dir();
    if music.is_dir() {
        return false;
    }
    if fs::create_dir_all(&music).is_ok() {
        println!("[music] 已创建音乐文件夹: {:?}", music);
        true
    } else {
        false
    }
}

// 打开文件夹（各平台系统命令）
fn open_folder(path: &PathBuf) {
    #[cfg(target_os = "windows")]
    {
        let _ = std::process::Command::new("explorer").arg(path).spawn();
    }
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("open").arg(path).spawn();
    }
    #[cfg(target_os = "linux")]
    {
        let _ = std::process::Command::new("xdg-open").arg(path).spawn();
    }
}

const AUDIO_EXTS: &[&str] = &["mp3", "flac", "wav", "m4a", "ogg", "aac"];

// 扫描 music 目录下的音频文件，返回 {name, url} JSON 列表
fn handle_music_folder(response: &mut Vec<u8>, music_dir: &PathBuf) {
    let cors = "Access-Control-Allow-Origin: *\r\n";
    let mut items: Vec<String> = Vec::new();
    if let Ok(entries) = fs::read_dir(music_dir) {
        let mut names: Vec<String> = entries
            .filter_map(|e| e.ok())
            .filter(|e| e.file_type().map(|t| t.is_file()).unwrap_or(false))
            .map(|e| e.file_name().to_string_lossy().to_string())
            .filter(|name| {
                let ext = name.split('.').last().unwrap_or("").to_lowercase();
                AUDIO_EXTS.contains(&ext.as_str())
            })
            .collect();
        names.sort();
        for name in names {
            // 文件名（含空格/中文）进行 URL 编码，保证路径可访问且与解码逻辑对应
            let url = format!("/music/{}", urlencoding::encode(&name));
            let json_name = name.replace('\\', "\\\\").replace('"', "\\\"");
            items.push(format!(r#"{{"name":"{}","url":"{}"}}"#, json_name, url));
        }
    }
    let body = format!("[{}]", items.join(","));
    response.extend_from_slice(
        format!(
            "HTTP/1.1 200 OK\r\n{}Content-Type: application/json; charset=utf-8\r\nContent-Length: {}\r\n\r\n{}",
            cors,
            body.len(),
            body
        )
        .as_bytes(),
    );
}

// 提供 /music/ 静态文件服务
fn serve_music_file(path: &str, music_dir: &PathBuf, response: &mut Vec<u8>) {
    let clean = path.trim_start_matches('/');
    let rel = clean.strip_prefix("music/").unwrap_or(clean);
    // 请求路径是 URL 编码形式（空格->%20 / 中文->%E4...），解码还原为真实文件名，否则查不到文件
    let rel = url_decode(rel);
    let file_path = music_dir.join(&rel);

    // 防路径穿越
    if !file_path.starts_with(music_dir) {
        response.extend_from_slice(b"HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n");
        return;
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
                    "HTTP/1.1 200 OK\r\nContent-Type: {}\r\nContent-Length: {}\r\nAccept-Ranges: bytes\r\nCache-Control: no-cache\r\n\r\n",
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

// 检查 GitHub release 是否有新版本（非强制）：返回 {current, latest, has_update, download_url}
async fn handle_check_update(response: &mut Vec<u8>) {
    let cors = "Access-Control-Allow-Origin: *\r\n";
    let current = env!("CARGO_PKG_VERSION");

    let result = async {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(10))
            .build()
            .map_err(|_| ())?;
        let resp = client
            .get("https://api.github.com/repos/hrk666666/Achieve-Music/releases/latest")
            .header("User-Agent", "AchieveMusic")
            .header("Accept", "application/vnd.github+json")
            .send()
            .await
            .map_err(|_| ())?;
        let text = resp.text().await.map_err(|_| ())?;
        let tag = extract_json_string(&text, "tag_name").ok_or(())?;
        let html = extract_json_string(&text, "html_url").ok_or(())?;
        let latest = tag.trim_start_matches('v');
        let has_update = latest != current;
        Ok::<(String, bool, String), ()>((latest.to_string(), has_update, html))
    }
    .await;

    let body = match result {
        Ok((latest, has_update, url)) => format!(
            r#"{{"current":"{}","latest":"{}","has_update":{},"download_url":"{}"}}"#,
            current, latest, has_update, url
        ),
        Err(_) => r#"{"current":"","latest":"","has_update":false,"download_url":""}"#.to_string(),
    };

    response.extend_from_slice(
        format!(
            "HTTP/1.1 200 OK\r\n{}Content-Type: application/json; charset=utf-8\r\nContent-Length: {}\r\n\r\n{}",
            cors,
            body.len(),
            body
        )
        .as_bytes(),
    );
}

fn extract_json_string(text: &str, key: &str) -> Option<String> {
    let needle = format!("\"{}\": \"", key);
    if let Some(start) = text.find(&needle) {
        let rest = &text[start + needle.len()..];
        let end = rest.find('"')?;
        return Some(rest[..end].to_string());
    }
    // 兼容无空格形式
    let needle2 = format!("\"{}\":\"", key);
    if let Some(start) = text.find(&needle2) {
        let rest = &text[start + needle2.len()..];
        let end = rest.find('"')?;
        return Some(rest[..end].to_string());
    }
    None
}

#[cfg(feature = "embedded-mode")]
fn run_embedded() {
    // 确保 music 文件夹存在；首次创建则自动打开
    let first_run = ensure_music_dir();
    if first_run {
        open_folder(&find_music_dir());
    }

    let dist_dir = find_dist_dir();
    let music_dir = find_music_dir();

    let port = start_http_server(dist_dir, music_dir);
    let url = format!("http://localhost:{}", port);

    tauri::Builder::default()
        .setup(move |app| {
            use tauri::Manager;
            if let Some(win) = app.handle().get_webview_window("main") {
                let _ = win.eval(&format!("window.location.replace('{}')", url));
                // 桌面端进入全屏；移动端 WebviewWindow 不提供 set_fullscreen
                #[cfg(desktop)]
                {
                    let _ = win.set_fullscreen(true);
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(feature = "server-mode")]
fn run_server_app() {
    // 确保 music 文件夹存在；首次创建则自动打开
    let first_run = ensure_music_dir();
    if first_run {
        open_folder(&find_music_dir());
    }

    let dist_dir = find_dist_dir();
    let music_dir = find_music_dir();

    let port = start_http_server(dist_dir, music_dir);
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

    let mut console_data_url = "data:text/html;charset=utf-8,".to_string();
    console_data_url.push_str(&urlencoding::encode(&console_html));

    tauri::Builder::default()
        .setup(move |app| {
            use tauri::Manager;
            if let Some(win) = app.handle().get_webview_window("main") {
                let _ = win.set_size(tauri::Size::Physical(tauri::PhysicalSize { width: 480, height: 320 }));
                let _ = win.set_resizable(false);
                let _ = win.set_title("Achieve Music 服务控制台");
                let _ = win.eval(&format!("window.location.replace('{}')", console_data_url));
            }
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


#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(feature = "server-mode")]
    run_server_app();
    #[cfg(feature = "embedded-mode")]
    run_embedded();
}
