$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$siteUrl = 'http://localhost:3000'
$healthUrl = "$siteUrl/api/health"

function Read-DotEnv {
  $values = @{}
  $envPath = Join-Path $root '.env'
  if (-not (Test-Path $envPath)) {
    return $values
  }

  foreach ($line in Get-Content $envPath) {
    $trimmed = $line.Trim()
    if (-not $trimmed -or $trimmed.StartsWith('#')) { continue }

    $separator = $trimmed.IndexOf('=')
    if ($separator -lt 1) { continue }

    $key = $trimmed.Substring(0, $separator).Trim()
    $value = $trimmed.Substring($separator + 1).Trim()
    if ($value.Length -ge 2) {
      $first = $value.Substring(0, 1)
      $last = $value.Substring($value.Length - 1, 1)
      if (($first -eq '"' -and $last -eq '"') -or ($first -eq "'" -and $last -eq "'")) {
        $value = $value.Substring(1, $value.Length - 2)
      }
    }
    $values[$key] = $value
  }

  return $values
}

$dotenv = Read-DotEnv

function Get-SanojSetting([string]$name) {
  $processValue = [Environment]::GetEnvironmentVariable($name, 'Process')
  if ($processValue) { return $processValue }
  if ($dotenv.ContainsKey($name)) { return $dotenv[$name] }
  return ''
}

function Test-Placeholder([string]$value) {
  return (-not $value) -or $value.Contains('<project-ref>') -or $value.Contains('<password>') -or
    $value.Contains('<service-role-key>') -or $value.Contains('replace-this')
}

$missing = @()
foreach ($name in @('DATABASE_URL', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SESSION_SECRET')) {
  if (Test-Placeholder (Get-SanojSetting $name)) {
    $missing += $name
  }
}

function Test-Sanoj {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $healthUrl -TimeoutSec 2
    return $response.StatusCode -eq 200
  } catch {
    return $false
  }
}

Write-Host ''
Write-Host '  SANOJ TYPE FOUNDRY' -ForegroundColor Yellow
Write-Host ''

if ($missing.Count -gt 0) {
  Write-Host '  Supabase is not configured yet.' -ForegroundColor Red
  Write-Host ''
  Write-Host "  Missing: $($missing -join ', ')"
  Write-Host ''
  Write-Host '  The site now stores data in Supabase PostgreSQL and keeps font'
  Write-Host '  packages in private Supabase Storage. It cannot start without them.'
  Write-Host ''
  Write-Host '  Setup:'
  Write-Host '    1. Create a free project at https://supabase.com/dashboard'
  Write-Host '    2. Copy .env.example to .env and fill in the Supabase values'
  Write-Host '    3. Run:  npm.cmd run setup:supabase'
  Write-Host '    4. Run:  npm.cmd start'
  Write-Host ''
  Write-Host '  See README.md for the full guide, including Vercel deployment.' -ForegroundColor Cyan
  Write-Host ''
  exit 1
}

if (-not (Test-Sanoj)) {
  $node = Get-Command node -ErrorAction SilentlyContinue
  if (-not $node) {
    Write-Host '  Node.js was not found. Install Node.js 22 or newer first.' -ForegroundColor Red
    Write-Host '  https://nodejs.org/'
    Write-Host ''
    exit 1
  }

  Write-Host '  Starting the local server...'
  Start-Process -FilePath $node.Source -ArgumentList 'server.js' -WorkingDirectory $root -WindowStyle Minimized

  $ready = $false
  for ($attempt = 0; $attempt -lt 30; $attempt += 1) {
    Start-Sleep -Milliseconds 500
    if (Test-Sanoj) {
      $ready = $true
      break
    }
  }

  if (-not $ready) {
    Write-Host ''
    Write-Host '  The server did not start.' -ForegroundColor Red
    Write-Host '  Open a terminal in this folder and run: npm.cmd start'
    Write-Host '  The error message will appear there.'
    Write-Host ''
    exit 1
  }
}

Write-Host '  Site open:   ' -NoNewline
Write-Host $siteUrl -ForegroundColor Green
Write-Host '  Admin:       ' -NoNewline
Write-Host "$siteUrl/admin/" -ForegroundColor Green

$addresses = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
  Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
  Select-Object -ExpandProperty IPAddress -Unique

if ($addresses) {
  Write-Host ''
  Write-Host '  On another device connected to the same Wi-Fi:' -ForegroundColor Cyan
  foreach ($address in $addresses) {
    Write-Host "  http://${address}:3000" -ForegroundColor Green
  }
  Write-Host '  If that address does not open, allow Node.js through Windows Firewall.'
}

Write-Host ''
Write-Host '  A minimized server window is keeping the site online.'
Write-Host '  This address only works while this computer and server stay running.'
Write-Host '  For an always-on public link, deploy to Vercel (see README.md).'
Write-Host ''

Start-Process $siteUrl
Start-Sleep -Seconds 1
