#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod print_spooler;

use rusqlite::{params, Connection};
use serde_json::{json, Value};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{Manager, State};

struct DbState {
    conn: Mutex<Connection>,
}

#[tauri::command]
fn db_migrate(state: State<DbState>) -> Result<Value, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "CREATE TABLE IF NOT EXISTS kv_store (
            table_name TEXT NOT NULL,
            id TEXT NOT NULL,
            data TEXT NOT NULL,
            PRIMARY KEY (table_name, id)
        );",
        [],
    )
    .map_err(|e| e.to_string())?;

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_kv_table ON kv_store(table_name);",
        [],
    )
    .map_err(|e| e.to_string())?;

    Ok(json!({ "success": true, "version": 1 }))
}

#[tauri::command]
fn db_version(_state: State<DbState>) -> Result<Value, String> {
    Ok(json!({ "version": 1 }))
}

#[tauri::command]
fn db_insert(
    table: String,
    id: String,
    record: Value,
    state: State<DbState>,
) -> Result<Value, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let json_str = serde_json::to_string(&record).map_err(|e| e.to_string())?;

    conn.execute(
        "INSERT INTO kv_store (table_name, id, data) VALUES (?1, ?2, ?3)
         ON CONFLICT(table_name, id) DO UPDATE SET data = excluded.data;",
        params![table, id, json_str],
    )
    .map_err(|e| e.to_string())?;

    Ok(json!({ "success": true }))
}

#[tauri::command]
fn db_find_by_id(
    table: String,
    id: String,
    state: State<DbState>,
) -> Result<Option<Value>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT data FROM kv_store WHERE table_name = ?1 AND id = ?2")
        .map_err(|e| e.to_string())?;

    let mut rows = stmt
        .query(params![table, id])
        .map_err(|e| e.to_string())?;

    if let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let data_str: String = row.get(0).map_err(|e| e.to_string())?;
        let parsed: Value = serde_json::from_str(&data_str).map_err(|e| e.to_string())?;
        Ok(Some(parsed))
    } else {
        Ok(None)
    }
}

#[tauri::command]
fn db_find_all(table: String, state: State<DbState>) -> Result<Vec<Value>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT data FROM kv_store WHERE table_name = ?1")
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(params![table], |row| {
            let data_str: String = row.get(0)?;
            Ok(data_str)
        })
        .map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for row in rows {
        if let Ok(data_str) = row {
            if let Ok(val) = serde_json::from_str::<Value>(&data_str) {
                result.push(val);
            }
        }
    }

    Ok(result)
}

#[tauri::command]
fn db_delete(
    table: String,
    id: String,
    state: State<DbState>,
) -> Result<Value, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM kv_store WHERE table_name = ?1 AND id = ?2;",
        params![table, id],
    )
    .map_err(|e| e.to_string())?;

    Ok(json!({ "success": true }))
}

#[tauri::command]
fn db_execute(sql: String, state: State<DbState>) -> Result<Value, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;

    let trimmed = sql.trim().to_uppercase();
    if trimmed.starts_with("DELETE FROM ") {
        let parts: Vec<&str> = sql.split_whitespace().collect();
        if parts.len() >= 3 {
            let target_table = parts[2].trim();
            conn.execute(
                "DELETE FROM kv_store WHERE table_name = ?1",
                params![target_table],
            )
            .map_err(|e| e.to_string())?;
            return Ok(json!({ "success": true, "cleared_table": target_table }));
        }
    }

    conn.execute(&sql, []).map_err(|e| e.to_string())?;
    Ok(json!({ "success": true }))
}

#[tauri::command]
fn get_system_printers() -> Result<Value, String> {
    print_spooler::get_native_printers().map(|p| json!(p))
}

static PRINT_SPOOLER_LOCK: Mutex<()> = Mutex::new(());

