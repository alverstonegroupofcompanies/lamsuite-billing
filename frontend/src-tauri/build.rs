use std::path::{Path, PathBuf};

fn find_obj(dir: &Path) -> Option<PathBuf> {
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                if let Some(found) = find_obj(&path) {
                    return Some(found);
                }
            } else if let Some(ext) = path.extension() {
                if (ext == "obj" || ext == "o")
                    && path
                        .file_name()
                        .map_or(false, |n| n.to_string_lossy().contains("win7_compat_shim"))
                {
                    return Some(path);
                }
            }
        }
    }
    None
}

fn main() {
    let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    let target_env = std::env::var("CARGO_CFG_TARGET_ENV").unwrap_or_default();

    if target_os == "windows" {
        cc::Build::new()
            .file("src/win7_compat_shim.c")
            .compile("win7_compat_shim");

        if target_env == "msvc" {
            let out_dir = std::env::var("OUT_DIR").unwrap();
            let out_path = Path::new(&out_dir);

            if let Some(obj) = find_obj(out_path) {
                println!("cargo:rustc-link-arg={}", obj.display());
            }

            println!("cargo:rustc-link-arg=/FORCE:MULTIPLE");
            println!("cargo:rustc-link-arg=/NODEFAULTLIB:synchronization.lib");
        }
    }

    tauri_build::build();
}
