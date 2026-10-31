use serde_json::{json, Value};
use std::path::{Path, PathBuf};

#[cfg(target_os = "windows")]
mod win32 {
    pub const PRINTER_ENUM_LOCAL: u32 = 0x00000002;
    pub const PRINTER_ENUM_CONNECTIONS: u32 = 0x00000004;

    pub const PRINTER_ATTRIBUTE_DEFAULT: u32 = 0x00000004;

    pub const PRINTER_STATUS_PAUSED: u32 = 0x00000001;
    pub const PRINTER_STATUS_ERROR: u32 = 0x00000002;
    pub const PRINTER_STATUS_PENDING_DELETION: u32 = 0x00000004;
    pub const PRINTER_STATUS_PAPER_JAM: u32 = 0x00000008;
    pub const PRINTER_STATUS_PAPER_OUT: u32 = 0x00000010;
    pub const PRINTER_STATUS_MANUAL_FEED: u32 = 0x00000020;
    pub const PRINTER_STATUS_PAPER_PROBLEM: u32 = 0x00000040;
    pub const PRINTER_STATUS_OFFLINE: u32 = 0x00000080;
    pub const PRINTER_STATUS_IO_ACTIVE: u32 = 0x00000100;
    pub const PRINTER_STATUS_BUSY: u32 = 0x00000200;
    pub const PRINTER_STATUS_PRINTING: u32 = 0x00000400;
    pub const PRINTER_STATUS_DOOR_OPEN: u32 = 0x00400000;

    #[repr(C)]
    pub struct DOC_INFO_1W {
        pub pDocName: *mut u16,
        pub pOutputFile: *mut u16,
        pub pDatatype: *mut u16,
    }

    #[repr(C)]
    pub struct PRINTER_INFO_2W {
        pub pServerName: *mut u16,
        pub pPrinterName: *mut u16,
        pub pShareName: *mut u16,
        pub pPortName: *mut u16,
        pub pDriverName: *mut u16,
        pub pComment: *mut u16,
        pub pLocation: *mut u16,
        pub pDevMode: *mut std::ffi::c_void,
        pub pSepFile: *mut u16,
        pub pPrintProcessor: *mut u16,
        pub pDatatype: *mut u16,
        pub pParameters: *mut u16,
        pub pSecurityDescriptor: *mut std::ffi::c_void,
        pub Attributes: u32,
        pub Priority: u32,
        pub DefaultPriority: u32,
        pub StartTime: u32,
        pub UntilTime: u32,
        pub Status: u32,
        pub cJobs: u32,
        pub AveragePPM: u32,
    }

    #[link(name = "winspool")]
    extern "system" {
        pub fn OpenPrinterW(
            pPrinterName: *const u16,
            phPrinter: *mut *mut std::ffi::c_void,
            pDefault: *const std::ffi::c_void,
        ) -> i32;

        pub fn StartDocPrinterW(
            hPrinter: *mut std::ffi::c_void,
            Level: u32,
            pDocInfo: *const DOC_INFO_1W,
        ) -> u32;

        pub fn StartPagePrinter(hPrinter: *mut std::ffi::c_void) -> i32;

        pub fn WritePrinter(
            hPrinter: *mut std::ffi::c_void,
            pBuf: *const u8,
            cbBuf: u32,
            pcWritten: *mut u32,
        ) -> i32;

        pub fn EndPagePrinter(hPrinter: *mut std::ffi::c_void) -> i32;

        pub fn EndDocPrinter(hPrinter: *mut std::ffi::c_void) -> i32;

        pub fn ClosePrinter(hPrinter: *mut std::ffi::c_void) -> i32;

        pub fn EnumPrintersW(
            Flags: u32,
            Name: *const u16,
            Level: u32,
            pPrinterEnum: *mut u8,
            cbBuf: u32,
            pcbNeeded: *mut u32,
            pcReturned: *mut u32,
        ) -> i32;

        pub fn GetDefaultPrinterW(
            pszBuffer: *mut u16,
            pcchBuffer: *mut u32,
        ) -> i32;
    }

    #[link(name = "kernel32")]
    extern "system" {
        pub fn GetLastError() -> u32;
    }

