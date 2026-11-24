# Framewright Windows runtime diagnostics
# Read-only: does not stop processes, modify projects, or expose secret values.
# Framewright API uses 8788; 8787 is reserved for the local MCP auth proxy.

$ErrorActionPreference = "Continue"

function Write-Section([string]$Title) {
  Write-Host ""
  Write-Host "=== $Title ===" -ForegroundColor Cyan
}

function Test-HttpEndpoint([string]$Name, [string]$Url) {
  try {
    $response = Invoke-WebRequest -Uri $Url -Method Get -UseBasicParsing -TimeoutSec 5
    $status = [int]$response.StatusCode
    $body = $response.Content
    Write-Host "[$status] $Name ($Url)" -ForegroundColor Green

    if ($Name -eq "API health") {
      try {
        $json = $body | ConvertFrom-Json
        if ($json.service -ne "framewright-api" -or $json.status -ne "ok") {
          Write-Host "  WARNING: Port responds, but this is not the expected Framewright API." -ForegroundColor Yellow
        } else {
          Write-Host "  Confirmed Framewright API." -ForegroundColor Green
        }
      } catch {
        Write-Host "  WARNING: Health response was not valid JSON." -ForegroundColor Yellow
      }
    }

    return $status
  } catch {
    $status = $null
    if ($_.Exception.Response) {
      try { $status = [int]$_.Exception.Response.StatusCode } catch {}
    }

    if ($status) {
      Write-Host "[$status] $Name ($Url)" -ForegroundColor Red
      if ($status -eq 401) {
        Write-Host "  Unauthorized: this endpoint is reaching an authentication-protected service." -ForegroundColor Yellow
      }
      if ($status -eq 404) {
        Write-Host "  Route not found: check whether the expected API or Vite proxy is running." -ForegroundColor Yellow
      }
      return $status
    }

    Write-Host "[UNREACHABLE] $Name ($Url): $($_.Exception.Message)" -ForegroundColor Red
    return $null
  }
}

Write-Section "Runtime"
Write-Host "Computer: $env:COMPUTERNAME"
Write-Host "PowerShell: $($PSVersionTable.PSVersion)"
Write-Host "Working directory: $(Get-Location)"

Write-Section "Processes listening on ports 8787, 8788 and 5173"
foreach ($port in @(8787, 8788, 5173)) {
  $listeners = @(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)
  if ($listeners.Count -eq 0) {
    Write-Host "Port $port : no listener" -ForegroundColor Yellow
    continue
  }

  foreach ($listener in $listeners) {
    $processId = $listener.OwningProcess
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $processId" -ErrorAction SilentlyContinue
    Write-Host "Port $port : PID $processId, address $($listener.LocalAddress)"
    if ($process) {
      Write-Host "  Process: $($process.Name)"
      Write-Host "  Executable: $($process.ExecutablePath)"
      Write-Host "  Command: $($process.CommandLine)"
    }
  }
}

Write-Section "Port ownership checks"
$legacyPortStatus = Test-HttpEndpoint "Reserved MCP proxy port 8787 (informational)" "http://127.0.0.1:8787/health"
$healthStatus = Test-HttpEndpoint "API health" "http://127.0.0.1:8788/health"
$projectsStatus = Test-HttpEndpoint "API projects" "http://127.0.0.1:8788/projects"

Write-Section "Studio Vite proxy checks"
$proxyHealthStatus = Test-HttpEndpoint "Studio proxy health" "http://localhost:5173/api/health"
$proxyProjectsStatus = Test-HttpEndpoint "Studio proxy projects" "http://localhost:5173/api/projects"

Write-Section "Summary"
$checks = @(
  @{ Name = "Reserved port 8787 (informational)"; Status = $legacyPortStatus },
  @{ Name = "Direct API health (8788)"; Status = $healthStatus },
  @{ Name = "Direct API projects (8788)"; Status = $projectsStatus },
  @{ Name = "Vite proxy health"; Status = $proxyHealthStatus },
  @{ Name = "Vite proxy projects"; Status = $proxyProjectsStatus }
)

foreach ($check in $checks) {
  $value = if ($null -eq $check.Status) { "UNREACHABLE" } else { [string]$check.Status }
  Write-Host ("{0,-38} {1}" -f $check.Name, $value)
}

if ($healthStatus -eq 200 -and $projectsStatus -eq 200 -and
    $proxyHealthStatus -eq 200 -and $proxyProjectsStatus -eq 200) {
  Write-Host ""
  Write-Host "Runtime checks passed. You can now test project creation in the Studio UI." -ForegroundColor Green
} else {
  Write-Host ""
  Write-Host "One or more Framewright checks failed. Share this output to identify the failing process or proxy hop." -ForegroundColor Yellow
}
