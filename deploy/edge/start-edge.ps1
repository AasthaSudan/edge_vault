<#
.SYNOPSIS
  Start an EdgeVault edge node on a field device (Windows), after pre-flight checks.

.DESCRIPTION
  Reads settings from the repo-root .env (copy .env.example). Checks that Ollama answers on
  loopback with the configured model, that the embedding model is provisioned for offline
  use, and that a fleet key is set when syncing to an HTTPS cloud. Then serves the edge API
  on 127.0.0.1 only: it holds PRIVATE notes and must never listen on the network.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File deploy\edge\start-edge.ps1
#>
param(
    [int]$Port = 0
)
$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Set-Location $Root

function Get-DotEnv([string]$Path) {
    $vals = @{}
    if (Test-Path $Path) {
        foreach ($line in Get-Content $Path) {
            if ($line -match '^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$') { $vals[$Matches[1]] = $Matches[2] }
        }
    }
    return $vals
}

$envFile = Get-DotEnv (Join-Path $Root ".env")
function Setting([string]$Name, [string]$Default) {
    $v = [Environment]::GetEnvironmentVariable($Name)
    if ($v) { return $v }
    if ($envFile.ContainsKey($Name) -and $envFile[$Name]) { return $envFile[$Name] }
    return $Default
}

$python  = Join-Path $Root ".venv\Scripts\python.exe"
$uvicorn = Join-Path $Root ".venv\Scripts\uvicorn.exe"
if (-not (Test-Path $uvicorn)) { throw "Virtualenv missing. Run: python -m venv .venv; .venv\Scripts\pip install -r requirements.txt" }

$model   = Setting "OLLAMA_MODEL" "qwen2.5:1.5b"
$llmHost = Setting "LLM_HOST" "http://127.0.0.1:11434"
$syncUrl = Setting "SYNC_API_URL" "http://127.0.0.1:8080"
$dataRoot = Setting "DATA_ROOT" "./data"
if ($Port -eq 0) { $Port = [int](Setting "PORT" "7001") }

Write-Host "EdgeVault edge node: device=$(Setting 'DEVICE_ID' 'device-a') port=$Port model=$model"

# 1. Local LLM on loopback, model pulled (the gate fails closed without it, but warn loudly)
try {
    $tags = Invoke-RestMethod -Uri "$llmHost/api/tags" -TimeoutSec 5
    if (-not ($tags.models | Where-Object { $_.name -eq $model })) {
        Write-Warning "Ollama is running but '$model' is not pulled. Run: ollama pull $model"
    } else { Write-Host "  [ok] Ollama at $llmHost has $model" }
} catch {
    Write-Warning "Ollama is not reachable at $llmHost. Notes will be kept PRIVATE until it is (fail-closed)."
}

# 2. Embedding model provisioned for offline use
if (-not (Test-Path (Join-Path $dataRoot "models"))) {
    Write-Host "  Provisioning the embedding model (needs internet once)..."
    & $python edge/scripts/provision_models.py
} else { Write-Host "  [ok] Embedding model cache present" }

# 3. Production sync needs a fleet key
if ($syncUrl -like "https://*" -and -not (Setting "FLEET_API_KEY" "")) {
    throw "SYNC_API_URL is HTTPS (production) but FLEET_API_KEY is empty. Set it in .env."
}
if ($syncUrl -like "http://*" -and $syncUrl -notmatch "localhost|127\.0\.0\.1") {
    Write-Warning "SYNC_API_URL uses plain HTTP to a remote host; fleet notes and the key travel unencrypted."
}

# 4. Serve on loopback only, no auto-reload
$env:PORT = "$Port"
& $uvicorn edge.main:app --app-dir edge --host 127.0.0.1 --port $Port
