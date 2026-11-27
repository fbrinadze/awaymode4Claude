# Dot-sourced by install.ps1 for the no-admin route. Returns the workflow settings; the URL is
# read hidden, checked, and never echoed or logged.
function Get-WorkflowSettings([string]$SignInApp) {
  Step "Setting up the workflow route"
  $tenant = (& az account show --query tenantId -o tsv | Out-String).Trim()
  if ($SignInApp -eq "graph-tools") {
    Write-Warning $graphWarning
  } elseif ($SignInApp) {
    Write-Host "Using sign-in app $SignInApp."
  } else {
    try {
      $wf = @(& (Join-Path $PSScriptRoot "create-app.ps1") -Mode workflow -PassThru)[-1]
      $SignInApp = $wf.AppId
      $tenant = $wf.TenantId
    } catch {
      Write-Warning "Couldn't create the sign-in app: $($_.Exception.Message)"
      Write-Host "Your organisation may block app registration. The fallback is Microsoft's Graph tools app:" -ForegroundColor Yellow
      Write-Host "  $graphWarning"
      throw "Stopped. Ask IT for an app registration, or rerun with -SignInApp graph-tools to accept the fallback."
    }
  }
  Write-Host "Paste the Power Automate Workflow URL (it stays hidden, and goes straight into your OS keychain)."
  $workflowUrl = $null
  foreach ($attempt in 1..3) {
    $secureUrl = Read-Host "Workflow URL" -AsSecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureUrl)
    try { $entered = ([Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)).Trim() }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
    if ($entered -match '^https://\S+$') { $workflowUrl = $entered; break }
    Write-Warning "That doesn't look like the workflow's HTTPS URL."
  }
  if (-not $workflowUrl) { throw "No valid workflow URL entered after 3 tries. Stopped." }
  return @{ teams_route = "workflow"; sign_in_app = $SignInApp; tenant_id = $tenant; workflow_url = $workflowUrl }
}
