# Run from a Windows x64 Tauri build shell. No JRE or offline WebView2 is bundled.
[CmdletBinding()]
param(
    [string]$RuntimeDirectory,
    [string]$OutputDirectory,
    [switch]$Build
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
if (-not $RuntimeDirectory) { $RuntimeDirectory = Join-Path $repoRoot 'target/custom-runtime/windows-x64' }
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $repoRoot 'target/custom-runtime/windows-minimal' }
$runtimeRoot = (Resolve-Path -LiteralPath $RuntimeDirectory).Path
$outputRoot = [IO.Path]::GetFullPath($OutputDirectory)
& (Join-Path $PSScriptRoot 'prepare-windows-runtime.ps1') -VerifyOnly -OutputDirectory $runtimeRoot
if (Test-Path -LiteralPath $outputRoot) { throw 'Output already exists; choose a new -OutputDirectory.' }

function Write-JsonFile($Value, [string]$Path) {
    [IO.File]::WriteAllText($Path, ($Value | ConvertTo-Json -Depth 15) + "`n", [Text.UTF8Encoding]::new($false))
}
function Get-FileDigest([string]$Path) {
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

$bundleId = 'net.sourceforge.jtds_jtds_1.3.1'
$coordinate = 'net.sourceforge.jtds:jtds:1.3.1'
$stage = Join-Path $outputRoot 'staging'
$jdbcDir = Join-Path $stage 'jdbc'
$mavenDir = Join-Path $jdbcDir "maven/$bundleId"
New-Item -ItemType Directory -Path (Join-Path $mavenDir 'jars'), (Join-Path $jdbcDir 'notices') | Out-Null
Copy-Item -LiteralPath (Join-Path $runtimeRoot 'jdbc-plugin.zip') -Destination (Join-Path $jdbcDir 'plugin.zip')
Copy-Item -LiteralPath (Join-Path $runtimeRoot 'drivers/jtds-1.3.1.jar') -Destination (Join-Path $mavenDir 'jars')
foreach ($notice in @('jtds-1.3.1-sources.jar', 'jtds-LGPL-2.1.txt')) {
    Copy-Item -LiteralPath (Join-Path $runtimeRoot "notices/$notice") -Destination (Join-Path $jdbcDir 'notices')
}
$driverJar = Get-Item -LiteralPath (Join-Path $mavenDir 'jars/jtds-1.3.1.jar')
Write-JsonFile ([ordered]@{
    id = $bundleId
    coordinate = $coordinate
    scope = 'runtime'
    repositories = @('https://repo.maven.apache.org/maven2/')
    installed_at = ''
    path = ''
    artifacts = @([ordered]@{
        group_id = 'net.sourceforge.jtds'
        artifact_id = 'jtds'
        version = '1.3.1'
        classifier = ''
        extension = 'jar'
        file_name = $driverJar.Name
        path = ''
        size = $driverJar.Length
        sha256 = Get-FileDigest $driverJar.FullName
    })
}) (Join-Path $mavenDir 'manifest.json')
Write-JsonFile ([ordered]@{
    format_version = 1
    bundles = @(@{
        coordinate = $coordinate
        license = 'LGPL-2.1-or-later'
        sources = 'jdbc/notices/jtds-1.3.1-sources.jar'
        license_file = 'jdbc/notices/jtds-LGPL-2.1.txt'
    })
}) (Join-Path $jdbcDir 'third-party-notices.json')
Write-JsonFile ([ordered]@{
    format_version = 1
    plugin_entry = 'jdbc/plugin.zip'
    third_party_entry = 'jdbc/third-party-notices.json'
    bundles = @(@{ id = $bundleId; coordinate = $coordinate })
}) (Join-Path $jdbcDir 'offline-manifest.json')

$resourceRoot = Join-Path $outputRoot 'custom-jdbc'
New-Item -ItemType Directory -Path $resourceRoot | Out-Null
$payload = Join-Path $resourceRoot 'jdbc-offline.zip'
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::CreateFromDirectory($stage, $payload)
$prepared = Get-Content -LiteralPath (Join-Path $runtimeRoot 'runtime-manifest.json') -Raw | ConvertFrom-Json
$pluginPrefix = "jdbc/dbx-jdbc-plugin-$($prepared.jdbcPluginVersion)/"
$installedFiles = @($prepared.files | Where-Object { $_.path.StartsWith($pluginPrefix) } | ForEach-Object {
    @{ path = 'jdbc/' + $_.path.Substring($pluginPrefix.Length); sha256 = $_.sha256 }
})
$installedFiles += @{
    path = "jdbc/drivers/maven/$bundleId/jars/jtds-1.3.1.jar"
    sha256 = Get-FileDigest $driverJar.FullName
}
Write-JsonFile ([ordered]@{
    formatVersion = 1
    payloadSha256 = Get-FileDigest $payload
    sourceCommit = $prepared.sourceCommit
    installedFiles = $installedFiles
}) (Join-Path $resourceRoot 'runtime.json')
$resources = [ordered]@{}
$resources[$payload.Replace('\', '/')] = 'custom-jdbc/jdbc-offline.zip'
$resources[(Join-Path $resourceRoot 'runtime.json').Replace('\', '/')] = 'custom-jdbc/runtime.json'
$config = Join-Path $outputRoot 'tauri-minimal.conf.json'
Write-JsonFile (@{
    bundle = @{
        createUpdaterArtifacts = $false
        resources = $resources
        windows = @{ webviewInstallMode = @{ type = 'downloadBootstrapper'; silent = $true } }
    }
}) $config
Write-Host "Minimal JDBC payload: $([math]::Round((Get-Item $payload).Length / 1MB, 1)) MiB"
Write-Host "Tauri configuration: $config"

if ($Build) {
    Push-Location $repoRoot
    try {
        & pnpm exec tauri build --bundles nsis --config $config
        if ($LASTEXITCODE -ne 0) { throw "Tauri build failed ($LASTEXITCODE)" }
    } finally { Pop-Location }
}
