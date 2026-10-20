use std::{
    collections::HashSet,
    env,
    fs,
    io::{BufRead, BufReader, Read, Write},
    net::{TcpListener, TcpStream},
    path::PathBuf,
    process::{Command, Stdio},
    sync::Arc,
    thread,
    time::Instant,
};

const ALLOWED_HOSTS: &[&str] = &[
    "api.typesafe.ai",
    "integrate.api.nvidia.com",
    "api.cerebras.ai",
];

const MAX_BODY: usize = 2 * 1024 * 1024; // 2MB

struct Config {
    port: u16,
    allowed_origins: HashSet<String>,
    root_dir: PathBuf,
}

fn mime_type(ext: &str) -> Option<&'static str> {
    match ext {
        "html" => Some("text/html; charset=utf-8"),
        "js" | "mjs" => Some("text/javascript; charset=utf-8"),
        "css" => Some("text/css; charset=utf-8"),
        "json" => Some("application/json"),
        "svg" => Some("image/svg+xml"),
        "png" => Some("image/png"),
        "ico" => Some("image/x-icon"),
        "md" | "txt" => Some("text/plain; charset=utf-8"),
        _ => None,
    }
}

fn send_response(
    stream: &mut TcpStream,
    status_code: u16,
    status_text: &str,
    headers: &[(&str, &str)],
    body: &[u8],
) {
    let mut resp = format!("HTTP/1.1 {} {}\r\n", status_code, status_text);
    resp.push_str("Connection: close\r\n");
    resp.push_str("Cache-Control: no-store\r\n");
    resp.push_str("X-Content-Type-Options: nosniff\r\n");
    resp.push_str(&format!("Content-Length: {}\r\n", body.len()));

    for (k, v) in headers {
        resp.push_str(&format!("{}: {}\r\n", k, v));
    }
    resp.push_str("\r\n");

    let _ = stream.write_all(resp.as_bytes());
    if !body.is_empty() {
        let _ = stream.write_all(body);
    }
    let _ = stream.flush();
}

