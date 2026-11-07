use std::io::{Read, Write};
use std::net::{Ipv4Addr, TcpListener, TcpStream, ToSocketAddrs};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

const MAX_BODY: usize = 8 * 1024 * 1024;
const MAX_REPLY: usize = 2 * 1024 * 1024;
const CONFIRM_WAIT: Duration = Duration::from_secs(180);

const UNREACHABLE: &str = "Could not reach the computer. Use Export and Import if this Wi-Fi blocks device-to-device traffic.";
const NO_ANSWER: &str = "The computer did not answer. Accept the transfer on the computer, or try again.";
const BAD_CODE: &str = "The code did not match. Scan the code again.";
const CLOSED: &str = "{\"ok\":false,\"reason\":\"The computer closed the session.\"}";
const TIMEOUT: &str = "{\"ok\":false,\"reason\":\"The computer did not answer. Accept the transfer on the computer, or try again.\"}";
const DENIED: &str = "{\"ok\":false,\"reason\":\"The code did not match. Scan the code again.\"}";
const BUSY: &str = "{\"ok\":false,\"reason\":\"This computer is already confirming a transfer.\"}";
const UNREADABLE: &str = "{\"ok\":false,\"reason\":\"Could not read this ledger\"}";

struct Decision {
    status: u16,
    body: String,
}

struct Session {
    id: u64,
    port: u16,
    shutdown: Arc<AtomicBool>,
    pending: Arc<Mutex<Option<mpsc::Sender<Decision>>>>,
    thread: Option<thread::JoinHandle<()>>,
}

pub struct HandoffHost {
    next_id: u64,
    session: Option<Session>,
}

