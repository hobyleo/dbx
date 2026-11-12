# Extract and exercise the shipped EXE; never run the installer on this account.
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$InstallerPath,
    [string]$SevenZip = (Join-Path $env:ProgramFiles '7-Zip/7z.exe'),
    [string]$OutputDirectory
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$installer = (Resolve-Path -LiteralPath $InstallerPath).Path
if (-not $OutputDirectory) {
    $OutputDirectory = Join-Path $repoRoot ('target/custom-runtime/package-check-' + [guid]::NewGuid().ToString())
}
$outputRoot = [IO.Path]::GetFullPath($OutputDirectory)
if (Test-Path -LiteralPath $outputRoot) { throw 'Choose a new verification directory.' }
New-Item -ItemType Directory -Path $outputRoot | Out-Null
& $SevenZip x $installer "-o$outputRoot/extracted" -y *> (Join-Path $outputRoot 'extract.log')
if ($LASTEXITCODE -ne 0) { throw 'NSIS extraction failed.' }
$files = @(Get-ChildItem -LiteralPath (Join-Path $outputRoot 'extracted') -File -Recurse)
$exe = @($files | Where-Object Name -eq 'dbx.exe')
if ($exe.Count -ne 1) { throw 'Expected exactly one DBX executable.' }
if ($files.Name -contains 'java.exe' -or $files.Name -contains 'MicrosoftEdgeWebView2RuntimeInstallerX64.exe') {
    throw 'The minimal installer contains an offline runtime.'
}
$payload = Join-Path $exe[0].DirectoryName 'custom-jdbc/jdbc-offline.zip'
if (-not (Test-Path -LiteralPath $payload)) { throw 'Bundled JDBC resource missing.' }
function Invoke-PackageCheck([string]$Report) {
    $process = Start-Process -FilePath $exe[0].FullName -ArgumentList '--verify-bundled-jdbc', ('"' + $Report + '"') -WindowStyle Hidden -Wait -PassThru
    return $process.ExitCode
}
$checkPath = Join-Path $outputRoot 'bootstrap-check.json'
if ((Invoke-PackageCheck $checkPath) -ne 0) { throw "Packaged bootstrap failed; see $checkPath" }
$check = Get-Content -LiteralPath $checkPath -Raw | ConvertFrom-Json
if (-not $check.passed) { throw 'Packaged bootstrap report failed.' }

# Corrupt only the extracted test copy; restore it even when a check fails.
$originalBytes = [IO.File]::ReadAllBytes($payload)
try {
    [IO.File]::WriteAllBytes($payload, [byte[]](0, 1, 2, 3))
    $corruptReport = Join-Path $outputRoot 'corrupt-payload-check.json'
    if ((Invoke-PackageCheck $corruptReport) -eq 0) { throw 'A corrupt payload was accepted.' }
    $failure = Get-Content -LiteralPath $corruptReport -Raw | ConvertFrom-Json
    if ($failure.error -ne 'Bundled JDBC payload checksum mismatch') { throw "Unexpected rejection: $($failure.error)" }
} finally {
    [IO.File]::WriteAllBytes($payload, $originalBytes)
}
$verification = [ordered]@{
    passed = $true
    installer = [IO.Path]::GetFileName($installer)
    size = (Get-Item -LiteralPath $installer).Length
    sha256 = (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLowerInvariant()
    checks = @($check.checks) + @('no bundled Java or offline WebView2', 'corrupt payload rejected')
    limitations = @('Does not run NSIS setup or a GUI in a clean Windows VM.', 'No real database or Java download is tested.')
}
[IO.File]::WriteAllText((Join-Path $outputRoot 'verification.json'), ($verification | ConvertTo-Json -Depth 6), [Text.UTF8Encoding]::new($false))
Write-Host "PASS: packaged EXE and minimal JDBC assets. Report: $outputRoot/verification.json"