    pub fn to_wide(s: &str) -> Vec<u16> {
        use std::ffi::OsStr;
        use std::os::windows::ffi::OsStrExt;
        OsStr::new(s).encode_wide().chain(std::iter::once(0)).collect()
    }

    pub unsafe fn wide_ptr_to_string(ptr: *const u16) -> String {
        if ptr.is_null() {
            return String::new();
        }
        use std::os::windows::ffi::OsStringExt;
        let mut len = 0;
        while *ptr.add(len) != 0 {
            len += 1;
        }
        let slice = std::slice::from_raw_parts(ptr, len);
        std::ffi::OsString::from_wide(slice).to_string_lossy().to_string()
    }
}

/// Enumerates system printers natively using Winspool on Windows or CUPS/lpstat on macOS/Linux.
/// Windows implementation works on Windows 7, 8, 8.1, 10, and 11 without PowerShell.
pub fn get_native_printers() -> Result<Vec<Value>, String> {
    let mut printers = Vec::new();

    #[cfg(target_os = "windows")]
    {
        use std::ptr;

        let flags = win32::PRINTER_ENUM_LOCAL | win32::PRINTER_ENUM_CONNECTIONS;
        let mut needed: u32 = 0;
        let mut returned: u32 = 0;

        unsafe {
            win32::EnumPrintersW(
                flags,
                ptr::null(),
                2,
                ptr::null_mut(),
                0,
                &mut needed,
                &mut returned,
            );
        }

        if needed > 0 {
            let mut buffer: Vec<u8> = vec![0u8; needed as usize];
            let success = unsafe {
                win32::EnumPrintersW(
                    flags,
                    ptr::null(),
                    2,
                    buffer.as_mut_ptr(),
                    needed,
                    &mut needed,
                    &mut returned,
                )
            };

            if success != 0 && returned > 0 {
                let default_printer = get_default_printer().unwrap_or_default();
                let p_info = buffer.as_ptr() as *const win32::PRINTER_INFO_2W;

                for i in 0..returned as usize {
                    let info = unsafe { &*p_info.add(i) };
                    let name = unsafe { win32::wide_ptr_to_string(info.pPrinterName) };
                    let clean_name = name.trim().to_string();
                    if clean_name.is_empty() {
                        continue;
                    }

                    let driver = unsafe { win32::wide_ptr_to_string(info.pDriverName) };
                    let port = unsafe { win32::wide_ptr_to_string(info.pPortName) };
                    let is_def = (info.Attributes & win32::PRINTER_ATTRIBUTE_DEFAULT != 0)
                        || (!default_printer.is_empty() && clean_name.eq_ignore_ascii_case(&default_printer));

                    let status_code = info.Status;
                    let (status_str, status_detail) = if status_code & win32::PRINTER_STATUS_OFFLINE != 0 {
                        ("offline", "Printer is offline or disconnected")
                    } else if status_code & win32::PRINTER_STATUS_PAPER_OUT != 0 {
                        ("paper_out", "Printer is out of paper")
                    } else if status_code & (win32::PRINTER_STATUS_ERROR | win32::PRINTER_STATUS_PAPER_JAM | win32::PRINTER_STATUS_DOOR_OPEN) != 0 {
                        ("error", "Hardware error, door open or paper jam")
                    } else if status_code & (win32::PRINTER_STATUS_BUSY | win32::PRINTER_STATUS_PRINTING) != 0 {
                        ("busy", "Printer is processing another print job")
                    } else {
                        ("ready", "Printer is ready")
                    };

                    let name_lower = clean_name.to_lowercase();
                    let is_thermal = name_lower.contains("pos")
                        || name_lower.contains("thermal")
                        || name_lower.contains("t82")
                        || name_lower.contains("receipt")
                        || name_lower.contains("rp80");
                    let is_dot = name_lower.contains("msp")
                        || name_lower.contains("dot")
                        || name_lower.contains("lx")
                        || name_lower.contains("fx")
                        || name_lower.contains("lq")
                        || name_lower.contains("matrix");
                    let is_virtual = name_lower.contains("pdf")
                        || name_lower.contains("xps")
                        || name_lower.contains("onenote");

                    let carriage_cols = if name_lower.contains("245") || name_lower.contains("120") || name_lower.contains("12\"") || name_lower.contains("12 inch") {
                        120
                    } else if name_lower.contains("2090") || name_lower.contains("136") || name_lower.contains("132") || name_lower.contains("15\"") || name_lower.contains("15 inch") || name_lower.contains("wide") {
                        132
                    } else if name_lower.contains("100") {
                        100
                    } else {
                        80
                    };

                    let dot_papers = if carriage_cols >= 132 {
                        vec!["dot_matrix_6in", "dot_matrix_10in", "dot_matrix_80col", "dot_matrix_12in", "dot_matrix_120col", "dot_matrix_15in", "dot_matrix_132col", "half_a4"]
                    } else if carriage_cols >= 120 {
                        vec!["dot_matrix_6in", "dot_matrix_10in", "dot_matrix_80col", "dot_matrix_12in", "dot_matrix_120col", "half_a4"]
                    } else {
                        vec!["dot_matrix_6in", "dot_matrix_10in", "dot_matrix_80col", "half_a4"]
                    };

                    printers.push(json!({
                        "name": clean_name,
                        "displayName": format!("{} ({})", clean_name, if is_thermal { "Thermal POS" } else if is_dot { "Dot Matrix" } else if is_virtual { "Virtual" } else { "Laser/Inkjet" }),
                        "isDefault": is_def,
                        "status": status_str,
                        "statusDetails": status_detail,
                        "driverName": if driver.is_empty() { "Windows Printer Driver" } else { &driver },
                        "portName": if port.is_empty() { "USB" } else { &port },
                        "printerType": if is_thermal { "thermal_pos" } else if is_dot { "dot_matrix" } else if is_virtual { "virtual_pdf" } else { "laser_inkjet" },
                        "carriageWidthCols": if is_dot { Some(carriage_cols) } else { None },
                        "supportedPaperSizes": if is_thermal { vec!["thermal_80mm", "thermal_58mm"] } else if is_dot { dot_papers } else { vec!["a4", "a5", "half_a4"] },
                        "isVirtual": is_virtual
                    }));
                }
            }
        }
    }

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    {
        let mut default_printer = String::new();
        if let Ok(output) = std::process::Command::new("lpstat").arg("-d").output() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            for line in stdout.lines() {
                if line.starts_with("system default destination: ") {
                    default_printer = line.trim_start_matches("system default destination: ").trim().to_string();
                }
            }
        }

        let mut found_names = Vec::new();
        if let Ok(output) = std::process::Command::new("lpstat").arg("-e").output() {
            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                for line in stdout.lines() {
                    let name = line.trim().to_string();
                    if !name.is_empty() && !found_names.contains(&name) {
                        found_names.push(name);
                    }
                }
            }
        }

        if found_names.is_empty() {
            if let Ok(output) = std::process::Command::new("lpstat").arg("-p").output() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                for line in stdout.lines() {
                    if line.starts_with("printer ") {
                        let parts: Vec<&str> = line.split_whitespace().collect();
                        if parts.len() >= 2 {
                            let name = parts[1].to_string();
                            if !name.is_empty() && !found_names.contains(&name) {
                                found_names.push(name);
                            }
                        }
                    }
                }
            }
        }

        for name in found_names {
            let name_lower = name.to_lowercase();
            let is_def = !default_printer.is_empty() && name == default_printer;
            let is_thermal = name_lower.contains("pos") || name_lower.contains("thermal") || name_lower.contains("t82") || name_lower.contains("receipt");
            let is_dot = name_lower.contains("msp")
                || name_lower.contains("dot")
                || name_lower.contains("lx")
                || name_lower.contains("fx")
                || name_lower.contains("lq")
                || name_lower.contains("matrix");
            let is_virtual = name_lower.contains("pdf");

            let carriage_cols = if name_lower.contains("245") || name_lower.contains("120") || name_lower.contains("12\"") || name_lower.contains("12 inch") {
                120
            } else if name_lower.contains("2090") || name_lower.contains("136") || name_lower.contains("132") || name_lower.contains("15\"") || name_lower.contains("15 inch") || name_lower.contains("wide") {
                132
            } else if name_lower.contains("100") {
                100
            } else {
                80
            };

            let dot_papers = if carriage_cols >= 132 {
                vec!["dot_matrix_6in", "dot_matrix_10in", "dot_matrix_80col", "dot_matrix_12in", "dot_matrix_120col", "dot_matrix_15in", "dot_matrix_132col", "half_a4"]
            } else if carriage_cols >= 120 {
                vec!["dot_matrix_6in", "dot_matrix_10in", "dot_matrix_80col", "dot_matrix_12in", "dot_matrix_120col", "half_a4"]
            } else {
                vec!["dot_matrix_6in", "dot_matrix_10in", "dot_matrix_80col", "half_a4"]
            };

            printers.push(json!({
                "name": name,
                "displayName": format!("{} ({})", name, if is_thermal { "Thermal POS" } else if is_dot { "Dot Matrix" } else if is_virtual { "Virtual" } else { "Laser/Inkjet" }),
                "isDefault": is_def,
                "status": "ready",
                "statusDetails": "Printer is online and ready",
                "driverName": "CUPS Native Driver",
                "portName": "CUPS",
                "printerType": if is_thermal { "thermal_pos" } else if is_dot { "dot_matrix" } else if is_virtual { "virtual_pdf" } else { "laser_inkjet" },
                "carriageWidthCols": if is_dot { Some(carriage_cols) } else { None },
                "supportedPaperSizes": if is_thermal { vec!["thermal_80mm", "thermal_58mm"] } else if is_dot { dot_papers } else { vec!["a4", "a5", "half_a4"] },
                "isVirtual": is_virtual
            }));
        }
    }

    // Always ensure "Save as PDF" digital target is available in printer list
    printers.push(json!({
        "name": "Save as PDF",
        "displayName": "Save as High-Fidelity PDF Document",
        "isDefault": printers.is_empty(),
        "status": "ready",
        "statusDetails": "Digital PDF Export",
        "driverName": "PDF Generator",
        "portName": "FILE:",
        "printerType": "virtual_pdf",
        "supportedPaperSizes": ["a4", "a5", "half_a4", "thermal_80mm", "thermal_58mm", "barcode_label"],
        "isVirtual": true
    }));

    Ok(printers)
}

