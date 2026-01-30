param(
  [string]$App = "admin"
)

$ErrorActionPreference = "Stop"

$valid = @("admin", "api", "mobile", "all")
if (-not ($valid -contains $App)) {
  throw "Unknown app '$App'. Use: admin | api | mobile | all"
}

function Start-App($name) {
  Write-Host "Starting $name..."
  npm --workspace "apps/$name" run dev
}

if ($App -eq "all") {
  Write-Host "Starting api + admin in separate shells..."
  Start-Process -FilePath "pwsh" -ArgumentList "-NoExit", "-Command", "cd apps/api; npm run dev"
  Start-Process -FilePath "pwsh" -ArgumentList "-NoExit", "-Command", "cd apps/admin; npm run dev"
  return
}

Start-App $App