use std::path::Path;

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
            let candidate_objs = [
                out_path.join("src").join("win7_compat_shim.obj"),
                out_path.join("win7_compat_shim.obj"),
                out_path.join("src").join("win7_compat_shim.o"),
                out_path.join("win7_compat_shim.o"),
            ];

            for obj in &candidate_objs {
                if obj.exists() {
                    println!("cargo:rustc-link-arg={}", obj.display());
                    break;
                }
            }

            println!("cargo:rustc-link-arg=/FORCE:MULTIPLE");
            println!("cargo:rustc-link-arg=/NODEFAULTLIB:synchronization.lib");
        }
    }

    tauri_build::build();
}