/// Retrieves the current system default printer name.
#[allow(dead_code)]
pub fn get_default_printer() -> Option<String> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::ffi::OsStringExt;
        let mut size: u32 = 0;
        unsafe {
            win32::GetDefaultPrinterW(std::ptr::null_mut(), &mut size);
        }
        if size == 0 {
            return None;
        }
        let mut buf: Vec<u16> = vec![0u16; size as usize];
        let ok = unsafe { win32::GetDefaultPrinterW(buf.as_mut_ptr(), &mut size) };
        if ok != 0 {
            let os_str = std::ffi::OsString::from_wide(&buf[..size.saturating_sub(1) as usize]);
            return os_str.into_string().ok();
        }
    }
    None
}

/// Sends raw bytes (ESC/POS thermal receipt or ESC/P dot-matrix) directly to the Windows Print Spooler.
/// Returns the Windows spooler Job ID on success, or a human-readable error.
#[cfg(target_os = "windows")]
pub fn print_raw_windows_spooler(
    printer_name: &str,
    doc_title: &str,
    bytes: &[u8],
) -> Result<u32, String> {
    use std::ptr;

    let wide_name = win32::to_wide(printer_name);
    let mut h_printer: *mut std::ffi::c_void = ptr::null_mut();

    let open_res = unsafe {
        win32::OpenPrinterW(wide_name.as_ptr(), &mut h_printer, ptr::null())
    };

    if open_res == 0 || h_printer.is_null() {
        let err = unsafe { win32::GetLastError() };
        let msg = match err {
            5 => format!("Access denied when opening printer '{}'. Please check user permissions.", printer_name),
            1801 => format!("Printer '{}' was not found. Please verify the printer is connected, powered on, and the name matches Windows Settings.", printer_name),
            1722 | 1717 => "The Windows Print Spooler service is stopped or unavailable. Please start the 'Print Spooler' service in services.msc.".into(),
            _ => format!("Failed to connect to printer '{}' (Windows Spooler Error Code: {})", printer_name, err),
        };
        return Err(msg);
    }

    let mut wide_doc = win32::to_wide(doc_title);
    let mut wide_datatype = win32::to_wide("RAW");

    let doc_info = win32::DOC_INFO_1W {
        pDocName: wide_doc.as_mut_ptr(),
        pOutputFile: ptr::null_mut(),
        pDatatype: wide_datatype.as_mut_ptr(),
    };

    let job_id = unsafe { win32::StartDocPrinterW(h_printer, 1, &doc_info) };
    if job_id == 0 {
        let err = unsafe { win32::GetLastError() };
        unsafe { win32::ClosePrinter(h_printer) };
        let msg = match err {
            5 => format!("Access denied to start print job on printer '{}'.", printer_name),
            1722 => "Windows Print Spooler service stopped while starting print job.".into(),
            _ => format!("Print Spooler failed to start document job on '{}' (Error Code: {})", printer_name, err),
        };
        return Err(msg);
    }

    let start_page = unsafe { win32::StartPagePrinter(h_printer) };
    if start_page == 0 {
        let err = unsafe { win32::GetLastError() };
        unsafe {
            win32::EndDocPrinter(h_printer);
            win32::ClosePrinter(h_printer);
        }
        return Err(format!("Print Spooler failed to start page on '{}' (Error Code: {})", printer_name, err));
    }

    let mut written: u32 = 0;
    let write_res = unsafe {
        win32::WritePrinter(
            h_printer,
            bytes.as_ptr(),
            bytes.len() as u32,
            &mut written,
        )
    };

    let write_err = if write_res == 0 || written != bytes.len() as u32 {
        unsafe { win32::GetLastError() }
    } else {
        0
    };

    unsafe {
        win32::EndPagePrinter(h_printer);
        win32::EndDocPrinter(h_printer);
        win32::ClosePrinter(h_printer);
    }

    if write_err != 0 {
        return Err(format!(
            "Failed to complete spooler write for '{}'. Sent {}/{} bytes (Error Code: {})",
            printer_name, written, bytes.len(), write_err
        ));
    }

    Ok(job_id)
}

