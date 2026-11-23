use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
#[cfg(test)]
use std::sync::Mutex;

/// CNT-006 (decision Q2): a counter's token lives in the OS credential store —
/// Windows Credential Manager, macOS Keychain — and nowhere a till can read as
/// plain text. The JSON file kept below is only for non-secret payloads.
pub const CREDENTIAL_SERVICE: &str = "LamSuite Billing Counter";

/// The field and key names that mark a value as a workstation credential.
const SECRET_NAMES: [&str; 3] = ["device_token", "refresh_token", "access_token"];

fn is_secret_name(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    SECRET_NAMES.iter().any(|field| lower.ends_with(field))
}

pub trait SecretStore {
    fn set(&self, key: &str, value: &str) -> Result<(), String>;
    fn get(&self, key: &str) -> Result<Option<String>, String>;
    fn delete(&self, key: &str) -> Result<(), String>;
}

pub struct OsSecretStore;

/// macOS writes through the system `security` tool: the secret is fed twice on
/// stdin (the tool prompts for it and asks to retype), so it never appears in a
/// process argument list, and the item lands in the same login keychain the
/// signed app reads.
#[cfg(target_os = "macos")]
mod backend {
    use std::io::Write;
    use std::process::{Command, Stdio};

    fn run(args: &[&str], secret: Option<&str>) -> Result<String, String> {
        let mut child = Command::new("/usr/bin/security")
            .args(args)
            .stdin(if secret.is_some() { Stdio::piped() } else { Stdio::null() })
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("security: {e}"))?;

        if let Some(secret) = secret {
            let mut stdin = child.stdin.take().ok_or("security: no stdin")?;
            // Prompt 1: value. Prompt 2: retype.
            stdin
                .write_all(format!("{secret}\n{secret}\n").as_bytes())
                .map_err(|e| format!("security: {e}"))?;
        }

        let out = child.wait_with_output().map_err(|e| format!("security: {e}"))?;
        if out.status.success() {
            return Ok(String::from_utf8_lossy(&out.stdout).trim().to_string());
        }

        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }

    pub fn set(service: &str, account: &str, value: &str) -> Result<(), String> {
        run(
            &["add-generic-password", "-l", service, "-s", service, "-a", account, "-U", "-w"],
            Some(value),
        )
        .map(|_| ())
    }

    pub fn get(service: &str, account: &str) -> Result<Option<String>, String> {
        match run(&["find-generic-password", "-s", service, "-a", account, "-w"], None) {
            Ok(value) => Ok(Some(value)),
            Err(err) if err.contains("could not be found") => Ok(None),
            Err(err) => Err(err),
        }
    }

    pub fn delete(service: &str, account: &str) -> Result<(), String> {
        match run(&["delete-generic-password", "-s", service, "-a", account], None) {
            Ok(_) => Ok(()),
            Err(err) if err.contains("could not be found") => Ok(()),
            Err(err) => Err(err),
        }
    }
}

/// Windows uses Credential Manager (available since XP, so the legacy build is
/// covered) and Linux the Secret Service; both through one audited interface.
#[cfg(not(target_os = "macos"))]
mod backend {
    fn entry(service: &str, account: &str) -> Result<keyring::Entry, String> {
        keyring::Entry::new(service, account).map_err(|e| e.to_string())
    }

    pub fn set(service: &str, account: &str, value: &str) -> Result<(), String> {
        entry(service, account)?.set_password(value).map_err(|e| e.to_string())
    }

    pub fn get(service: &str, account: &str) -> Result<Option<String>, String> {
        match entry(service, account)?.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(err) => Err(err.to_string()),
        }
    }

    pub fn delete(service: &str, account: &str) -> Result<(), String> {
        match entry(service, account)?.delete_credential() {
            Ok(()) => Ok(()),
            Err(keyring::Error::NoEntry) => Ok(()),
            Err(err) => Err(err.to_string()),
        }
    }
}

impl SecretStore for OsSecretStore {
    fn set(&self, key: &str, value: &str) -> Result<(), String> {
        backend::set(CREDENTIAL_SERVICE, key, value)
    }

    fn get(&self, key: &str) -> Result<Option<String>, String> {
        backend::get(CREDENTIAL_SERVICE, key)
    }

    fn delete(&self, key: &str) -> Result<(), String> {
        backend::delete(CREDENTIAL_SERVICE, key)
    }
}

