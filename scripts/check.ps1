$ErrorActionPreference = "Stop"
Write-Host "Running checks..."
if (Test-Path ".\scripts\_check-internal.ps1") {
  .\scripts\_check-internal.ps1
} else {
  npm install
  if (Test-Path ".\package.json") {
    npm run build
  } else {
    Write-Host "No package.json yet. Skipping build."
  }
}
Write-Host "Check done."