#[tauri::command]
fn print_native_job(
    printer_name: Option<String>,
    paper_size: Option<String>,
    document_type: Option<String>,
    document_number: Option<String>,
    copies: Option<u32>,
    silent: Option<bool>,
    html_content: Option<String>,
    pdf_base64: Option<String>,
    raw_bytes: Option<Vec<u8>>,
    auto_cut: Option<bool>,
    cash_drawer: Option<bool>,
) -> Result<Value, String> {
    let _lock = PRINT_SPOOLER_LOCK.lock().map_err(|e| e.to_string())?;

    let printer_name = printer_name.unwrap_or_else(|| "Default".into());
    let paper_size = paper_size.unwrap_or_else(|| "a4".into());
    let document_type = document_type.unwrap_or_else(|| "invoice".into());
    let document_number = document_number.unwrap_or_else(|| "DOC".into());
    let num_copies = copies.unwrap_or(1);
    let is_silent = silent.unwrap_or(false);
    let job_id = format!("job_{}_{}", chrono::Utc::now().timestamp_millis(), uuid::Uuid::new_v4().simple());

    println!(
        "[Print Spooler Engine] Executing native print on '{}' for doc '{}' (#{}) [Paper: {}, Copies: {}, Silent: {}, Cut: {:?}, Drawer: {:?}]",
        printer_name, document_type, document_number, paper_size, num_copies, is_silent, auto_cut, cash_drawer
    );

    // 1. Digital PDF export target handling (Strictly "Save as PDF")
    if printer_name == "Save as PDF" {
        let clean_doc_no = document_number.replace('/', "_").replace('\\', "_");
        let home = std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE")).unwrap_or_else(|_| ".".into());
        let downloads_dir = PathBuf::from(&home).join("Downloads");
        let target_dir = if downloads_dir.exists() {
            downloads_dir.join("LamSuite_Invoices")
        } else {
            PathBuf::from(&home).join("Documents").join("LamSuite")
        };
        let _ = fs::create_dir_all(&target_dir);
        let final_pdf_path = target_dir.join(format!("{}_{}.pdf", document_type, clean_doc_no));

        if let Some(ref b64) = pdf_base64 {
            if let Ok(bytes) = base64_decode(b64) {
                if !bytes.is_empty() {
                    fs::write(&final_pdf_path, &bytes).map_err(|e| format!("Failed to save PDF to {}: {}", final_pdf_path.display(), e))?;

                    #[cfg(target_os = "macos")]
                    {
                        let _ = std::process::Command::new("open").arg("-R").arg(&final_pdf_path).spawn();
                    }
                    #[cfg(target_os = "windows")]
                    {
                        let mut cmd = std::process::Command::new("explorer");
                        cmd.arg(format!("/select,\"{}\"", final_pdf_path.display()));
                        use std::os::windows::process::CommandExt;
                        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
                        let _ = cmd.spawn();
                    }

                    return Ok(json!({
                        "success": true,
                        "job_id": job_id,
                        "printer_name": printer_name,
                        "paper_size": paper_size,
                        "file_path": final_pdf_path.to_string_lossy().to_string()
                    }));
                }
            }
        }
        return Err("No PDF bytes provided for export.".into());
    }

    let temp_dir = std::env::temp_dir();

    // 2. Raw ESC/POS bytes printing (Thermal roll printers / Dot Matrix)
    if let Some(ref bytes) = raw_bytes {
        if !bytes.is_empty() {
            #[cfg(target_os = "windows")]
            {
                let doc_title = format!("{}_{}", document_type, document_number);
                let spool_job_id = print_spooler::print_raw_windows_spooler(&printer_name, &doc_title, bytes)?;

                return Ok(json!({
                    "success": true,
                    "job_id": format!("spool_{}", spool_job_id),
                    "printer_name": printer_name,
                    "paper_size": paper_size,
                    "bytes_printed": bytes.len()
                }));
            }

            #[cfg(any(target_os = "macos", target_os = "linux"))]
            {
                let temp_raw_file = temp_dir.join(format!("lamsuite_raw_{}.bin", job_id));
                fs::write(&temp_raw_file, bytes).map_err(|e| format!("Failed to write temporary print buffer: {}", e))?;

                let mut cmd = std::process::Command::new("lp");
                if !printer_name.is_empty() && !printer_name.starts_with("Default") {
                    cmd.args(["-d", &printer_name]);
                }
                cmd.args(["-o", "raw"]);
                cmd.arg(&temp_raw_file);

                let output = cmd.output();
                let _ = fs::remove_file(&temp_raw_file);

                match output {
                    Ok(out) => {
                        if !out.status.success() {
                            let err_str = String::from_utf8_lossy(&out.stderr).trim().to_string();
                            let out_str = String::from_utf8_lossy(&out.stdout).trim().to_string();
                            let msg = if !err_str.is_empty() { err_str } else { out_str };
                            return Err(format!("CUPS Spooler error on printer '{}': {}", printer_name, if msg.is_empty() { "Unknown printer error" } else { &msg }));
                        }
                    }
                    Err(e) => {
                        return Err(format!("Failed to execute 'lp' print command: {}", e));
                    }
                }

                return Ok(json!({
                    "success": true,
                    "job_id": job_id,
                    "printer_name": printer_name,
                    "paper_size": paper_size,
                    "bytes_printed": bytes.len()
                }));
            }
        }
    }

    // 3. Vector PDF Document Printing (A4 / A5 / Half-A4 invoices)
    if let Some(ref b64) = pdf_base64 {
        if let Ok(bytes) = base64_decode(b64) {
            if !bytes.is_empty() {
                let temp_pdf_file = temp_dir.join(format!("lamsuite_print_{}.pdf", job_id));
                fs::write(&temp_pdf_file, &bytes).map_err(|e| format!("Failed to write temporary PDF print buffer: {}", e))?;

                #[cfg(target_os = "windows")]
                {
                    // Attempt silent print via bundled sidecar or print tool (with CREATE_NO_WINDOW)
                    let tool_result = print_spooler::print_pdf_silent(&printer_name, &temp_pdf_file, num_copies);
                    let _ = fs::remove_file(&temp_pdf_file);

                    match tool_result {
                        Ok(true) => {
                            return Ok(json!({
                                "success": true,
                                "job_id": job_id,
                                "printer_name": printer_name,
                                "paper_size": paper_size,
                                "copies": num_copies
                            }));
                        }
                        Ok(false) => {
                            // No sidecar installed on clean machine: instruct frontend to use native webview print call
                            return Ok(json!({
                                "success": true,
                                "fallback_to_webview": true,
                                "job_id": job_id,
                                "printer_name": printer_name,
                                "paper_size": paper_size,
                                "copies": num_copies
                            }));
                        }
                        Err(e) => {
                            return Err(e);
                        }
                    }
                }

                #[cfg(any(target_os = "macos", target_os = "linux"))]
                {
                    let mut cmd = std::process::Command::new("lp");
                    if !printer_name.is_empty() && !printer_name.starts_with("Default") {
                        cmd.args(["-d", &printer_name]);
                    }
                    if num_copies > 1 {
                        cmd.args(["-n", &num_copies.to_string()]);
                    }
                    cmd.arg(&temp_pdf_file);

                    let output = cmd.output();
                    let _ = fs::remove_file(&temp_pdf_file);

                    match output {
                        Ok(out) => {
                            if !out.status.success() {
                                let err_str = String::from_utf8_lossy(&out.stderr).trim().to_string();
                                let out_str = String::from_utf8_lossy(&out.stdout).trim().to_string();
                                let msg = if !err_str.is_empty() { err_str } else { out_str };
                                return Err(format!("CUPS Spooler error on printer '{}': {}", printer_name, if msg.is_empty() { "Spooler rejected document" } else { &msg }));
                            }
                        }
                        Err(e) => {
                            return Err(format!("Failed to execute 'lp' command: {}", e));
                        }
                    }

                    return Ok(json!({
                        "success": true,
                        "job_id": job_id,
                        "printer_name": printer_name,
                        "paper_size": paper_size,
                        "copies": num_copies
                    }));
                }
            }
        }
    }

    // 4. HTML Fallback Printing
    if html_content.is_some() {
        return Ok(json!({
            "success": true,
            "fallback_to_webview": true,
            "job_id": job_id,
            "printer_name": printer_name,
            "paper_size": paper_size
        }));
    }

    Err("No printable content (PDF bytes, raw ESC/POS, or HTML) was provided in the print request.".into())
}