fn vault_path() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".into());
    let app_dir = PathBuf::from(home)
        .join(".gemini")
        .join("antigravity")
        .join("scratch")
        .join("lamsuite-billing");
    let _ = fs::create_dir_all(&app_dir);
    app_dir.join(".lamsuite_secure_vault.dat")
}

fn read_file(path: &Path) -> HashMap<String, String> {
    if !path.exists() {
        return HashMap::new();
    }
    fs::read_to_string(path)
        .ok()
        .and_then(|content| serde_json::from_str::<HashMap<String, String>>(&content).ok())
        .unwrap_or_default()
}

fn write_file(path: &Path, map: &HashMap<String, String>) -> Result<(), String> {
    if map.is_empty() {
        // A vault with nothing left in it should not exist at all.
        if path.exists() {
            let _ = fs::remove_file(path);
        }
        return Ok(());
    }

    let serialized = serde_json::to_string(map).map_err(|e| e.to_string())?;
    fs::write(path, serialized).map_err(|e| e.to_string())
}

/// The credential half of a value, plus what may stay in the file.
fn segregate(key: &str, value: &str) -> (Option<String>, Vec<(String, String)>) {
    if is_secret_name(key) {
        return (None, vec![(key.to_string(), value.to_string())]);
    }

    match serde_json::from_str::<Value>(value) {
        Ok(Value::Object(fields)) => {
            let mut kept = Map::new();
            let mut secrets = Vec::new();

            for (name, field) in fields {
                if is_secret_name(&name) {
                    if let Some(text) = field.as_str() {
                        secrets.push((format!("{key}#{name}"), text.to_string()));
                        continue;
                    }
                }
                kept.insert(name, field);
            }

            if secrets.is_empty() {
                return (Some(value.to_string()), secrets);
            }

            (Some(Value::Object(kept).to_string()), secrets)
        }
        _ => (Some(value.to_string()), vec![]),
    }
}

/// Strips every credential out of the file and into the OS store. Best effort: an
/// entry the store refuses stays put and is tried again on the next touch, so a
/// locked keychain can never brick a workstation that already holds its token.
fn lift(store: &dyn SecretStore, map: &mut HashMap<String, String>) -> bool {
    let mut changed = false;

    for (key, value) in map.clone() {
        let (kept, secrets) = segregate(&key, &value);
        if secrets.is_empty() {
            continue;
        }

        let moved = if is_secret_name(&key) {
            store.set(&key, &value).is_ok()
        } else {
            secrets
                .iter()
                .all(|(name, text)| store.set(name, text).is_ok())
        };

        if !moved {
            continue;
        }

        match kept {
            Some(clean) => {
                if clean != value {
                    map.insert(key, clean);
                    changed = true;
                }
            }
            None => {
                map.remove(&key);
                changed = true;
            }
        }
    }

    changed
}

/// Puts the credential fields back the way the caller left them.
fn assemble(store: &dyn SecretStore, key: &str, file_value: String) -> String {
    let mut parsed = match serde_json::from_str::<Value>(&file_value) {
        Ok(Value::Object(fields)) => Value::Object(fields),
        _ => return file_value,
    };

    let obj = parsed.as_object_mut().expect("object checked above");

    for name in SECRET_NAMES {
        if let Ok(Some(text)) = store.get(&format!("{key}#{name}")) {
            obj.insert(name.to_string(), Value::String(text));
        }
    }

    parsed.to_string()
}

pub struct Vault<'a> {
    path: PathBuf,
    store: &'a dyn SecretStore,
}

impl<'a> Vault<'a> {
    pub fn os() -> Vault<'static> {
        Vault {
            path: vault_path(),
            store: &OsSecretStore,
        }
    }

    #[cfg(test)]
    fn at(path: &Path, store: &'a dyn SecretStore) -> Vault<'a> {
        Vault {
            path: path.to_path_buf(),
            store,
        }
    }

    fn touched(&self) -> HashMap<String, String> {
        let mut map = read_file(&self.path);
        if lift(self.store, &mut map) {
            let _ = write_file(&self.path, &map);
        }
        map
    }

    pub fn set(&self, key: &str, value: &str) -> Result<Value, String> {
        let mut map = self.touched();
        let (kept, secrets) = segregate(key, value);

        for (name, text) in &secrets {
            // Fail closed: a credential we cannot protect is a credential we do not keep.
            self.store.set(name, text)?;
        }

        match kept {
            Some(clean) => {
                map.insert(key.to_string(), clean);
            }
            None => {
                map.remove(key);
            }
        }

        write_file(&self.path, &map)?;

        Ok(json!({
            "success": true,
            "stored_in": if secrets.is_empty() { "vault_file" } else { "os_credential_store" },
        }))
    }

    pub fn get(&self, key: &str) -> Result<Option<String>, String> {
        let map = self.touched();

        if let Some(text) = self.store.get(key)? {
            return Ok(Some(text));
        }

        Ok(map
            .get(key)
            .map(|value| assemble(self.store, key, value.clone())))
    }

    pub fn delete(&self, key: &str) -> Result<Value, String> {
        let mut map = self.touched();

        self.store.delete(key)?;
        for name in SECRET_NAMES {
            self.store.delete(&format!("{key}#{name}"))?;
        }

        map.remove(key);
        write_file(&self.path, &map)?;

        Ok(json!({ "success": true }))
    }
}

