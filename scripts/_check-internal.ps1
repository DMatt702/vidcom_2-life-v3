$ErrorActionPreference = "Stop"

$required = @(
  "legacy-v3",
  "apps/api",
  "apps/admin",
  "apps/mobile",
  "packages/shared",
  "packages/matcher",
  "infra/schema.sql",
  "scripts/_dev-internal.ps1",
  "scripts/_deploy-internal.ps1"
)

foreach ($path in $required) {
  if (-not (Test-Path $path)) {
    throw "Missing required path: $path"
  }
}

Write-Host "Structure check passed."
Write-Host "Running builds..."

npm --workspace packages/shared run build
npm --workspace apps/api run build
npm --workspace apps/admin run build

Write-Host "Skipping mobile build until Capacitor config is finalized."
Write-Host "Checks complete."