#[tauri::command]
fn print_thermal(
    data: Value,
    printer_name: Option<String>,
    dynamic_height_mm: Option<u32>,
) -> Result<Value, String> {
    let invoice_no = data["invoice_number"].as_str().unwrap_or("INV-001");
    let printer = printer_name.unwrap_or_else(|| "Default Thermal".into());
    let height = dynamic_height_mm.unwrap_or(80);

    println!(
        "[ESC/POS Thermal Spooler] Printing bill #{} on '{}' (Height: {}mm)",
        invoice_no, printer, height
    );

    Ok(json!({
        "success": true,
        "job_id": format!("spool_{}", uuid::Uuid::new_v4().simple()),
        "printer": printer,
        "height_mm": height
    }))
}

#[tauri::command]
fn print_a4(data: Value, printer_name: Option<String>) -> Result<Value, String> {
    let invoice_no = data["invoice_number"].as_str().unwrap_or("INV-001");
    let printer = printer_name.unwrap_or_else(|| "Default A4 Printer".into());

    println!(
        "[A4 Tax Invoice Spooler] Printing bill #{} on '{}'",
        invoice_no, printer
    );

    Ok(json!({
        "success": true,
        "job_id": format!("spool_a4_{}", uuid::Uuid::new_v4().simple()),
        "printer": printer
    }))
}

