# Prepare redistributable inputs only; this does not build/install the desktop app.
[CmdletBinding()]
param(
    [string]$JdkHome = $env:JAVA_HOME,
    [string]$OutputDirectory,
    [switch]$VerifyOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $repoRoot 'target/custom-runtime/windows-x64' }
$outputRoot = [IO.Path]::GetFullPath($OutputDirectory)
$lockPath = Join-Path $PSScriptRoot 'windows-runtime.lock.json'
$runtimeLock = Get-Content -LiteralPath $lockPath -Raw | ConvertFrom-Json

function Write-JsonFile($Value, [string]$Path) {
    [IO.File]::WriteAllText($Path, ($Value | ConvertTo-Json -Depth 15) + "`n", [Text.UTF8Encoding]::new($false))
}

function Get-FileDigest([string]$Path) {
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Assert-Hash([string]$Path, [string]$Expected) {
    if ((Get-FileDigest $Path) -ne $Expected) { throw "SHA-256 mismatch: $Path" }
}

function Invoke-Checked([string]$Executable, [string[]]$Arguments) {
    & $Executable @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Command failed ($LASTEXITCODE): $Executable" }
}

if ($VerifyOnly) {
    $inventory = Get-Content -LiteralPath (Join-Path $outputRoot 'runtime-manifest.json') -Raw | ConvertFrom-Json
    if ($inventory.lockSha256 -ne (Get-FileDigest $lockPath)) { throw 'Runtime lock has changed; prepare a new payload.' }
    $prefix = $outputRoot.TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
    foreach ($file in $inventory.files) {
        $path = [IO.Path]::GetFullPath((Join-Path $outputRoot $file.path))
        if (-not $path.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid inventory path.' }
        Assert-Hash $path $file.sha256
    }
    $actualCount = @(Get-ChildItem -LiteralPath $outputRoot -File -Recurse).Count
    if ($actualCount -ne (@($inventory.files).Count + 1)) { throw 'Unexpected payload files.' }
    foreach ($source in $inventory.jdbcSourceFiles) {
        Assert-Hash (Join-Path $repoRoot $source.path) $source.sha256
    }
    Write-Host "Verified $($inventory.files.Count) files: $outputRoot"
    return
}

if (Test-Path -LiteralPath $outputRoot) {
    throw "Output already exists. Use -VerifyOnly or choose a new -OutputDirectory: $outputRoot"
}
if (-not $JdkHome) { throw 'Specify -JdkHome or set JAVA_HOME to the pinned Temurin JDK.' }
$jdkRoot = (Resolve-Path -LiteralPath $JdkHome).Path
$release = Get-Content -LiteralPath (Join-Path $jdkRoot 'release') -Raw
foreach ($entry in @{
    IMPLEMENTOR = $runtimeLock.java.implementor
    JAVA_RUNTIME_VERSION = $runtimeLock.java.runtimeVersion
    OS_ARCH = $runtimeLock.java.architecture
    OS_NAME = $runtimeLock.java.os
}.GetEnumerator()) {
    $pattern = '(?m)^' + $entry.Key + '="' + [regex]::Escape($entry.Value) + '"\r?$'
    if ($release -notmatch $pattern) { throw "JDK does not match lock: $($entry.Key)=$($entry.Value)" }
}
$pluginRoot = Join-Path $repoRoot 'plugins/jdbc'
$pluginManifest = Get-Content -LiteralPath (Join-Path $pluginRoot 'manifest.json') -Raw | ConvertFrom-Json
if ($pluginManifest.version -ne $runtimeLock.jdbcPluginVersion) { throw 'Update the runtime lock for this JDBC plugin version.' }

# Download to a repository build cache, never a developer-specific runtime path.
$cacheRoot = Join-Path $repoRoot 'target/custom-runtime-cache'
New-Item -ItemType Directory -Path $cacheRoot -Force | Out-Null
foreach ($artifact in $runtimeLock.artifacts) {
    $cached = Join-Path $cacheRoot $artifact.file
    if (-not (Test-Path -LiteralPath $cached)) {
        Invoke-WebRequest -Uri $artifact.url -OutFile $cached
    }
    Assert-Hash $cached $artifact.sha256
    if ($artifact.file -eq 'MicrosoftEdgeWebView2RuntimeInstallerX64.exe') {
        $signature = Get-AuthenticodeSignature -LiteralPath $cached
        if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch '^CN=Microsoft Corporation,') {
            throw 'WebView2 installer must have a valid Microsoft signature.'
        }
    }
}

$previousJavaHome = $env:JAVA_HOME
try {
    $env:JAVA_HOME = $jdkRoot
    Invoke-Checked (Join-Path $pluginRoot 'gradlew.bat') @('-p', $pluginRoot, '--no-daemon', 'shadowJar')
} finally {
    $env:JAVA_HOME = $previousJavaHome
}

New-Item -ItemType Directory -Path $outputRoot | Out-Null
$pluginStage = Join-Path $outputRoot "jdbc/dbx-jdbc-plugin-$($pluginManifest.version)"
New-Item -ItemType Directory -Path (Join-Path $pluginStage 'bin'), (Join-Path $pluginStage 'lib') | Out-Null
Copy-Item -LiteralPath (Join-Path $pluginRoot 'manifest.json') -Destination $pluginStage
foreach ($launcher in @('dbx-jdbc-plugin', 'dbx-jdbc-plugin.bat', 'dbx-maven-resolver', 'dbx-maven-resolver.bat')) {
    Copy-Item -LiteralPath (Join-Path $pluginRoot "bin/$launcher") -Destination (Join-Path $pluginStage 'bin')
}
Copy-Item -LiteralPath (Join-Path $pluginRoot 'build/libs/dbx-jdbc-plugin-all.jar') -Destination (Join-Path $pluginStage 'lib/dbx-jdbc-plugin.jar')
foreach ($artifact in $runtimeLock.artifacts) {
    $destination = Join-Path $outputRoot $artifact.destination
    New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $cacheRoot $artifact.file) -Destination $destination
}