#[tauri::command]
pub fn secure_store_set(key: String, value: String) -> Result<Value, String> {
    Vault::os().set(&key, &value)
}

#[tauri::command]
pub fn secure_store_get(key: String) -> Result<Option<String>, String> {
    Vault::os().get(&key)
}

#[tauri::command]
pub fn secure_store_delete(key: String) -> Result<Value, String> {
    Vault::os().delete(&key)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    #[derive(Default)]
    struct MemStore {
        items: Mutex<HashMap<String, String>>,
        fail_writes: AtomicUsize,
    }

    impl MemStore {
        fn deny_first(&self, count: usize) {
            self.fail_writes.store(count, Ordering::SeqCst);
        }
    }

    impl SecretStore for MemStore {
        fn set(&self, key: &str, value: &str) -> Result<(), String> {
            let remaining = self.fail_writes.load(Ordering::SeqCst);
            if remaining > 0 {
                self.fail_writes.store(remaining - 1, Ordering::SeqCst);
                return Err("keychain unavailable".into());
            }
            self.items
                .lock()
                .unwrap()
                .insert(key.to_string(), value.to_string());
            Ok(())
        }

        fn get(&self, key: &str) -> Result<Option<String>, String> {
            Ok(self.items.lock().unwrap().get(key).cloned())
        }

        fn delete(&self, key: &str) -> Result<(), String> {
            self.items.lock().unwrap().remove(key);
            Ok(())
        }
    }

    struct TempVault {
        dir: PathBuf,
        path: PathBuf,
    }

    impl TempVault {
        fn new(name: &str) -> TempVault {
            let dir = std::env::temp_dir().join(format!("lamsuite-vault-{name}"));
            let _ = fs::create_dir_all(&dir);
            TempVault {
                path: dir.join(".lamsuite_secure_vault.dat"),
                dir,
            }
        }

        fn raw(&self) -> String {
            fs::read_to_string(&self.path).unwrap_or_default()
        }
    }

    impl Drop for TempVault {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.dir);
        }
    }

    #[test]
    fn token_keys_are_recognised_by_shape_not_by_size() {
        assert!(is_secret_name("device_token"));
        assert!(is_secret_name("store:7:device_token"));
        assert!(is_secret_name("store:7:refresh_token"));
        assert!(!is_secret_name("store_device_profile"));
        assert!(!is_secret_name("offline_staff_vault_key"));
        assert!(!is_secret_name("store:7:profile"));
    }

    #[test]
    fn a_token_never_reaches_the_file() {
        let dir = TempVault::new("token");
        let store = MemStore::default();
        let vault = Vault::at(&dir.path, &store);

        vault
            .set("store:7:device_token", "lsd_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
            .unwrap();

        assert_eq!(dir.raw(), "", "CNT-006: no plaintext token in the vault file");
        assert_eq!(
            store.get("store:7:device_token").unwrap().as_deref(),
            Some("lsd_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
        );
        assert_eq!(
            vault.get("store:7:device_token").unwrap().as_deref(),
            Some("lsd_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
        );
    }

    #[test]
    fn a_profile_keeps_its_fields_but_loses_its_token() {
        let dir = TempVault::new("profile");
        let store = MemStore::default();
        let vault = Vault::at(&dir.path, &store);

        let profile = json!({
            "store_id": "7",
            "counter_code": "C01",
            "device_token": "lsd_secretvalue",
        })
        .to_string();

        vault.set("store:7:profile", &profile).unwrap();

        let on_disk = dir.raw();
        assert!(!on_disk.contains("lsd_secretvalue"), "IS5: no token on disk");
        assert!(on_disk.contains("C01"), "the non-secret profile stays usable");
        assert_eq!(
            store.get("store:7:profile#device_token").unwrap().as_deref(),
            Some("lsd_secretvalue")
        );

        let restored: Value = serde_json::from_str(&vault.get("store:7:profile").unwrap().unwrap()).unwrap();
        assert_eq!(restored["device_token"].as_str(), Some("lsd_secretvalue"));
        assert_eq!(restored["counter_code"].as_str(), Some("C01"));
    }

    #[test]
    fn an_upgrade_lifts_the_legacy_token_out_of_the_file() {
        let dir = TempVault::new("legacy");
        let legacy = json!({
            "device_token": "lsd_old_token",
            "store_device_profile": "{\"store_id\":\"7\",\"device_token\":\"lsd_old_token\"}",
            "offline_staff_vault_key": "not-a-token",
        })
        .to_string();
        fs::write(&dir.path, legacy).unwrap();

        let store = MemStore::default();
        let vault = Vault::at(&dir.path, &store);

        assert_eq!(
            vault.get("device_token").unwrap().as_deref(),
            Some("lsd_old_token")
        );

        let after = dir.raw();
        assert!(!after.contains("lsd_old_token"), "CNT-006: the file no longer holds it");
        assert!(after.contains("not-a-token"), "non-secret entries survive");
        assert_eq!(store.get("device_token").unwrap().as_deref(), Some("lsd_old_token"));

        let profile: Value =
            serde_json::from_str(&vault.get("store_device_profile").unwrap().unwrap()).unwrap();
        assert_eq!(profile["device_token"].as_str(), Some("lsd_old_token"));
    }

    #[test]
    fn a_new_token_is_refused_when_the_credential_store_is_broken() {
        let dir = TempVault::new("broken");
        let store = MemStore::default();
        store.deny_first(1);
        let vault = Vault::at(&dir.path, &store);

        let err = vault
            .set("device_token", "lsd_should_not_be_written")
            .unwrap_err();
        assert!(err.contains("keychain"));
        assert!(!dir.raw().contains("lsd_should_not_be_written"), "fail closed");
    }

    #[test]
    fn a_legacy_token_survives_a_broken_store_until_it_can_be_lifted() {
        let dir = TempVault::new("patient");
        let legacy = json!({ "device_token": "lsd_keep_me" }).to_string();
        fs::write(&dir.path, &legacy).unwrap();

        let store = MemStore::default();
        store.deny_first(1);
        let vault = Vault::at(&dir.path, &store);

        // Reading must not brick a workstation that is already trading on this token.
        assert_eq!(vault.get("device_token").unwrap().as_deref(), Some("lsd_keep_me"));
        assert!(dir.raw().contains("lsd_keep_me"));

        // And the next touch lifts it for good.
        assert_eq!(vault.get("device_token").unwrap().as_deref(), Some("lsd_keep_me"));
        assert!(!dir.raw().contains("lsd_keep_me"));
    }

    #[test]
    fn deleting_a_counter_identity_clears_both_halves() {
        let dir = TempVault::new("delete");
        let store = MemStore::default();
        let vault = Vault::at(&dir.path, &store);

        vault.set("store:9:device_token", "lsd_gone").unwrap();
        vault
            .set("store:9:profile", &json!({ "device_token": "lsd_gone", "a": 1 }).to_string())
            .unwrap();

        vault.delete("store:9:device_token").unwrap();
        vault.delete("store:9:profile").unwrap();

        assert_eq!(vault.get("store:9:device_token").unwrap(), None);
        assert_eq!(dir.raw(), "");
        assert_eq!(store.get("store:9:profile#device_token").unwrap(), None);
    }

    #[test]
    fn the_real_credential_store_round_trips_when_it_is_reachable() {
        let key = "lamsuite-self-test-token";
        match OsSecretStore.set(key, "lsd_self_test") {
            Ok(()) => {
                assert_eq!(
                    OsSecretStore.get(key).unwrap().as_deref(),
                    Some("lsd_self_test"),
                    "CNT-006: the token comes back from the OS store, not from a file"
                );
                OsSecretStore.delete(key).unwrap();
                assert_eq!(OsSecretStore.get(key).unwrap(), None);
            }
            Err(err) => {
                // A build agent without a keychain must not fail the suite: the
                // routing above is what CNT-006 is actually about.
                eprintln!("skipping OS credential round trip: {err}");
            }
        }
    }
}
