param(
    [ValidatePattern('^[a-zA-Z0-9_-]+$')][string]$Scene = 'example-geo-wrist',
    [ValidateRange(1024,65535)][int]$Port = 4181,
    [switch]$CheckOnly
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
$workspace = $repo
$index = Join-Path $repo 'browser/index.html'
$runtime = Join-Path $repo 'outputs/browser-preview'
$chrome = @(
    "$env:ProgramFiles/Google/Chrome/Application/chrome.exe",
    "${env:ProgramFiles(x86)}/Microsoft/Edge/Application/msedge.exe"
) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (!$chrome) { throw 'Chrome or Edge is required for this dedicated WebGPU preview.' }
$url = "http://127.0.0.1:$Port/browser/"
function Test-PreviewServer {
    try { $response = Invoke-WebRequest $url -TimeoutSec 2 }
    catch { return $false }
    $expected = [IO.File]::ReadAllText($index).Replace("`r`n", "`n")
    if ($response.Content.Replace("`r`n", "`n") -ne $expected) {
        throw "Port $Port serves different content. Nothing was stopped; choose another -Port."
    }
    $servedApp = Invoke-WebRequest ($url + 'app.js') -TimeoutSec 2
    $expectedApp = [IO.File]::ReadAllText((Join-Path $repo 'browser/app.js')).Replace("`r`n", "`n")
    if ($servedApp.Content.Replace("`r`n", "`n") -ne $expectedApp) {
        throw "Port $Port serves another source version. Nothing was stopped; choose another -Port."
    }
    return $true
}
$running = Test-PreviewServer
if ($CheckOnly) {
    [pscustomobject]@{ Browser = $chrome; ServerHealthy = $running; Port = $Port; Profile = (Join-Path $runtime 'profile') }
    return
}
New-Item -ItemType Directory -Path $runtime -Force | Out-Null
if (!$running) {
    $python = Get-Command python.exe -ErrorAction SilentlyContinue
    if (!$python) { throw 'Python is required to start the local server. Start the existing preview server or install Python.' }
    $server = Start-Process -FilePath $python.Source -ArgumentList @(
        '-m', 'http.server', "$Port", '--bind', '127.0.0.1', '--directory', "`"$workspace`""
    ) -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runtime 'server.log') -RedirectStandardError (Join-Path $runtime 'server-error.log')
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        if (Test-PreviewServer) { $running = $true; break }
        if ($server.HasExited) { throw "Preview server exited ($($server.ExitCode)); see $runtime/server-error.log" }
        Start-Sleep -Milliseconds 250
    }
    if (!$running) { throw "Preview server did not become healthy. See $runtime/server-error.log" }
}
# A separate profile prevents an existing low-power browser process from swallowing
# the GPU launch switch. No user's normal browser profile or global settings change.
$target = $url + "?scene=$Scene&fluidFrame=0&resolution=540&bounces=6&mode=interactive"
Start-Process -FilePath $chrome -ArgumentList @(
    "--user-data-dir=`"$(Join-Path $runtime 'profile')`"",
    '--force-high-performance-gpu', '--no-first-run', '--no-default-browser-check',
    "--app=$target"
) -WindowStyle Normal | Out-Null
Write-Output "Opened $target. Verify the footer reports NVIDIA; launching is not proof of adapter selection."