/// Locates a bundled silent print tool (e.g. SumatraPDF) if shipped as sidecar or present on the system.
#[allow(dead_code)]
pub fn find_silent_pdf_print_tool() -> Option<PathBuf> {
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            let candidates = [
                exe_dir.join("SumatraPDF.exe"),
                exe_dir.join("bin").join("SumatraPDF.exe"),
                exe_dir.join("sidecars").join("SumatraPDF.exe"),
                exe_dir.join("tools").join("SumatraPDF.exe"),
            ];
            for c in &candidates {
                if c.exists() {
                    return Some(c.clone());
                }
            }
        }
    }

    // Check system program files locations
    let system_candidates = [
        r"C:\Program Files\SumatraPDF\SumatraPDF.exe",
        r"C:\Program Files (x86)\SumatraPDF\SumatraPDF.exe",
    ];
    for p in &system_candidates {
        let path = PathBuf::from(p);
        if path.exists() {
            return Some(path);
        }
    }

    None
}

/// Prints a PDF document silently using a bundled tool with CREATE_NO_WINDOW.
/// If no tool is installed, returns Ok(false) to trigger webview native printing fallback.
#[allow(dead_code)]
pub fn print_pdf_silent(
    printer_name: &str,
    pdf_path: &Path,
    copies: u32,
) -> Result<bool, String> {
    if let Some(tool_path) = find_silent_pdf_print_tool() {
        let mut cmd = std::process::Command::new(&tool_path);
        
        let mut args: Vec<String> = Vec::new();
        if !printer_name.is_empty() && !printer_name.starts_with("Default") {
            args.push("-print-to".into());
            args.push(printer_name.to_string());
        } else {
            args.push("-print-to-default".into());
        }
        args.push("-silent".into());
        if copies > 1 {
            args.push("-print-settings".into());
            args.push(format!("{}x", copies));
        }
        args.push(pdf_path.to_string_lossy().to_string());

        cmd.args(&args);

        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
        }

        match cmd.status() {
            Ok(status) => {
                if status.success() {
                    return Ok(true);
                } else {
                    return Err(format!(
                        "Silent print tool exited with code {:?}",
                        status.code()
                    ));
                }
            }
            Err(e) => {
                return Err(format!("Failed to execute silent print tool: {}", e));
            }
        }
    }

    // Tool not found; signal caller to use native webview print call
    Ok(false)
}