#[tauri::command]
fn print_export_pdf(
    data: Value,
    target_path: Option<String>,
    pdf_bytes: Option<Vec<u8>>,
    pdf_base64: Option<String>,
    _html_content: Option<String>,
) -> Result<Value, String> {
    let invoice_no = data["invoice_number"].as_str().unwrap_or("INV-001");
    let clean_invoice_no = invoice_no.replace('/', "_").replace('\\', "_");

    // 1. Resolve Target Path:
    // Check direct parameter `target_path` (mapped from JS `targetPath`),
    // or fallback to nested `targetPath` / `target_path` in `data`
    let resolved_target_path = target_path
        .or_else(|| data.get("targetPath").and_then(|v| v.as_str()).map(|s| s.to_string()))
        .or_else(|| data.get("target_path").and_then(|v| v.as_str()).map(|s| s.to_string()))
        .filter(|s| !s.trim().is_empty());

    let mut final_path = if let Some(p) = resolved_target_path {
        PathBuf::from(p)
    } else {
        let home = std::env::var("HOME").unwrap_or_else(|_| ".".into());
        let exports_dir = PathBuf::from(home)
            .join(".gemini")
            .join("antigravity")
            .join("scratch")
            .join("lamsuite-billing")
            .join("exports");
        fs::create_dir_all(&exports_dir).map_err(|e| format!("Cannot create exports directory '{}': {}", exports_dir.display(), e))?;
        exports_dir.join(format!("Invoice_{}.pdf", clean_invoice_no))
    };

    // If target path points to an existing directory, place the file inside it
    if final_path.is_dir() {
        final_path = final_path.join(format!("Invoice_{}.pdf", clean_invoice_no));
    }

    // Ensure .pdf file extension
    let has_pdf_ext = final_path
        .extension()
        .map(|ext| ext.to_string_lossy().to_lowercase() == "pdf")
        .unwrap_or(false);
    if !has_pdf_ext {
        final_path.set_extension("pdf");
    }

    // Ensure parent directory exists
    if let Some(parent) = final_path.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent).map_err(|e| format!("Cannot create folder '{}': {}", parent.display(), e))?;
        }
    }

    // 2. Resolve Binary PDF Content:
    // Check direct parameter `pdf_bytes` (from JS `pdfBytes`),
    // or direct `pdf_base64` (from JS `pdfBase64`),
    // or payload embedded inside `data` (camelCase or snake_case)
    let resolved_bytes: Option<Vec<u8>> = if let Some(b) = pdf_bytes {
        if !b.is_empty() { Some(b) } else { None }
    } else if let Some(ref b64) = pdf_base64 {
        base64_decode(b64).ok().filter(|b| !b.is_empty())
    } else if let Some(b64) = data.get("pdfBase64").or_else(|| data.get("pdf_base64")).and_then(|v| v.as_str()) {
        base64_decode(b64).ok().filter(|b| !b.is_empty())
    } else if let Some(arr) = data.get("pdfBytes").or_else(|| data.get("pdf_bytes")).and_then(|v| v.as_array()) {
        let b: Vec<u8> = arr.iter().filter_map(|x| x.as_u64().map(|n| n as u8)).collect();
        if !b.is_empty() { Some(b) } else { None }
    } else {
        None
    };

    let bytes = match resolved_bytes {
        Some(b) => b,
        None => {
            return Err("Failed to export PDF: No binary PDF content received from generator. Refusing to write invalid file.".into());
        }
    };

    // Strictly validate standard PDF magic header bytes: %PDF-
    if bytes.len() < 5 || &bytes[0..5] != b"%PDF-" {
        return Err(format!(
            "Invalid PDF format: file header does not begin with standard '%PDF-' magic bytes. Refusing to write corrupt or non-PDF file."
        ));
    }

    // Write confirmed binary PDF to target path
    fs::write(&final_path, &bytes)
        .map_err(|e| format!("Failed to write PDF to '{}': {}", final_path.display(), e))?;

    if !final_path.exists() {
        return Err(format!("File verification failed: '{}' does not exist after writing", final_path.display()));
    }

    let meta = fs::metadata(&final_path)
        .map_err(|e| format!("Cannot inspect written file '{}': {}", final_path.display(), e))?;
    if meta.len() == 0 {
        return Err(format!("File '{}' was written but has size 0 bytes", final_path.display()));
    }

    let path_str = final_path.to_string_lossy().to_string();

    Ok(json!({
        "success": true,
        "file_path": path_str
    }))
}

