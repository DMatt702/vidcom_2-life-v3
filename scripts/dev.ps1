$ErrorActionPreference = "Stop"
if (!(Test-Path ".\apps") -and !(Test-Path ".\package.json")) { throw "Run this from repo root." }

Write-Host "Starting dev..."
if (Test-Path ".\scripts\_dev-internal.ps1") {
  .\scripts\_dev-internal.ps1
} else {
  npm install
  npm run dev
}