impl Default for HandoffHost {
    fn default() -> Self {
        Self { next_id: 1, session: None }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HandoffSessionInfo {
    id: u64,
    port: u16,
    token: String,
    addresses: Vec<String>,
    loopback_only: bool,
}

#[derive(Clone, Serialize)]
struct HandoffEventBody {
    body: String,
}

#[derive(Serialize)]
pub struct HandoffSendResult {
    status: u16,
    body: String,
}

#[tauri::command]
pub fn start_handoff(app: AppHandle, host: State<'_, Mutex<HandoffHost>>) -> Result<HandoffSessionInfo, String> {
    let mut host = lock(&host);
    if let Some(mut previous) = host.session.take() {
        stop_session(&mut previous);
    }
    let listener = TcpListener::bind("0.0.0.0:0").map_err(|_| "Could not listen for the phone.".to_string())?;
    let port = listener.local_addr().map_err(|_| "Could not listen for the phone.".to_string())?.port();
    let token = random_token()?;
    let shutdown = Arc::new(AtomicBool::new(false));
    let pending = Arc::new(Mutex::new(None));
    let id = host.next_id;
    host.next_id = host.next_id.wrapping_add(1);
    let thread = spawn_listener(app, listener, token.clone(), shutdown.clone(), pending.clone());
    host.session = Some(Session { id, port, shutdown, pending, thread: Some(thread) });
    let (addresses, loopback_only) = list_addresses();
    Ok(HandoffSessionInfo { id, port, token, addresses, loopback_only })
}

#[tauri::command]
pub fn stop_handoff(host: State<'_, Mutex<HandoffHost>>, id: u64) -> Result<(), String> {
    let mut host = lock(&host);
    let Some(session) = host.session.as_ref() else {
        return Ok(());
    };
    if session.id != id {
        return Ok(());
    }
    if let Some(mut session) = host.session.take() {
        stop_session(&mut session);
    }
    Ok(())
}

#[tauri::command]
pub fn complete_handoff(host: State<'_, Mutex<HandoffHost>>, status: u16, body: String) -> Result<(), String> {
    if body.len() > MAX_REPLY {
        return Err("Reply is too large.".to_string());
    }
    if !matches!(status, 200 | 400 | 409 | 500) {
        return Err("Could not finish the transfer.".to_string());
    }
    let host = lock(&host);
    let Some(session) = host.session.as_ref() else {
        return Err("The phone disconnected.".to_string());
    };
    let sender = lock(&session.pending).take().ok_or_else(|| "Nothing to confirm.".to_string())?;
    sender.send(Decision { status, body }).map_err(|_| "The phone disconnected.".to_string())
}

#[tauri::command]
pub async fn send_handoff(host: String, port: u16, token: String, body: String) -> Result<HandoffSendResult, String> {
    tauri::async_runtime::spawn_blocking(move || post_handoff(&host, port, &token, &body))
        .await
        .map_err(|_| UNREACHABLE.to_string())?
}

fn spawn_listener(
    app: AppHandle,
    listener: TcpListener,
    token: String,
    shutdown: Arc<AtomicBool>,
    pending: Arc<Mutex<Option<mpsc::Sender<Decision>>>>,
) -> thread::JoinHandle<()> {
    thread::Builder::new()
        .name("fintrack-handoff".to_string())
        .spawn(move || {
            let on_body: Arc<dyn Fn(String) + Send + Sync> = Arc::new(move |body| {
                let _ = app.emit("handoff-request", HandoffEventBody { body });
            });
            serve(listener, token, shutdown, pending, on_body);
        })
        .expect("handoff thread")
}

fn stop_session(session: &mut Session) {
    session.shutdown.store(true, Ordering::SeqCst);
    lock(&session.pending).take();
    let _ = TcpStream::connect_timeout(
        &std::net::SocketAddr::from(([127, 0, 0, 1], session.port)),
        Duration::from_millis(500),
    );
    if let Some(thread) = session.thread.take() {
        let _ = thread.join();
    }
}

fn serve(
    listener: TcpListener,
    token: String,
    shutdown: Arc<AtomicBool>,
    pending: Arc<Mutex<Option<mpsc::Sender<Decision>>>>,
    on_body: Arc<dyn Fn(String) + Send + Sync>,
) {
    while !shutdown.load(Ordering::SeqCst) {
        match listener.accept() {
            Ok((stream, _)) => {
                if shutdown.load(Ordering::SeqCst) {
                    break;
                }
                handle_connection(stream, &token, &shutdown, &pending, on_body.as_ref());
            }
            Err(err) if err.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(_) => break,
        }
    }
}

fn handle_connection(
    mut stream: TcpStream,
    token: &str,
    shutdown: &AtomicBool,
    pending: &Mutex<Option<mpsc::Sender<Decision>>>,
    on_body: &dyn Fn(String),
) {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(10)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(10)));
    let Ok(head) = read_head(&mut stream) else {
        return;
    };
    let Ok(incoming) = parse_head(&head) else {
        let _ = write_response(&mut stream, 400, UNREADABLE);
        return;
    };
    if incoming.method.eq_ignore_ascii_case("OPTIONS") {
        let _ = write_response(&mut stream, 204, "");
        return;
    }
    if !incoming.method.eq_ignore_ascii_case("POST") || incoming.path != "/v1/handoff" {
        discard_body(&mut stream, incoming.content_length);
        let _ = write_response(&mut stream, 405, "{\"ok\":false,\"reason\":\"Use the FinTrack phone app to send.\"}");
        return;
    }
    if !tokens_match(token, &incoming.token) {
        discard_body(&mut stream, incoming.content_length);
        let _ = write_response(&mut stream, 401, DENIED);
        return;
    }
    let Some(length) = incoming.content_length else {
        let _ = write_response(&mut stream, 411, UNREADABLE);
        return;
    };
    if length > MAX_BODY {
        let _ = write_response(&mut stream, 413, "{\"ok\":false,\"reason\":\"This ledger is too large to send.\"}");
        return;
    }
    let Ok(bytes) = read_exact(&mut stream, length) else {
        return;
    };
    let Ok(text) = String::from_utf8(bytes) else {
        let _ = write_response(&mut stream, 400, UNREADABLE);
        return;
    };
    let _ = stream.set_read_timeout(None);
    let (tx, rx) = mpsc::channel();
    {
        let mut slot = lock(pending);
        if slot.is_some() {
            drop(slot);
            let _ = write_response(&mut stream, 409, BUSY);
            return;
        }
        *slot = Some(tx);
    }
    if shutdown.load(Ordering::SeqCst) {
        lock(pending).take();
        let _ = write_response(&mut stream, 503, CLOSED);
        return;
    }
    on_body(text);
    let decision = match rx.recv_timeout(CONFIRM_WAIT) {
        Ok(decision) => decision,
        Err(RecvTimeoutError::Timeout) => Decision { status: 408, body: TIMEOUT.to_string() },
        Err(RecvTimeoutError::Disconnected) => Decision { status: 503, body: CLOSED.to_string() },
    };
    lock(pending).take();
    let _ = stream.set_write_timeout(Some(Duration::from_secs(10)));
    let _ = write_response(&mut stream, decision.status, &decision.body);
}