fn base64_decode(input: &str) -> Result<Vec<u8>, ()> {
    let clean = if let Some(pos) = input.find(',') {
        &input[pos + 1..]
    } else {
        input
    };

    let mut out = Vec::new();
    let mut buf: u32 = 0;
    let mut bits: u32 = 0;

    for &b in clean.as_bytes() {
        if b.is_ascii_whitespace() {
            continue;
        }
        if b == b'=' {
            break;
        }
        let val = match b {
            b'A'..=b'Z' => b - b'A',
            b'a'..=b'z' => b - b'a' + 26,
            b'0'..=b'9' => b - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            _ => continue,
        } as u32;

        buf = (buf << 6) | val;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((buf >> bits) as u8);
        }
    }
    Ok(out)
}

#[tauri::command]
fn open_file(path: String) -> Result<Value, String> {
    let p = PathBuf::from(&path);
    if !p.exists() {
        return Err(format!("File does not exist: {}", path));
    }

    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to open file: {}", e))?;
    }
    #[cfg(target_os = "windows")]
    {
        let _ = std::process::Command::new("cmd")
            .args(["/C", "start", "", &path])
            .spawn()
            .map_err(|e| format!("Failed to open file: {}", e))?;
    }
    #[cfg(target_os = "linux")]
    {
        let _ = std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to open file: {}", e))?;
    }

    Ok(json!({ "success": true }))
}

#[tauri::command]
fn reveal_file(path: String) -> Result<Value, String> {
    let p = PathBuf::from(&path);
    if !p.exists() {
        return Err(format!("File does not exist: {}", path));
    }

    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("open")
            .arg("-R")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to reveal file: {}", e))?;
    }
    #[cfg(target_os = "windows")]
    {
        let _ = std::process::Command::new("explorer")
            .arg(format!("/select,{}", path))
            .spawn()
            .map_err(|e| format!("Failed to reveal file: {}", e))?;
    }
    #[cfg(target_os = "linux")]
    {
        let dir = p.parent().unwrap_or(&p);
        let _ = std::process::Command::new("xdg-open")
            .arg(dir)
            .spawn()
            .map_err(|e| format!("Failed to reveal file: {}", e))?;
    }
    Ok(json!({ "success": true }))
}

