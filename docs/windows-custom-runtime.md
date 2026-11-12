# Windows custom runtime inputs

## Minimal installer (recommended for this fork)

The small installer embeds only the custom JDBC plugin, jTDS 1.3.1 and their
notices. It does not embed the Java image or the WebView2 offline installer.
Prepare the verified runtime inputs below once, then build from a Windows x64
Tauri development shell:

```powershell
.\scripts\build-windows-minimal.ps1 -Build
```

The generated configuration under `target/custom-runtime/windows-minimal/`
disables updater signing artifacts and uses WebView2's online bootstrapper.
Only `custom-jdbc/jdbc-offline.zip` and `custom-jdbc/runtime.json` are bundled.
The installer is written to `target/release/bundle/nsis/`.
Use a new `-OutputDirectory` for subsequent preparations, or reuse the generated
configuration directly with `pnpm exec tauri build --bundles nsis --config <path>`.

Before plugin sessions start, DBX imports these local assets into the selected
driver store. Matching files are retained; missing or corrupt files are restored.
The jTDS Maven manifest is rewritten with paths on the destination computer.
No source-machine paths, saved connections or credentials are included.

On first JDBC use, an existing compatible system Java is reused when the managed
runtime is absent. Otherwise DBX downloads its managed Java 21 runtime. Explicit
system/custom Java settings are respected. This needs network access when Java
is missing; WebView2 setup also needs network access if WebView2 is absent.
Sybase Java preparation completes before the frontend connection timeout starts,
and cancelling a connection while it downloads prevents a later connection.

The packaged EXE supports a headless resource check, which uses a temporary
driver store and never touches user data or connects to a database:

```powershell
$check = Start-Process -FilePath .\dbx.exe -ArgumentList '--verify-bundled-jdbc', 'C:\temp\jdbc-check.json' -WindowStyle Hidden -Wait -PassThru
Get-Content C:\temp\jdbc-check.json
```

Run it beside the installed `custom-jdbc/` resources. It checks clean installation,
portable driver paths, idempotent initialization and corrupt-driver recovery.

For a generated installer, use 7-Zip to check the actual packaged EXE without
installing it into your account:

```powershell
.\scripts\verify-windows-minimal.ps1 -InstallerPath .\target\release\bundle\nsis\DBX_0.6.68_x64-setup.exe
```

This also rejects a corrupted payload and confirms Java/offline WebView2 are not
embedded. It does not replace an installation/GUI check on a clean Windows VM.

## Full runtime input preparation

This prepares the redistributable dependencies for the Sybase desktop fork.
It does **not** build an EXE, install components into DBX, or change the running
development environment. Installer resource integration and first-start setup
are separate steps.

## Prepare

From the repository root, provide the location of a **Windows x64 Eclipse
Temurin JDK 21.0.13+9**. `JAVA_HOME` is also accepted; no developer-specific path
is stored in the payload or script.

```powershell
.\scripts\prepare-windows-runtime.ps1 -JdkHome 'C:\tools\temurin-21'
.\scripts\prepare-windows-runtime.ps1 -VerifyOnly
```

The first run requires network access for Gradle dependencies and pinned
redistributable downloads. Downloads are cached in `target/custom-runtime-cache`.
Every download must match `scripts/windows-runtime.lock.json` before use.
The script never installs Java globally or modifies the registry.

## Output

`target/custom-runtime/windows-x64/` contains:

- `jdbc-plugin.zip` and `jdbc/`: the custom JDBC plugin rebuilt from this
  checkout, including the Sybase row-limit fix; upstream plugin version 0.1.52
  is retained, while source hashes identify the custom build.
- `drivers/jtds-1.3.1.jar`: the exact driver version used during development.
- `jre/`: a self-contained Java runtime generated with `jlink`, retaining all
  modules, including cp936, TLS, naming and dynamically loaded JDBC support.
- `webview2/`: Microsoft's x64 Evergreen offline installer, checked against its
  pinned SHA-256 and a valid Microsoft Authenticode signature. It is not executed
  during preparation. Installing it does not pin the browser version of machines
  already using a newer Evergreen runtime.
- `notices/`: jTDS sources/license and Temurin notices. Java module licenses
  are retained under `jre/legal`; shaded plugin metadata remains in its JAR.
- `runtime-lock.json`: the dependency version and download checksum lock.
- `runtime-manifest.json`: SHA-256 and size for every payload file, the source
  commit, JDBC source hashes, and the successful smoke-check result.

Build output is ignored by Git. Keep the complete directory as a release input;
do not copy the application's user-data directory, connections, or credentials.

## Verification and regeneration

Preparation runs a local probe using **the generated Java runtime** to check its
version, Chinese cp936 round-trip encoding, jTDS URL handling, and presence of the
custom pagination method. It does not connect to a database. `-VerifyOnly` checks
all payload hashes, unexpected files, the lock and current JDBC source hashes.

Existing output is never overwritten. After changing JDBC sources or the lock,
choose a new directory:

```powershell
.\scripts\prepare-windows-runtime.ps1 -JdkHome $env:JAVA_HOME -OutputDirectory .\target\custom-runtime\candidate-2
.\scripts\prepare-windows-runtime.ps1 -VerifyOnly -OutputDirectory .\target\custom-runtime\candidate-2
```

A failed preparation has no completed manifest. Use a new output directory when
retrying. Pin deliberate dependency changes in the lock before generating a new
payload. Rebuilt ZIP hashes may change; this guarantees verified release inputs,
not byte-identical rebuilds.

Microsoft's Evergreen download URL changes over time. Keep the verified cached
installer with the release inputs. A later download with different bytes fails
closed; review its signature and checksum before deliberately updating the lock.
