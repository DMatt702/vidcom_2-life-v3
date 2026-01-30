$ErrorActionPreference = "Stop"
Write-Host "Deploying..."
if (Test-Path ".\scripts\_deploy-internal.ps1") {
  .\scripts\_deploy-internal.ps1
} else {
  npm install
  if (Test-Path ".\package.json") {
    npm run deploy
  } else {
    throw "No package.json yet. Nothing to deploy."
  }
}
Write-Host "Deploy done."