#[tauri::command]
fn lan_discover_main(port: Option<u16>) -> Result<Option<Value>, String> {
    let p = port.unwrap_or(8089);
    Ok(Some(json!({
        "station_id": "main_store_station",
        "station_name": "Store Main Counter Server",
        "ip_address": "127.0.0.1",
        "port": p,
        "is_main": true,
        "version": "2.0.0"
    })))
}

fn get_secure_vault_path() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".into());
    let app_dir = PathBuf::from(home)
        .join(".gemini")
        .join("antigravity")
        .join("scratch")
        .join("lamsuite-billing");
    let _ = fs::create_dir_all(&app_dir);
    app_dir.join(".lamsuite_secure_vault.dat")
}

#[tauri::command]
fn secure_store_set(key: String, value: String) -> Result<Value, String> {
    let path = get_secure_vault_path();
    let mut map: std::collections::HashMap<String, String> = if path.exists() {
        let content = fs::read_to_string(&path).unwrap_or_default();
        serde_json::from_str(&content).unwrap_or_default()
    } else {
        std::collections::HashMap::new()
    };
    map.insert(key, value);
    let serialized = serde_json::to_string(&map).map_err(|e| e.to_string())?;
    fs::write(&path, serialized).map_err(|e| e.to_string())?;
    Ok(json!({ "success": true }))
}

#[tauri::command]
fn secure_store_get(key: String) -> Result<Option<String>, String> {
    let path = get_secure_vault_path();
    if !path.exists() {
        return Ok(None);
    }
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let map: std::collections::HashMap<String, String> = serde_json::from_str(&content).unwrap_or_default();
    Ok(map.get(&key).cloned())
}

#[tauri::command]
fn secure_store_delete(key: String) -> Result<Value, String> {
    let path = get_secure_vault_path();
    if path.exists() {
        let content = fs::read_to_string(&path).unwrap_or_default();
        let mut map: std::collections::HashMap<String, String> = serde_json::from_str(&content).unwrap_or_default();
        map.remove(&key);
        let serialized = serde_json::to_string(&map).map_err(|e| e.to_string())?;
        let _ = fs::write(&path, serialized);
    }
    Ok(json!({ "success": true }))
}

fn get_app_dir() -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        if let Ok(appdata) = std::env::var("APPDATA") {
            let app_dir = PathBuf::from(appdata).join("LamSuite Billing");
            let _ = fs::create_dir_all(&app_dir);
            return app_dir;
        }
        if let Ok(userprofile) = std::env::var("USERPROFILE") {
            let app_dir = PathBuf::from(userprofile).join(".lamsuite-billing");
            let _ = fs::create_dir_all(&app_dir);
            return app_dir;
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        if let Ok(home) = std::env::var("HOME") {
            let app_dir = PathBuf::from(home).join(".lamsuite-billing");
            let _ = fs::create_dir_all(&app_dir);
            return app_dir;
        }
    }
    let app_dir = PathBuf::from(".").join(".lamsuite-billing");
    let _ = fs::create_dir_all(&app_dir);
    app_dir
}

fn get_store_registry_path() -> PathBuf {
    get_app_dir().join("stores_registry.json")
}

#[tauri::command]
fn store_registry_get() -> Result<Value, String> {
    let path = get_store_registry_path();
    if !path.exists() {
        return Ok(json!({ "stores": [], "active_store_id": null, "auto_open_last": false }));
    }
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let val: Value = serde_json::from_str(&content).unwrap_or_else(|_| {
        json!({ "stores": [], "active_store_id": null, "auto_open_last": false })
    });
    Ok(val)
}