fn handle_connection(mut stream: TcpStream, config: Arc<Config>) {
    let started = Instant::now();
    let mut reader = BufReader::new(stream.try_clone().unwrap());
    let mut request_line = String::new();
    if reader.read_line(&mut request_line).unwrap_or(0) == 0 {
        return;
    }

    let parts: Vec<&str> = request_line.split_whitespace().collect();
    if parts.len() < 2 {
        return;
    }
    let method = parts[0];
    let full_uri = parts[1];

    let mut headers = Vec::new();
    let mut host_header = String::new();
    let mut origin_header = String::new();
    let mut auth_header = String::new();
    let mut content_type_header = String::new();
    let mut accept_header = String::new();
    let mut content_length: usize = 0;

    loop {
        let mut line = String::new();
        if reader.read_line(&mut line).unwrap_or(0) == 0 || line == "\r\n" || line == "\n" {
            break;
        }
        let line_trimmed = line.trim();
        if let Some((k, v)) = line_trimmed.split_once(':') {
            let k_lower = k.trim().to_ascii_lowercase();
            let v_val = v.trim().to_string();
            match k_lower.as_str() {
                "host" => host_header = v_val.clone(),
                "origin" => origin_header = v_val.clone(),
                "authorization" => auth_header = v_val.clone(),
                "content-type" => content_type_header = v_val.clone(),
                "accept" => accept_header = v_val.clone(),
                "content-length" => content_length = v_val.parse().unwrap_or(0),
                _ => {}
            }
            headers.push((k_lower, v_val));
        }
    }

    let valid_hosts = [
        format!("127.0.0.1:{}", config.port),
        format!("localhost:{}", config.port),
        "127.0.0.1".to_string(),
        "localhost".to_string(),
    ];

    if !host_header.is_empty() && !valid_hosts.iter().any(|h| host_header.eq_ignore_ascii_case(h)) {
        send_response(
            &mut stream,
            421,
            "Misdirected Request",
            &[("Content-Type", "text/plain")],
            b"Unknown host.",
        );
        return;
    }

    let cors_allowed = !origin_header.is_empty() && config.allowed_origins.contains(&origin_header);
    let mut cors_headers = Vec::new();
    if cors_allowed {
        cors_headers.push(("Access-Control-Allow-Origin", origin_header.as_str()));
        cors_headers.push(("Access-Control-Allow-Methods", "GET, POST, OPTIONS"));
        cors_headers.push((
            "Access-Control-Allow-Headers",
            "authorization, content-type, accept",
        ));
        cors_headers.push(("Access-Control-Allow-Private-Network", "true"));
        cors_headers.push(("Access-Control-Max-Age", "600"));
        cors_headers.push(("Vary", "Origin"));
    }

    let (path, query) = match full_uri.split_once('?') {
        Some((p, q)) => (p, Some(q)),
        None => (full_uri, None),
    };

    // Health check endpoint
    if path == "/health" {
        if method == "OPTIONS" {
            send_response(&mut stream, 204, "No Content", &cors_headers, b"");
            return;
        }
        let json_body = format!(
            r#"{{"ok":true,"app":"snap-judge-proxy-rs","forwards":[{}]}}"#,
            ALLOWED_HOSTS
                .iter()
                .map(|h| format!("\"{}\"", h))
                .collect::<Vec<_>>()
                .join(",")
        );
        let mut resp_headers = cors_headers.clone();
        resp_headers.push(("Content-Type", "application/json"));
        send_response(&mut stream, 200, "OK", &resp_headers, json_body.as_bytes());
        return;
    }

    // Proxy endpoint: /proxy/<host>/<rest>
    if path.starts_with("/proxy/") {
        let rest = &path["/proxy/".len()..];
        let (host, forward_path) = match rest.split_once('/') {
            Some((h, p)) => (h, format!("/{}", p)),
            None => (rest, "/".to_string()),
        };

        if !ALLOWED_HOSTS.contains(&host) {
            let msg = format!("Only {} are forwarded.", ALLOWED_HOSTS.join(", "));
            let mut h = cors_headers.clone();
            h.push(("Content-Type", "text/plain"));
            send_response(&mut stream, 403, "Forbidden", &h, msg.as_bytes());
            return;
        }

        if method == "OPTIONS" {
            send_response(&mut stream, 204, "No Content", &cors_headers, b"");
            return;
        }

        if method != "GET" && method != "POST" {
            let mut h = cors_headers.clone();
            h.push(("Content-Type", "text/plain"));
            send_response(
                &mut stream,
                405,
                "Method Not Allowed",
                &h,
                b"GET and POST only.",
            );
            return;
        }

        if content_length > MAX_BODY {
            let mut h = cors_headers.clone();
            h.push(("Content-Type", "text/plain"));
            send_response(
                &mut stream,
                413,
                "Payload Too Large",
                &h,
                b"Request body over 2 MB.",
            );
            return;
        }

        let mut body = vec![0u8; content_length];
        if content_length > 0 {
            let _ = reader.read_exact(&mut body);
        }

        let mut target_url = format!("https://{}{}", host, forward_path);
        if let Some(q) = query {
            target_url.push('?');
            target_url.push_str(q);
        }

        let mut cmd = Command::new("curl.exe");
        cmd.args(["-s", "-i", "-X", method, "--max-time", "90"]);

        if !auth_header.is_empty() {
            cmd.arg("-H").arg(format!("Authorization: {}", auth_header));
        }
        if !content_type_header.is_empty() {
            cmd.arg("-H").arg(format!("Content-Type: {}", content_type_header));
        }
        if !accept_header.is_empty() {
            cmd.arg("-H").arg(format!("Accept: {}", accept_header));
        }

        if method == "POST" && !body.is_empty() {
            cmd.stdin(Stdio::piped());
            cmd.arg("--data-binary").arg("@-");
        }

        cmd.arg(&target_url);

        let res = if method == "POST" && !body.is_empty() {
            let mut child = match cmd.stdout(Stdio::piped()).spawn() {
                Ok(c) => c,
                Err(_) => {
                    let mut h = cors_headers.clone();
                    h.push(("Content-Type", "application/json"));
                    let err = format!(r#"{{"error":{{"message":"Could not reach {}."}}}}"#, host);
                    send_response(&mut stream, 502, "Bad Gateway", &h, err.as_bytes());
                    return;
                }
            };
            if let Some(mut stdin) = child.stdin.take() {
                let _ = stdin.write_all(&body);
            }
            child.wait_with_output()
        } else {
            cmd.output()
        };

        match res {
            Ok(output) => {
                let stdout = output.stdout;
                let sep = b"\r\n\r\n";
                let split_idx = stdout.windows(4).position(|w| w == sep);

                if let Some(idx) = split_idx {
                    let header_bytes = &stdout[..idx];
                    let body_bytes = &stdout[idx + 4..];
                    let header_str = String::from_utf8_lossy(header_bytes);

                    let mut status_code: u16 = 200;
                    let mut status_text = "OK";
                    let mut res_content_type = "application/json".to_string();

                    for (i, line) in header_str.lines().enumerate() {
                        if i == 0 {
                            let p: Vec<&str> = line.split_whitespace().collect();
                            if p.len() >= 2 {
                                status_code = p[1].parse().unwrap_or(200);
                            }
                            if p.len() >= 3 {
                                status_text = p[2];
                            }
                        } else if let Some((k, v)) = line.split_once(':') {
                            if k.trim().eq_ignore_ascii_case("content-type") {
                                res_content_type = v.trim().to_string();
                            }
                        }
                    }

                    let mut out_headers = cors_headers.clone();
                    out_headers.push(("Content-Type", &res_content_type));
                    send_response(
                        &mut stream,
                        status_code,
                        status_text,
                        &out_headers,
                        body_bytes,
                    );
                    println!(
                        "{} {} -> {} in {:?}",
                        method,
                        target_url,
                        status_code,
                        started.elapsed()
                    );
                } else {
                    let mut h = cors_headers.clone();
                    h.push(("Content-Type", "application/json"));
                    let err = format!(r#"{{"error":{{"message":"Could not reach {}."}}}}"#, host);
                    send_response(&mut stream, 502, "Bad Gateway", &h, err.as_bytes());
                }
            }
            Err(_) => {
                let mut h = cors_headers.clone();
                h.push(("Content-Type", "application/json"));
                let err = format!(r#"{{"error":{{"message":"Could not reach {}."}}}}"#, host);
                send_response(&mut stream, 502, "Bad Gateway", &h, err.as_bytes());
            }
        }
        return;
    }

    // Static file serving fallback
    if method != "GET" && method != "HEAD" {
        send_response(
            &mut stream,
            405,
            "Method Not Allowed",
            &[("Content-Type", "text/plain")],
            b"GET only.",
        );
        return;
    }

    let rel_path = if path == "/" || path.ends_with('/') {
        let mut p = path.to_string();
        p.push_str("index.html");
        p
    } else {
        path.to_string()
    };

    let trimmed = rel_path.trim_start_matches('/');
    if trimmed.split('/').any(|part| part.starts_with('.'))
        || trimmed.starts_with("node_modules")
        || trimmed.starts_with("tests")
    {
        send_response(
            &mut stream,
            404,
            "Not Found",
            &[("Content-Type", "text/plain")],
            b"Not found.",
        );
        return;
    }

    let file_path = config.root_dir.join(trimmed);
    let ext = file_path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("");
    let mime = match mime_type(ext) {
        Some(m) => m,
        None => {
            send_response(
                &mut stream,
                404,
                "Not Found",
                &[("Content-Type", "text/plain")],
                b"Not found.",
            );
            return;
        }
    };

    match fs::read(&file_path) {
        Ok(data) => {
            let body_to_send = if method == "HEAD" { &[][..] } else { &data[..] };
            send_response(
                &mut stream,
                200,
                "OK",
                &[("Content-Type", mime)],
                body_to_send,
            );
        }
        Err(_) => {
            send_response(
                &mut stream,
                404,
                "Not Found",
                &[("Content-Type", "text/plain")],
                b"Not found.",
            );
        }
    }
}

fn main() {
    let args: Vec<String> = env::args().collect();
    let mut port: u16 = env::var("PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(8787);

    let mut auto_open = false;
    let mut custom_root: Option<PathBuf> = None;

    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "--port" | "-p" => {
                if i + 1 < args.len() {
                    if let Ok(parsed) = args[i + 1].parse() {
                        port = parsed;
                    }
                    i += 1;
                }
            }
            "--root" | "-r" => {
                if i + 1 < args.len() {
                    custom_root = Some(PathBuf::from(&args[i + 1]));
                    i += 1;
                }
            }
            "--open" => {
                auto_open = true;
            }
            "--help" | "-h" => {
                println!("Snap Judge Native Rust Proxy v0.1.0 (Zero Dependencies)");
                println!();
                println!("Usage: snap-judge-proxy [OPTIONS]");
                println!();
                println!("Options:");
                println!("  -p, --port <PORT>   Port to listen on (default: 8787)");
                println!("  -r, --root <DIR>    Root directory for static assets");
                println!("      --open          Automatically open default browser on launch");
                println!("  -h, --help          Print help");
                println!("  -v, --version       Print version");
                return;
            }
            "--version" | "-v" => {
                println!("snap-judge-proxy 0.1.0");
                return;
            }
            _ => {}
        }
        i += 1;
    }

    let exe_dir = env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()))
        .unwrap_or_else(|| PathBuf::from("."));

    let cwd = env::current_dir().unwrap_or_else(|_| PathBuf::from("."));

    let mut root_dir = custom_root.unwrap_or(cwd);
    if !root_dir.join("index.html").exists() {
        let mut cur = exe_dir.as_path();
        while let Some(parent) = cur.parent() {
            if parent.join("index.html").exists() {
                root_dir = parent.to_path_buf();
                break;
            }
            cur = parent;
        }
    }

    let mut allowed_origins = HashSet::new();
    allowed_origins.insert("https://arnav1771.github.io".to_string());
    allowed_origins.insert(format!("http://127.0.0.1:{}", port));
    allowed_origins.insert(format!("http://localhost:{}", port));

    if let Ok(extra) = env::var("SNAPJUDGE_ORIGINS") {
        for orig in extra.split(',') {
            let trimmed = orig.trim();
            if !trimmed.is_empty() {
                allowed_origins.insert(trimmed.to_string());
            }
        }
    }

    let config = Arc::new(Config {
        port,
        allowed_origins,
        root_dir: root_dir.clone(),
    });

    let addr = format!("127.0.0.1:{}", port);
    let listener = match TcpListener::bind(&addr) {
        Ok(l) => l,
        Err(e) => {
            eprintln!("Failed to bind to {}: {}", addr, e);
            std::process::exit(1);
        }
    };

    println!(
        "⚡ Snap Judge Native Rust Server on http://127.0.0.1:{}",
        port
    );
    println!("   Allowed forward hosts: {}", ALLOWED_HOSTS.join(", "));
    println!("   Root directory: {:?}", root_dir);
    println!("   Zero external dependencies, instant startup.");

    if auto_open {
        let url = format!("http://127.0.0.1:{}", port);
        #[cfg(target_os = "windows")]
        let _ = std::process::Command::new("cmd")
            .args(["/C", "start", &url])
            .spawn();
    }

    for stream in listener.incoming() {
        if let Ok(s) = stream {
            let cfg = Arc::clone(&config);
            thread::spawn(move || {
                handle_connection(s, cfg);
            });
        }
    }
}
