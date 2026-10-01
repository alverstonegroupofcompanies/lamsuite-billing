#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use rusqlite::{params, Connection};
use serde_json::{json, Value};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::State;

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

fn get_db_path() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".into());
    let app_dir = PathBuf::from(home)
        .join(".gemini")
        .join("antigravity")
        .join("scratch")
        .join("lamsuite-billing");

    let _ = fs::create_dir_all(&app_dir);
    app_dir.join("lamsuite_desktop.sqlite")
}

fn main() {
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

    tauri::Builder::default()
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
            print_thermal,
            print_a4,
            print_export_pdf,
            open_file,
            reveal_file,
            lan_discover_main
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