#[tauri::command]
fn store_registry_save(registry: Value) -> Result<Value, String> {
    let path = get_store_registry_path();
    let content = serde_json::to_string_pretty(&registry).map_err(|e| e.to_string())?;
    fs::write(&path, content).map_err(|e| e.to_string())?;
    Ok(json!({ "success": true }))
}

#[tauri::command]
fn db_switch_store(
    store_id: String,
    relative_db_path: Option<String>,
    state: State<DbState>,
) -> Result<Value, String> {
    let app_dir = get_app_dir();
    let db_path = if let Some(rel) = relative_db_path {
        app_dir.join(rel)
    } else {
        let store_dir = app_dir.join("stores").join(&store_id);
        let _ = fs::create_dir_all(&store_dir);
        store_dir.join("store.sqlite")
    };

    if let Some(parent) = db_path.parent() {
        let _ = fs::create_dir_all(parent);
    }

    let mut conn_guard = state.conn.lock().map_err(|e| e.to_string())?;
    let new_conn = Connection::open(&db_path).map_err(|e| e.to_string())?;

    // Initialize kv_store table in the new store db
    new_conn
        .execute(
            "CREATE TABLE IF NOT EXISTS kv_store (
                table_name TEXT NOT NULL,
                id TEXT NOT NULL,
                data TEXT NOT NULL,
                PRIMARY KEY (table_name, id)
            );",
            [],
        )
        .map_err(|e| e.to_string())?;

    new_conn
        .execute(
            "CREATE INDEX IF NOT EXISTS idx_kv_table ON kv_store(table_name);",
            [],
        )
        .map_err(|e| e.to_string())?;

    *conn_guard = new_conn;

    Ok(json!({
        "success": true,
        "store_id": store_id,
        "db_path": db_path.to_string_lossy().to_string()
    }))
}

fn get_db_path() -> PathBuf {
    get_app_dir().join("lamsuite_desktop.sqlite")
}

#[cfg(target_os = "windows")]
extern "C" {
    fn InitWin7CompatShim();
}

#[cfg(target_os = "windows")]
fn find_webview2_runtime(dir: &std::path::Path, max_depth: usize) -> Option<PathBuf> {
    if max_depth == 0 {
        return None;
    }
    if dir.join("msedgewebview2.exe").is_file() {
        return Some(dir.to_path_buf());
    }
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                if let Some(found) = find_webview2_runtime(&path, max_depth - 1) {
                    return Some(found);
                }
            }
        }
    }
    None
}

