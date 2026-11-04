$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$siteUrl = 'http://localhost:3000'
$healthUrl = "$siteUrl/api/health"

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

if (-not (Test-Sanoj)) {
  $node = Get-Command node -ErrorAction SilentlyContinue
  if (-not $node) {
    Write-Host '  Node.js was not found. Install Node.js 22.5 or newer first.' -ForegroundColor Red
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
Write-Host '  Keep it open while you use the site.'
Write-Host ''

Start-Process $siteUrl
Start-Sleep -Seconds 1
