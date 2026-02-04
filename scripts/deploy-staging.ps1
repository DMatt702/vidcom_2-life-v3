# scripts/deploy-staging.ps1
# Thoughtless Always-On Staging (stderr-proof via cmd.exe)
# - Ensures D1 staging DB
# - Ensures R2 staging bucket
# - Adds [env.staging] to apps/api/wrangler.toml (no manual edits)
# - Deploys API as vidcom-api-staging
# - Builds admin with VITE_API_BASE_URL set to deployed API URL
# - Deploys admin to Pages under branch "staging"

$ErrorActionPreference = "Stop"

function Info($m){ Write-Host "[staging] $m" -ForegroundColor Cyan }
function Warn($m){ Write-Host "[staging] $m" -ForegroundColor Yellow }
function Err($m){ Write-Host "[staging] $m" -ForegroundColor Red }

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $RepoRoot

$ApiDir       = Join-Path $RepoRoot "apps\api"
$AdminDir     = Join-Path $RepoRoot "apps\admin"
$WranglerToml = Join-Path $ApiDir  "wrangler.toml"
$SchemaPath   = Join-Path $RepoRoot "infra\\schema.sql"

if (!(Test-Path $ApiDir))       { Err "Missing $ApiDir"; exit 1 }
if (!(Test-Path $AdminDir))     { Err "Missing $AdminDir"; exit 1 }
if (!(Test-Path $WranglerToml)) { Err "Missing $WranglerToml"; exit 1 }

function Resolve-CmdShim($name) {
  $cmd = Get-Command "$name.cmd" -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $exe = Get-Command $name -ErrorAction SilentlyContinue
  if ($exe) { return $exe.Source }
  return $null
}

$npm = Resolve-CmdShim "npm"
$npx = Resolve-CmdShim "npx"
if (-not $npm) { Err "npm not found on PATH"; exit 1 }
if (-not $npx) { Err "npx not found on PATH"; exit 1 }

# Ensure local wrangler v4 exists (you already did this, but keep it thoughtless)
if (!(Test-Path (Join-Path $RepoRoot "node_modules\wrangler"))) {
  Info "Installing local wrangler@4 (one-time)..."
  & $npm install -D wrangler@4
} else {
  Info "Local wrangler already installed."
}

# ---- STDERR-PROOF Wrangler runner ----
# Runs through cmd.exe so PowerShell never throws on stderr warnings.
function WranglerOut {
  param([Parameter(ValueFromRemainingArguments=$true)][string[]]$Args)

  $argString = ($Args | ForEach-Object {
    if ($_ -match '\s') { '"' + ($_ -replace '"','\"') + '"' } else { $_ }
  }) -join ' '

  $cmdLine = '"' + $npx + '" wrangler ' + $argString + ' 2>&1'
  $out = & cmd.exe /c $cmdLine
  if ($null -eq $out) { return "" }
  return ($out | Out-String)
}

function WranglerJson {
  param([Parameter(ValueFromRemainingArguments=$true)][string[]]$Args)
  $out = WranglerOut @Args
  try { return ($out | ConvertFrom-Json) }
  catch {
    Err "Expected JSON but got:"
    Write-Host $out
    throw
  }
}

# ---- Auth ----
Info "Checking Cloudflare auth..."
$who = WranglerOut "whoami"
if ($who -match "not authenticated|not logged in|Unauthorized") {
  Warn "Wrangler not authenticated. Logging in..."
  WranglerOut "login" | Out-Null
} else {
  Info "Wrangler authenticated."
}

# ---- Names ----
$WorkerBaseName = "vidcom-api"
$StagingEnvName = "staging"
$D1StagingName  = "vidcom_staging"
$R2StagingName  = "vidcom-staging"

# ---- Ensure D1 staging exists ----
Info "Ensuring D1 database exists: $D1StagingName"
$d1List = WranglerJson "d1" "list" "--json"
$d1 = $d1List | Where-Object { $_.name -eq $D1StagingName } | Select-Object -First 1

if (-not $d1) {
  Info "Creating D1 database: $D1StagingName"
  Write-Host (WranglerOut "d1" "create" $D1StagingName)
  $d1List = WranglerJson "d1" "list" "--json"
  $d1 = $d1List | Where-Object { $_.name -eq $D1StagingName } | Select-Object -First 1
}

if (-not $d1 -or -not $d1.uuid) {
  Err "Could not resolve D1 uuid for $D1StagingName"
  Write-Host (WranglerOut "d1" "list" "--json")
  exit 1
}

$d1Id = $d1.uuid
Info "D1 staging database_id: $d1Id"

# ---- Ensure R2 staging exists (create; ignore if exists) ----
Info "Ensuring R2 bucket exists: $R2StagingName"
$r2CreateOut = WranglerOut "r2" "bucket" "create" $R2StagingName

if ($r2CreateOut -match "already exists|BucketAlreadyExists|bucket already exists") {
  Info "R2 bucket already exists."
} elseif ($r2CreateOut -match "\[ERROR\]|Unknown argument|X \[ERROR\]") {
  Err "R2 bucket create failed:"
  Write-Host $r2CreateOut
  exit 1
} else {
  Write-Host $r2CreateOut
  Info "R2 bucket ensured."
}