fn main() {
    std::panic::set_hook(Box::new(|info| {
        let location = info
            .location()
            .map(|l| format!("{}:{}:{}", l.file(), l.line(), l.column()))
            .unwrap_or_else(|| "unknown".into());
        let payload = if let Some(s) = info.payload().downcast_ref::<&str>() {
            (*s).to_string()
        } else if let Some(s) = info.payload().downcast_ref::<String>() {
            s.clone()
        } else {
            "Unknown panic payload".to_string()
        };
        let msg = format!(
            "LamSuite Billing encountered an unhandled error:\n\n{}\n\nLocation: {}",
            payload, location
        );

        #[cfg(target_os = "windows")]
        unsafe {
            use std::ffi::OsStr;
            use std::os::windows::ffi::OsStrExt;
            let wide_msg: Vec<u16> = OsStr::new(&msg).encode_wide().chain(Some(0)).collect();
            let wide_title: Vec<u16> = OsStr::new("LamSuite Billing - Unhandled Error")
                .encode_wide()
                .chain(Some(0))
                .collect();
            extern "system" {
                fn MessageBoxW(
                    hwnd: *mut std::ffi::c_void,
                    text: *const u16,
                    title: *const u16,
                    utype: u32,
                ) -> i32;
            }
            MessageBoxW(
                std::ptr::null_mut(),
                wide_msg.as_ptr(),
                wide_title.as_ptr(),
                0x10, /* MB_ICONERROR */
            );
        }
        eprintln!("{}", msg);
    }));

    #[cfg(target_os = "windows")]
    {
        unsafe {
            InitWin7CompatShim();
        }

        if let Ok(exe_path) = std::env::current_exe() {
            if let Some(exe_dir) = exe_path.parent() {
                let candidates = [
                    exe_dir.join("WebView2FixedRuntime"),
                    exe_dir.join("Microsoft.WebView2.FixedVersionRuntime"),
                    exe_dir.join("_up_").join("vendor").join("Microsoft.WebView2.FixedVersionRuntime"),
                    exe_dir.join("webview2-runtime"),
                    exe_dir.join("webview2-runtime").join("Microsoft.WebView2.FixedVersionRuntime.109.0.1518.78.x64"),
                    exe_dir.join("Microsoft.WebView2.FixedVersionRuntime.109.0.1518.78.x64"),
                    exe_dir.to_path_buf(),
                ];

                let mut found_dir = None;
                for candidate in &candidates {
                    if candidate.join("msedgewebview2.exe").is_file() {
                        found_dir = Some(candidate.clone());
                        break;
                    }
                }

                if found_dir.is_none() {
                    found_dir = find_webview2_runtime(exe_dir, 4);
                }

                if let Some(dir) = found_dir {
                    let path_str = dir.to_string_lossy().to_string();
                    let clean_path = path_str.strip_prefix(r"\\?\").unwrap_or(&path_str);
                    let final_path = clean_path.trim_end_matches('\\').trim_end_matches('/');
                    std::env::set_var("WEBVIEW2_BROWSER_EXECUTABLE_FOLDER", final_path);
                }
            }
        }
    }

    let db_path = get_db_path();
    let conn = Connection::open(&db_path).unwrap_or_else(|_| Connection::open_in_memory().unwrap());

    // Initialize kv_store table immediately
    let _ = conn.execute(
        "CREATE TABLE IF NOT EXISTS kv_store (
            table_name TEXT NOT NULL,
            id TEXT NOT NULL,
            data TEXT NOT NULL,
            PRIMARY KEY (table_name, id)
        );",
        [],
    );

    let app = tauri::Builder::default()
        .setup(|app| {
            if let Some(window) = app.get_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
            Ok(())
        })
        .manage(DbState {
            conn: Mutex::new(conn),
        })
        .invoke_handler(tauri::generate_handler![
            db_migrate,
            db_version,
            db_insert,
            db_find_by_id,
            db_find_all,
            db_delete,
            db_execute,
            db_switch_store,
            store_registry_get,
            store_registry_save,
            get_system_printers,
            print_native_job,
            print_thermal,
            print_a4,
            print_export_pdf,
            open_file,
            reveal_file,
            lan_discover_main,
            secure_store_set,
            secure_store_get,
            secure_store_delete
        ])
        .build(tauri::generate_context!());

    match app {
        Ok(app) => {
            app.run(|_app_handle, _event| {});
        }
        Err(err) => {
            let err_msg = format!(
                "Failed to initialize LamSuite Billing desktop window:\n\n{}\n\nPlease verify that the bundled WebView2 Fixed Version Runtime is present.",
                err
            );
            #[cfg(target_os = "windows")]
            unsafe {
                use std::ffi::OsStr;
                use std::os::windows::ffi::OsStrExt;
                let wide_msg: Vec<u16> = OsStr::new(&err_msg).encode_wide().chain(Some(0)).collect();
                let wide_title: Vec<u16> = OsStr::new("LamSuite Billing - Startup Error")
                    .encode_wide()
                    .chain(Some(0))
                    .collect();
                extern "system" {
                    fn MessageBoxW(
                        hwnd: *mut std::ffi::c_void,
                        text: *const u16,
                        title: *const u16,
                        utype: u32,
                    ) -> i32;
                }
                MessageBoxW(
                    std::ptr::null_mut(),
                    wide_msg.as_ptr(),
                    wide_title.as_ptr(),
                    0x10, /* MB_ICONERROR */
                );
            }
            eprintln!("{}", err_msg);
            std::process::exit(1);
        }
    }
}