# Keep every module from this JDK, including cp936, TLS, naming and dynamic JDBC
# dependencies. The image includes Java legal notices, but no external JDK path.
Write-Host 'Creating a self-contained Java runtime...'
Invoke-Checked (Join-Path $jdkRoot 'bin/jlink.exe') @(
    '--module-path', (Join-Path $jdkRoot 'jmods'), '--add-modules', 'ALL-MODULE-PATH',
    '--strip-debug', '--no-header-files', '--no-man-pages', '--compress=zip-6',
    '--output', (Join-Path $outputRoot 'jre')
)
Copy-Item -LiteralPath (Join-Path $jdkRoot 'NOTICE') -Destination (Join-Path $outputRoot 'notices/Temurin-NOTICE')

# Run with the generated runtime and explicit classpath; no system Java, user
# plugin installation, database connection or credentials participate.
$probeRoot = Join-Path $cacheRoot ([guid]::NewGuid().ToString())
New-Item -ItemType Directory -Path $probeRoot | Out-Null
$probeSource = @'
import java.nio.charset.Charset;
import java.sql.Driver;
import java.util.Arrays;
public class RuntimeProbe {
    public static void main(String[] args) throws Exception {
        if (!"21.0.13+9-LTS".equals(System.getProperty("java.runtime.version"))) throw new Exception("Wrong Java");
        String chinese = "\u4e2d\u6587";
        Charset cp936 = Charset.forName("cp936");
        if (!chinese.equals(new String(chinese.getBytes(cp936), cp936))) throw new Exception("cp936 failed");
        Driver driver = (Driver) Class.forName("net.sourceforge.jtds.jdbc.Driver").getConstructor().newInstance();
        if (!driver.acceptsURL("jdbc:jtds:sybase://127.0.0.1:5000/;TDS=5.0;charset=cp936")) throw new Exception("jTDS failed");
        Class<?> plugin = Class.forName("app.dbx.jdbc.DbxJdbcPlugin");
        if (Arrays.stream(plugin.getDeclaredMethods()).noneMatch(m -> m.getName().equals("applySybaseRowLimit")))
            throw new Exception("Missing Sybase pagination fix");
        System.out.println("PASS: bundled Java, cp936, jTDS URL and custom JDBC pagination method");
    }
}
'@
$sourcePath = Join-Path $probeRoot 'RuntimeProbe.java'
[IO.File]::WriteAllText($sourcePath, $probeSource)
Invoke-Checked (Join-Path $jdkRoot 'bin/javac.exe') @('-d', $probeRoot, $sourcePath)
$classpath = @($probeRoot, (Join-Path $outputRoot 'drivers/jtds-1.3.1.jar'), (Join-Path $pluginStage 'lib/dbx-jdbc-plugin.jar')) -join ';'
Invoke-Checked (Join-Path $outputRoot 'jre/bin/java.exe') @('-cp', $classpath, 'RuntimeProbe')

Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::CreateFromDirectory((Join-Path $outputRoot 'jdbc'), (Join-Path $outputRoot 'jdbc-plugin.zip'))
# The expanded plugin is also retained for the next integration step.
$sourceFiles = @('plugins/jdbc/build.gradle', 'plugins/jdbc/settings.gradle', 'plugins/jdbc/manifest.json')
$sourceFiles += @('scripts/prepare-windows-runtime.ps1', 'scripts/windows-runtime.lock.json')
$sourceFiles += @(git -C $repoRoot ls-files -- plugins/jdbc/src/main plugins/jdbc/bin plugins/jdbc/gradle plugins/jdbc/gradlew plugins/jdbc/gradlew.bat)
if ($LASTEXITCODE -ne 0) { throw 'Cannot inventory JDBC sources.' }
$sourceInventory = @($sourceFiles | Sort-Object -Unique | ForEach-Object {
    if (Test-Path -LiteralPath (Join-Path $repoRoot $_)) {
        [ordered]@{ path = $_; sha256 = Get-FileDigest (Join-Path $repoRoot $_) }
    }
})
$commit = git -C $repoRoot rev-parse HEAD
if ($LASTEXITCODE -ne 0) { throw 'Cannot identify source commit.' }
Copy-Item -LiteralPath $lockPath -Destination (Join-Path $outputRoot 'runtime-lock.json')
$inventory = @(Get-ChildItem -LiteralPath $outputRoot -File -Recurse | Sort-Object FullName | ForEach-Object {
    [ordered]@{
        path = $_.FullName.Substring($outputRoot.TrimEnd('\', '/').Length + 1).Replace('\', '/')
        size = $_.Length
        sha256 = Get-FileDigest $_.FullName
    }
})
Write-JsonFile ([ordered]@{
    formatVersion = 1
    platform = $runtimeLock.platform
    sourceCommit = "$commit"
    lockSha256 = Get-FileDigest $lockPath
    java = $runtimeLock.java
    jdbcPluginVersion = $pluginManifest.version
    jdbcSourceFiles = $sourceInventory
    smokeCheck = 'passed: Java version, cp936 roundtrip, jTDS URL, Sybase row-limit method'
    files = $inventory
}) (Join-Path $outputRoot 'runtime-manifest.json')
Write-Host "Prepared runtime payload: $outputRoot"
