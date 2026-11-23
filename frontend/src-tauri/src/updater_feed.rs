//! UPD-01: the update feed belongs to whichever server this till is configured
//! against. tauri.conf.json carries no endpoints, so the native updater only
//! ever asks the URL the front end passes here. Packages are still verified
//! against the public key baked into the build.

use serde_json::{json, Value};

fn validate_endpoint(endpoint: &str) -> Result<String, String> {
    let trimmed = endpoint.trim();
    if !(trimmed.starts_with("https://") || trimmed.starts_with("http://")) {
        return Err(format!("Invalid update feed URL: {}", trimmed));
    }
    Ok(trimmed.to_string())
}

#[tauri::command]
pub async fn updater_check(app: tauri::AppHandle, endpoint: String) -> Result<Value, String> {
    let endpoint = validate_endpoint(&endpoint)?;
    match tauri::updater::builder(app).endpoints(&[endpoint]).check().await {
        Ok(update) => Ok(json!({
            "shouldUpdate": update.is_update_available(),
            "manifest": {
                "version": update.latest_version(),
                "date": update.date().map(|d| d.to_string()),
                "body": update.body().cloned().unwrap_or_default(),
            }
        })),
        Err(tauri::updater::Error::UpToDate) => Ok(json!({ "shouldUpdate": false })),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub async fn updater_install(app: tauri::AppHandle, endpoint: String) -> Result<(), String> {
    let endpoint = validate_endpoint(&endpoint)?;
    let update = tauri::updater::builder(app)
        .endpoints(&[endpoint])
        .check()
        .await
        .map_err(|e| e.to_string())?;
    if !update.is_update_available() {
        return Err("No update is available from the configured server".to_string());
    }
    update.download_and_install().await.map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::validate_endpoint;

    #[test]
    fn accepts_configured_server_feed() {
        assert_eq!(
            validate_endpoint(" http://127.0.0.1:8000/api/app/update/latest.json ").unwrap(),
            "http://127.0.0.1:8000/api/app/update/latest.json"
        );
    }

    #[test]
    fn rejects_non_http_feed() {
        assert!(validate_endpoint("file:///etc/passwd").is_err());
    }

    #[test]
    fn bundled_config_carries_no_update_endpoints() {
        let conf: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let updater = &conf["tauri"]["updater"];
        let endpoints = updater["endpoints"].as_array().map(|a| a.len()).unwrap_or(0);
        assert_eq!(endpoints, 0, "update feeds must come from the configured server");
        assert!(updater["pubkey"].as_str().map(|k| !k.is_empty()).unwrap_or(false));
    }
}
