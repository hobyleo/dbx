//! Small Windows distributions ship JDBC + jTDS, while Java remains on demand.
use std::path::{Component, Path};
use std::sync::Arc;

use dbx_core::agent_manager::{JavaRuntimeMode, DEFAULT_JRE_KEY};
use dbx_core::agent_service::{reinstall_agent_jre, AgentProgressEvent};
use dbx_core::connection::AppState;
use dbx_core::models::connection::{ConnectionConfig, DatabaseType};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use tauri::{Emitter, State};

const MARKER: &str = ".bundled-sybase.json";
const BUNDLE_DIR: &str = "custom-jdbc";
const PAYLOAD: &str = "jdbc-offline.zip";
static JAVA_INSTALL: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BundleManifest {
    payload_sha256: String,
    installed_files: Vec<BundleFile>,
}

#[derive(Deserialize)]
struct BundleFile {
    path: String,
    sha256: String,
}

fn hash_file(path: &Path) -> Result<String, String> {
    let bytes = std::fs::read(path).map_err(|error| format!("{}: {error}", path.display()))?;
    Ok(format!("{:x}", Sha256::digest(bytes)))
}

fn installation_matches(root: &Path, manifest: &BundleManifest) -> Result<bool, String> {
    if manifest.installed_files.is_empty() {
        return Err("Bundled JDBC inventory is empty".into());
    }
    for file in &manifest.installed_files {
        if !Path::new(&file.path).components().all(|part| matches!(part, Component::Normal(_))) {
            return Err("Invalid bundled JDBC inventory path".into());
        }
        if hash_file(&root.join(&file.path)).ok().as_deref() != Some(file.sha256.as_str()) {
            return Ok(false);
        }
    }
    let bundles = dbx_core::jdbc::list_jdbc_maven_bundles(root)?;
    Ok(bundles.iter().any(|bundle| {
        bundle.coordinate == "net.sourceforge.jtds:jtds:1.3.1"
            && !bundle.artifacts.is_empty()
            && bundle.artifacts.iter().all(|artifact| Path::new(&artifact.path).is_file())
    }))
}

/// Runs before AppState creates plugin sessions. Existing matching files are
/// untouched; a missing/corrupt custom component is restored from local assets.
pub(crate) fn install_if_needed(resources: &Path, plugins: &Path) -> Result<bool, String> {
    let directory = resources.join(BUNDLE_DIR);
    if !directory.is_dir() {
        return Ok(false); // ordinary builds and development have no bundle
    }
    let raw = std::fs::read(directory.join("runtime.json")).map_err(|error| error.to_string())?;
    let manifest: BundleManifest = serde_json::from_slice(&raw).map_err(|error| error.to_string())?;
    let payload = directory.join(PAYLOAD);
    if hash_file(&payload)? != manifest.payload_sha256 {
        return Err("Bundled JDBC payload checksum mismatch".into());
    }
    if !installation_matches(plugins, &manifest)? {
        dbx_core::jdbc::import_offline_jdbc_payload(plugins, &payload)?
            .ok_or_else(|| "Bundled JDBC payload has no offline manifest".to_string())?;
        if !installation_matches(plugins, &manifest)? {
            return Err("Bundled JDBC installation did not pass verification".into());
        }
    }
    std::fs::write(plugins.join(MARKER), raw).map_err(|error| error.to_string())?;
    Ok(true)
}

pub(crate) async fn ensure_java(
    state: &AppState,
    config: &ConnectionConfig,
    progress: impl Fn(AgentProgressEvent),
) -> Result<(), String> {
    if config.db_type != DatabaseType::Jdbc || !state.plugins.root_dir().join(MARKER).is_file() {
        return Ok(());
    }
    let _guard = JAVA_INSTALL.lock().await;
    let am = &state.agent_manager;
    let local = am.load_state();
    if local.java_runtime.mode != JavaRuntimeMode::Managed || am.is_jre_installed(DEFAULT_JRE_KEY) {
        return am.resolve_java_runtime(&local, DEFAULT_JRE_KEY).map(|_| ());
    }
    // The launcher already supports JAVA_HOME/PATH. Reuse a supported system
    // Java without changing the user's managed/custom runtime preference.
    let mut system = local;
    system.java_runtime.mode = JavaRuntimeMode::System;
    if am.resolve_java_runtime(&system, DEFAULT_JRE_KEY).is_ok() {
        return Ok(());
    }
    reinstall_agent_jre(am, DEFAULT_JRE_KEY, progress)
        .await
        .map_err(|error| format!("Java 21 installation failed. Check your network and retry: {error}"))?;
    am.resolve_java_runtime(&am.load_state(), DEFAULT_JRE_KEY).map(|_| ())
}

#[tauri::command]
pub async fn ensure_bundled_jdbc_runtime(
    app: tauri::AppHandle,
    state: State<'_, Arc<AppState>>,
    config: ConnectionConfig,
) -> Result<(), String> {
    ensure_java(state.inner(), &config, |event| {
        let _ = app.emit("agent-install-progress", event);
    })
    .await
}

/// Exercise the exact installer resources without a GUI, network, system Java
/// or user data. A report file is used because Windows GUI binaries have no stdout.
pub fn run_check_if_requested() -> bool {
    let args: Vec<_> = std::env::args_os().collect();
    if args.get(1).and_then(|arg| arg.to_str()) != Some("--verify-bundled-jdbc") {
        return false;
    }
    let result = (|| -> Result<serde_json::Value, String> {
        let resources = std::env::current_exe().map_err(|error| error.to_string())?;
        let resources = resources.parent().ok_or("Missing executable directory")?;
        let temporary = tempfile::tempdir().map_err(|error| error.to_string())?;
        let plugins = temporary.path().join("plugins");
        if !install_if_needed(resources, &plugins)? {
            return Err("No bundled JDBC resources found".into());
        }
        let plugin = plugins.join("jdbc/lib/dbx-jdbc-plugin.jar");
        let modified = std::fs::metadata(&plugin).and_then(|meta| meta.modified()).map_err(|e| e.to_string())?;
        install_if_needed(resources, &plugins)?;
        if std::fs::metadata(&plugin).and_then(|meta| meta.modified()).map_err(|e| e.to_string())? != modified {
            return Err("Repeated initialization replaced a matching plugin".into());
        }
        let driver = dbx_core::jdbc::list_jdbc_maven_bundles(&plugins)?
            .into_iter()
            .find(|bundle| bundle.coordinate == "net.sourceforge.jtds:jtds:1.3.1")
            .ok_or("Missing jTDS bundle")?;
        let jar = Path::new(&driver.artifacts[0].path);
        std::fs::write(jar, b"corrupt").map_err(|e| e.to_string())?;
        install_if_needed(resources, &plugins)?;
        if hash_file(jar)? != driver.artifacts[0].sha256 {
            return Err("Corrupt driver was not restored".into());
        }
        Ok(
            serde_json::json!({"passed": true, "checks": ["clean install", "portable Maven paths", "idempotent restart", "corrupt driver repair"]}),
        )
    })();
    let report = match &result {
        Ok(value) => value.clone(),
        Err(error) => serde_json::json!({"passed": false, "error": error}),
    };
    if let Some(path) = args.get(2) {
        if std::fs::write(path, serde_json::to_vec_pretty(&report).unwrap()).is_err() {
            std::process::exit(2);
        }
    }
    std::process::exit(if result.is_ok() { 0 } else { 1 });
}