# ---- Apply D1 schema to staging (idempotent) ----
if (Test-Path $SchemaPath) {
  Info "Applying D1 schema to staging (idempotent)..."
  Push-Location $ApiDir
  $schemaOut = WranglerOut "d1" "execute" "DB" "--env" $StagingEnvName "--file" $SchemaPath "--remote"
  Pop-Location
  Write-Host $schemaOut
} else {
  Warn "Schema file not found at $SchemaPath. Skipping D1 migrate."
}

# ---- Ensure new columns exist ----
function Ensure-Column($col, $type) {
  Info "Ensuring pairs.$col exists..."
  Push-Location $ApiDir
  $alterOut = WranglerOut "d1" "execute" "DB" "--env" $StagingEnvName "--command" "ALTER TABLE pairs ADD COLUMN $col $type;" "--remote"
  Pop-Location
  if ($alterOut -match "duplicate column name") {
    Info "pairs.$col already exists."
  } elseif ($alterOut -match "\[ERROR\]|X \[ERROR\]") {
    Err "Failed to alter pairs table:"
    Write-Host $alterOut
    exit 1
  } else {
    Write-Host $alterOut
  }
}

Ensure-Column "mind_target_asset_id" "TEXT"
Ensure-Column "mind_target_status" "TEXT"
Ensure-Column "mind_target_error" "TEXT"
Ensure-Column "mind_target_requested_at" "TEXT"
Ensure-Column "mind_target_completed_at" "TEXT"

# ---- Patch wrangler.toml to add env.staging ----
Info "Patching apps/api/wrangler.toml to add [env.staging] if missing..."
$toml = Get-Content $WranglerToml -Raw
$hasStaging = [regex]::IsMatch(
  $toml,
  '^\[env\.staging\]',
  [System.Text.RegularExpressions.RegexOptions]::IgnoreCase -bor
  [System.Text.RegularExpressions.RegexOptions]::Multiline
)

if ($hasStaging) {
  Info "[env.staging] already present. Skipping patch."
} else {
  $append = @"

[env.staging]
name = "$WorkerBaseName-$StagingEnvName"

[env.staging.vars]
NODE_ENV = "staging"
SESSION_SECRET = "staging-session-secret"
SIGNING_SECRET = "staging-signing-secret"

[[env.staging.d1_databases]]
binding = "DB"
database_name = "$D1StagingName"
database_id = "$d1Id"

[[env.staging.r2_buckets]]
binding = "BUCKET"
bucket_name = "$R2StagingName"
"@
  $toml = $toml.TrimEnd() + "`r`n" + $append
  Set-Content -Path $WranglerToml -Value $toml -Encoding UTF8
  Info "Added [env.staging] to wrangler.toml"
}

# ---- Deploy API (staging) ----
Info "Deploying API to staging (wrangler deploy --env staging)..."
Push-Location $ApiDir
$apiOut = WranglerOut "deploy" "--env" "staging"
Pop-Location
Write-Host $apiOut

$apiUrl = $null
$u1 = [regex]::Match($apiOut, 'https://[^\s]+\.workers\.dev')
if ($u1.Success) { $apiUrl = $u1.Value }
if (-not $apiUrl) {
  $u2 = [regex]::Match($apiOut, 'https://[^\s]+')
  if ($u2.Success) { $apiUrl = $u2.Value }
}
if (-not $apiUrl) { Err "Could not detect deployed API URL from Wrangler output."; exit 1 }
Info "API staging URL: $apiUrl"

# ---- Build Admin ----
Info "Building Admin with VITE_API_BASE_URL=$apiUrl"
Push-Location $AdminDir
$env:VITE_API_BASE_URL = $apiUrl
$env:VITE_VIEWER_BASE_URL = "https://staging.vidcom-2-life-v3.pages.dev"

if (!(Test-Path (Join-Path $AdminDir "node_modules"))) {
  Info "Admin deps missing: npm install"
  & $npm install
}
& $npm run build

$dist = Join-Path $AdminDir "dist"
if (!(Test-Path $dist)) { Err "Admin build output not found at $dist"; exit 1 }

# ---- Deploy Admin to Pages staging branch ----
$PagesProject = "vidcom-admin"
$PagesBranch  = "staging"
$ProdBranch   = "main"
Info "Ensuring Pages project exists: $PagesProject"
try { WranglerOut "pages" "project" "create" $PagesProject "--production-branch" $ProdBranch | Out-Null } catch {}

Info "Deploying Admin to Pages (branch: $PagesBranch)..."
$pagesOut = WranglerOut "pages" "deploy" $dist "--project-name" $PagesProject "--branch" $PagesBranch
Write-Host $pagesOut

$pagesUrl = $null
$p1 = [regex]::Match($pagesOut, 'https://[^\s]+\.pages\.dev')
if ($p1.Success) { $pagesUrl = $p1.Value }

if ($pagesUrl) { Info "STAGING PREVIEW URL: $pagesUrl" }
else { Info "Deployed. If URL didn't print, check Cloudflare Pages for the staging preview URL." }

$stagingAlias = "https://$PagesBranch.$PagesProject.pages.dev"
$prodUrl = "https://$PagesProject.pages.dev"
Info "STAGING ALIAS URL: $stagingAlias"
Info "PROD URL (after prod deploy): $prodUrl"

Pop-Location
Info "Done."
