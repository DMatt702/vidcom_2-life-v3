param(
  [switch]$SkipMigrate
)

$ErrorActionPreference = "Stop"

Write-Host "== vidcom v4: api bootstrap =="

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$apiPath = Join-Path $repoRoot "apps/api"
$schemaPath = Join-Path $repoRoot "infra/schema.sql"

# Always install deps once if missing
if (!(Test-Path (Join-Path $repoRoot "node_modules"))) {
  Write-Host "Installing root deps..."
  Push-Location $repoRoot
  npm install --no-fund --no-audit
  Pop-Location
}

# Ensure local D1 schema exists (idempotent)
if (-not $SkipMigrate) {
  if (Test-Path $schemaPath) {
    Write-Host "Applying D1 schema (local, idempotent)..."
    Push-Location $apiPath
    npx wrangler d1 execute DB --local --file=$schemaPath | Out-Host
    Pop-Location
  } else {
    Write-Host "WARNING: infra/schema.sql not found. Skipping migrate."
  }
}

Write-Host "Starting API (wrangler dev)..."
Push-Location $apiPath
npm install --no-fund --no-audit
npm run dev