pub(crate) fn post_handoff(host: &str, port: u16, token: &str, body: &str) -> Result<HandoffSendResult, String> {
    if port == 0 || !valid_host(host) {
        return Err(UNREACHABLE.to_string());
    }
    if token.len() != 32 || !token.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(BAD_CODE.to_string());
    }
    if body.len() > MAX_BODY {
        return Err("This ledger is too large to send.".to_string());
    }
    let address = format!("{host}:{port}");
    let mut targets = address.to_socket_addrs_checked()?;
    let Some(target) = targets.next() else {
        return Err(UNREACHABLE.to_string());
    };
    let mut stream = TcpStream::connect_timeout(&target, Duration::from_secs(5)).map_err(|err| io_message(&err))?;
    stream.set_read_timeout(Some(CONFIRM_WAIT)).map_err(|err| io_message(&err))?;
    stream.set_write_timeout(Some(Duration::from_secs(10))).map_err(|err| io_message(&err))?;
    let head = format!(
        "POST /v1/handoff?token={token} HTTP/1.1\r\nHost: {host}:{port}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len(),
    );
    stream.write_all(head.as_bytes()).map_err(|err| io_message(&err))?;
    stream.write_all(body.as_bytes()).map_err(|err| io_message(&err))?;
    stream.flush().map_err(|err| io_message(&err))?;
    let response = read_head(&mut stream).map_err(|err| io_message(&err))?;
    let status = parse_status(&response).map_err(|_| UNREACHABLE.to_string())?;
    let length = parse_length(&response).map_err(|_| UNREACHABLE.to_string())?;
    if length > MAX_REPLY {
        return Err(UNREACHABLE.to_string());
    }
    let bytes = read_exact(&mut stream, length).map_err(|err| io_message(&err))?;
    let text = String::from_utf8(bytes).map_err(|_| UNREACHABLE.to_string())?;
    Ok(HandoffSendResult { status, body: text })
}

fn discard_body(stream: &mut TcpStream, length: Option<usize>) {
    let Some(length) = length else {
        return;
    };
    if length == 0 || length > MAX_BODY {
        return;
    }
    let _ = read_exact(stream, length);
}

fn io_message(err: &std::io::Error) -> String {
    if err.kind() == std::io::ErrorKind::TimedOut || err.kind() == std::io::ErrorKind::WouldBlock {
        NO_ANSWER.to_string()
    } else {
        UNREACHABLE.to_string()
    }
}

trait SocketAddrs {
    fn to_socket_addrs_checked(&self) -> Result<std::vec::IntoIter<std::net::SocketAddr>, String>;
}

impl SocketAddrs for String {
    fn to_socket_addrs_checked(&self) -> Result<std::vec::IntoIter<std::net::SocketAddr>, String> {
        self.to_socket_addrs().map_err(|_| UNREACHABLE.to_string())
    }
}

fn list_addresses() -> (Vec<String>, bool) {
    let ips = if_addrs::get_if_addrs()
        .map(|interfaces| {
            let mut found = Vec::new();
            for iface in interfaces {
                if iface.is_loopback() {
                    continue;
                }
                if let if_addrs::IfAddr::V4(addr) = iface.addr {
                    if private_rank(addr.ip).is_some() {
                        found.push(addr.ip);
                    }
                }
            }
            sort_addresses(found)
        })
        .unwrap_or_default();
    if ips.is_empty() {
        (vec!["127.0.0.1".to_string()], true)
    } else {
        (ips, false)
    }
}

fn sort_addresses(ips: Vec<Ipv4Addr>) -> Vec<String> {
    let mut ranked: Vec<(u8, Ipv4Addr)> = ips.into_iter().filter_map(|ip| private_rank(ip).map(|rank| (rank, ip))).collect();
    ranked.sort_by(|left, right| left.0.cmp(&right.0).then(left.1.cmp(&right.1)));
    ranked.dedup_by(|left, right| left.1 == right.1);
    ranked.into_iter().map(|(_, ip)| ip.to_string()).collect()
}

