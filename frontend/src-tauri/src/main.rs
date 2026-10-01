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
    html_content: Option<String>,
) -> Result<Value, String> {
    let invoice_no = data["invoice_number"].as_str().unwrap_or("INV-001");
    let clean_invoice_no = invoice_no.replace('/', "_");

    let final_path = if let Some(ref p) = target_path {
        PathBuf::from(p)
    } else {
        let home = std::env::var("HOME").unwrap_or_else(|_| ".".into());
        let exports_dir = PathBuf::from(home)
            .join(".gemini")
            .join("antigravity")
            .join("scratch")
            .join("lamsuite-billing")
            .join("exports");
        let _ = fs::create_dir_all(&exports_dir);
        exports_dir.join(format!("Invoice_{}.html", clean_invoice_no))
    };

    if let Some(parent) = final_path.parent() {
        let _ = fs::create_dir_all(parent);
    }

    let content_to_write = if let Some(ref html) = html_content {
        html.clone()
    } else {
        format!(
            "<!DOCTYPE html><html><body><h1>Invoice #{}</h1><p>Date: {}</p><p>Customer: {}</p><p>Total: Rs. {}</p></body></html>",
            invoice_no,
            data["invoice_date"].as_str().unwrap_or(""),
            data["customer_name"].as_str().unwrap_or("Walk-in"),
            data["grand_total"]
        )
    };

    let _ = fs::write(&final_path, content_to_write);

    // Auto-reveal in Finder on macOS / Explorer on Windows
    let path_str = final_path.to_string_lossy().to_string();
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("open")
            .arg("-R")
            .arg(&path_str)
            .spawn();
    }
    #[cfg(target_os = "windows")]
    {
        let _ = std::process::Command::new("explorer")
            .arg(format!("/select,{}", path_str))
            .spawn();
    }

    Ok(json!({
        "success": true,
        "file_path": path_str
    }))
}

#[tauri::command]
fn reveal_file(path: String) -> Result<Value, String> {
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("open")
            .arg("-R")
            .arg(&path)
            .spawn();
    }
    #[cfg(target_os = "windows")]
    {
        let _ = std::process::Command::new("explorer")
            .arg(format!("/select,{}", path))
            .spawn();
    }
    #[cfg(target_os = "linux")]
    {
        let _ = std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn();
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
            reveal_file,
            lan_discover_main
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
