fn main() {
    let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    if target_os == "windows" {
        cc::Build::new()
            .file("src/win7_compat_shim.c")
            .compile("win7_compat_shim");
    }
    tauri_build::build();
}