fn private_rank(ip: Ipv4Addr) -> Option<u8> {
    let [first, second, _, _] = ip.octets();
    if first == 192 && second == 168 {
        Some(0)
    } else if first == 10 {
        Some(1)
    } else if first == 172 && (16..32).contains(&second) {
        Some(2)
    } else {
        None
    }
}

fn random_token() -> Result<String, String> {
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes).map_err(|_| "Could not listen for the phone.".to_string())?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn tokens_match(expected: &str, provided: &str) -> bool {
    let left = expected.as_bytes();
    let right = provided.as_bytes();
    if left.len() != right.len() {
        return false;
    }
    let mut diff = 0u8;
    for (expected_byte, provided_byte) in left.iter().zip(right.iter()) {
        diff |= expected_byte ^ provided_byte;
    }
    diff == 0
}

fn valid_host(host: &str) -> bool {
    !host.is_empty()
        && host.len() <= 253
        && !host.contains(':')
        && host.bytes().all(|byte| byte.is_ascii() && !byte.is_ascii_whitespace() && !matches!(byte, b'/' | b'\\' | b'?' | b'#'))
}

struct Incoming {
    method: String,
    path: String,
    token: String,
    content_length: Option<usize>,
}

fn parse_head(head: &str) -> Result<Incoming, ()> {
    let mut lines = head.split("\r\n");
    let request = lines.next().ok_or(())?;
    let mut parts = request.split(' ');
    let method = parts.next().ok_or(())?.to_string();
    let target = parts.next().ok_or(())?;
    if target.len() > 512 {
        return Err(());
    }
    let (path, query) = target.split_once('?').unwrap_or((target, ""));
    let mut content_length = None;
    let mut saw_length = false;
    for line in lines {
        if line.is_empty() {
            continue;
        }
        let Some((name, value)) = line.split_once(':') else {
            continue;
        };
        if name.eq_ignore_ascii_case("content-length") {
            if saw_length {
                return Err(());
            }
            saw_length = true;
            content_length = Some(value.trim().parse::<usize>().map_err(|_| ())?);
        }
    }
    Ok(Incoming {
        method,
        path: path.to_string(),
        token: percent_decode(query_token(query).trim()),
        content_length,
    })
}

fn query_token(query: &str) -> &str {
    query.split('&').find_map(|pair| {
        let (key, value) = pair.split_once('=')?;
        (key == "token").then_some(value)
    }).unwrap_or("")
}

fn parse_status(head: &str) -> Result<u16, ()> {
    let line = head.split("\r\n").next().ok_or(())?;
    let mut parts = line.split(' ');
    let _version = parts.next().ok_or(())?;
    parts.next().ok_or(())?.parse::<u16>().map_err(|_| ())
}

fn parse_length(head: &str) -> Result<usize, ()> {
    for line in head.split("\r\n") {
        let Some((name, value)) = line.split_once(':') else {
            continue;
        };
        if name.eq_ignore_ascii_case("content-length") {
            return value.trim().parse::<usize>().map_err(|_| ());
        }
    }
    Err(())
}

fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            if let Ok(byte) = u8::from_str_radix(&value[index + 1..index + 3], 16) {
                out.push(byte);
                index += 3;
                continue;
            }
        }
        out.push(bytes[index]);
        index += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn read_head(stream: &mut TcpStream) -> std::io::Result<String> {
    let mut buf = Vec::new();
    let mut byte = [0u8; 1];
    while buf.len() < 8192 {
        let read = read_retry(stream, &mut byte)?;
        if read == 0 {
            break;
        }
        buf.push(byte[0]);
        if buf.ends_with(b"\r\n\r\n") {
            return Ok(String::from_utf8_lossy(&buf).into_owned());
        }
    }
    Err(std::io::Error::new(std::io::ErrorKind::InvalidData, "headers"))
}

fn read_exact(stream: &mut TcpStream, len: usize) -> std::io::Result<Vec<u8>> {
    let mut buf = vec![0u8; len];
    let mut filled = 0;
    while filled < len {
        let read = read_retry(stream, &mut buf[filled..])?;
        if read == 0 {
            return Err(std::io::Error::new(std::io::ErrorKind::UnexpectedEof, "body"));
        }
        filled += read;
    }
    Ok(buf)
}

fn read_retry(stream: &mut TcpStream, buf: &mut [u8]) -> std::io::Result<usize> {
    loop {
        match stream.read(buf) {
            Ok(count) => return Ok(count),
            Err(err) if err.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(err) => return Err(err),
        }
    }
}

fn write_response(stream: &mut TcpStream, status: u16, body: &str) -> std::io::Result<()> {
    let bytes = body.as_bytes();
    let head = format!(
        "HTTP/1.1 {status} {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: POST, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type\r\nAccess-Control-Allow-Private-Network: true\r\n\r\n",
        reason_phrase(status),
        bytes.len(),
    );
    stream.write_all(head.as_bytes())?;
    stream.write_all(bytes)?;
    stream.flush()?;
    Ok(())
}

fn reason_phrase(status: u16) -> &'static str {
    match status {
        200 => "OK",
        204 => "No Content",
        400 => "Bad Request",
        401 => "Unauthorized",
        405 => "Method Not Allowed",
        408 => "Request Timeout",
        409 => "Conflict",
        411 => "Length Required",
        413 => "Payload Too Large",
        500 => "Internal Server Error",
        503 => "Service Unavailable",
        _ => "Error",
    }
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|err| err.into_inner())
}

#[cfg(test)]
mod tests {
    use super::{parse_head, post_handoff, private_rank, serve, sort_addresses, tokens_match, Decision};
    use std::net::TcpListener;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{Arc, Mutex};
    use std::thread;

    #[test]
    fn ranks_private_addresses_with_home_wifi_first() {
        let ips = sort_addresses(vec![
            "8.8.8.8".parse().unwrap(),
            "172.16.0.4".parse().unwrap(),
            "10.0.0.8".parse().unwrap(),
            "192.168.1.20".parse().unwrap(),
            "192.168.1.20".parse().unwrap(),
        ]);
        assert_eq!(ips, vec!["192.168.1.20", "10.0.0.8", "172.16.0.4"]);
        assert_eq!(private_rank("169.254.1.1".parse().unwrap()), None);
    }

    #[test]
    fn token_compare_rejects_a_different_code() {
        let token = "0123456789abcdef0123456789abcdef";
        assert!(tokens_match(token, token));
        assert!(!tokens_match(token, "0123456789abcdef0123456789abcdee"));
        assert!(!tokens_match(token, "short"));
    }

    #[test]
    fn parses_the_handoff_request() {
        let head = "POST /v1/handoff?token=abc HTTP/1.1\r\nHost: 192.168.1.20:9\r\nContent-Length: 2\r\n\r\n";
        let incoming = parse_head(head).unwrap();
        assert_eq!(incoming.method, "POST");
        assert_eq!(incoming.path, "/v1/handoff");
        assert_eq!(incoming.token, "abc");
        assert_eq!(incoming.content_length, Some(2));
    }

    #[test]
    fn exchanges_a_post_and_rejects_the_wrong_code() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let token = "0123456789abcdef0123456789abcdef".to_string();
        let wrong = "ffffffffffffffffffffffffffffffff";
        let shutdown = Arc::new(AtomicBool::new(false));
        let pending = Arc::new(Mutex::new(None));
        let pending_body = pending.clone();
        let stop = shutdown.clone();
        let server = thread::spawn(move || {
            serve(
                listener,
                token,
                shutdown,
                pending,
                Arc::new(move |_body| {
                    let sender = pending_body.lock().unwrap().take().unwrap();
                    sender
                        .send(Decision {
                            status: 200,
                            body: "{\"ok\":true,\"accounts\":[],\"categories\":[]}".to_string(),
                        })
                        .unwrap();
                }),
            );
        });

        let rejected = post_handoff("127.0.0.1", port, wrong, "{}").unwrap();
        assert_eq!(rejected.status, 401);

        let accepted = post_handoff("127.0.0.1", port, "0123456789abcdef0123456789abcdef", "{\"accounts\":[]}").unwrap();
        assert_eq!(accepted.status, 200);
        assert!(accepted.body.contains("\"ok\":true"));

        stop.store(true, Ordering::SeqCst);
        let _ = std::net::TcpStream::connect(("127.0.0.1", port));
        server.join().unwrap();
    }
}
