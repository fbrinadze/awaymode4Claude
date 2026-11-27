<#
.SYNOPSIS
  Sets up Away Mode in one go: Azure app and bot, the Teams app, and the Claude Code plugin.

.DESCRIPTION
  Run once from the repo folder:
    powershell -ExecutionPolicy Bypass -File setup\install.ps1
  For a team (as a Teams admin), add the people who should get it:
    powershell -ExecutionPolicy Bypass -File setup\install.ps1 -ForUsers alice@contoso.com,bob@contoso.com

  Safe to re-run. Needs the Azure CLI and Claude Code; installs Bun and the MicrosoftTeams
  PowerShell module if missing. The bot secret is never shown: it goes straight into Claude
  Code's settings (your OS keychain). Works in Windows PowerShell 5.1 and PowerShell 7.
#>
param(
  [string[]]$ForUsers = @(),
  [string]$Name = "away-mode",
  [string]$ResourceGroup = "away-mode-rg",
  [string]$Location = "eastus"
)
$ErrorActionPreference = "Stop"
$plugin = "away-mode@awaymode"
$launch = "claude --dangerously-load-development-channels plugin:$plugin"

function Step($text) { Write-Host ""; Write-Host "== $text" -ForegroundColor Cyan }
function Have($cmd) { [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }
# True/false for a native command. Windows PowerShell 5.1 turns redirected native stderr into a
# terminating error under "Stop", so relax it for the check.
function Test-Native([scriptblock]$Run) {
  $old = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try { & $Run 2>&1 | Out-Null; return ($LASTEXITCODE -eq 0) } finally { $ErrorActionPreference = $old }
}

# 1. Prerequisites
Step "Checking prerequisites"
if (-not (Have az)) { throw "Azure CLI not found. Install it (winget install Microsoft.AzureCLI), open a new PowerShell window, and run this again." }
if (-not (Have claude)) { throw "Claude Code not found. Install Claude Code first, then run this again." }
if (-not (Have bun)) {
  if (-not (Have winget)) { throw "Bun not found. Install it from https://bun.sh, open a new PowerShell window, and run this again." }
  Write-Host "Installing Bun (the runtime Away Mode uses)..."
  & winget install --id Oven-sh.Bun -e --accept-source-agreements --accept-package-agreements
  # winget's PATH change only reaches new windows; add Bun's folder for this one.
  $bunExe = Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages" -Recurse -Filter bun.exe -ErrorAction SilentlyContinue |
    Select-Object -First 1
  if ($bunExe) { $env:Path = "$($bunExe.DirectoryName);$env:Path" }
  if (-not (Have bun)) { throw "Bun didn't install. Install it from https://bun.sh, open a new window, and run this again." }
}
if (-not (Test-Native { az account show })) {
  & az login | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "az login failed." }
}
Write-Host "Azure CLI, Bun and Claude Code are ready."

# 2. Azure app registration, bot and Teams package (reused if they exist). The secret stays in $app.
Step "Creating (or reusing) the Azure app and bot"
$app = @(& (Join-Path $PSScriptRoot "create-app.ps1") -Name $Name -ResourceGroup $ResourceGroup -Location $Location -PassThru)[-1]

# 3. Who gets the Teams app: you, plus anyone in -ForUsers.
$userIds = @(az ad signed-in-user show --query id -o tsv)
foreach ($u in $ForUsers) {
  $id = az ad user show --id $u --query id -o tsv
  if ($LASTEXITCODE -eq 0 -and $id) { $userIds += $id } else { Write-Warning "Couldn't find $u in your directory; skipping." }
}
$userIds = @($userIds | Select-Object -Unique)

# 4. Teams: publish to your org's apps, then make it available to and install it for those users.
Step "Adding Away Mode to Teams for $($userIds.Count) user(s)"
$version = (Get-Content (Join-Path $PSScriptRoot "teams-app\manifest.json") -Raw | ConvertFrom-Json).version
$catalogId = $null
try {
  if (-not (Get-Module -ListAvailable -Name MicrosoftTeams)) {
    Write-Host "Installing the MicrosoftTeams PowerShell module for your account..."
    Install-Module MicrosoftTeams -Scope CurrentUser -Force -AllowClobber
  }
  Import-Module MicrosoftTeams
  Write-Host "Signing in to Teams (a Microsoft sign-in window will open)..."
  Connect-MicrosoftTeams | Out-Null
  $teamsApp = try { Get-TeamsApp -ExternalId $app.AppId } catch { $null }
  if ($teamsApp) {
    # Push the current package (new icon or version); Teams refuses an unchanged version, which is fine.
    try { Set-TeamsApp -Id $teamsApp.Id -Path $app.Zip | Out-Null; Write-Host "Updated Away Mode in your org's Teams apps." }
    catch { Write-Host "Away Mode is already in your org's Teams apps." }
  } else {
    $teamsApp = New-TeamsApp -DistributionMethod organization -Path $app.Zip
    Write-Host "Published Away Mode to your org's Teams apps."
  }
  $catalogId = $teamsApp.Id
  Update-M365TeamsApp -Id $catalogId -AppAssignmentType UsersAndGroups -Users $userIds -OperationType Add
  Update-M365TeamsApp -Id $catalogId -IsBlocked $false -AppInstallType UsersAndGroups `
    -InstallForOperationType Add -InstallForUsers $userIds -InstallVersion $version
  Write-Host "Away Mode is available to and installed for $($userIds.Count) user(s). It can take a few minutes to show up in Teams."
} catch {
  $idText = if ($catalogId) { $catalogId } else { "<Away Mode's App ID in the Teams admin center>" }
  Write-Warning "Couldn't finish the Teams part: $($_.Exception.Message)"
  Write-Host "This needs a Teams admin. Send them this:" -ForegroundColor Yellow
  Write-Host "  1. Teams admin center > Teams apps > Manage apps > Upload new app: $($app.Zip)"
  Write-Host "  2. In PowerShell with the MicrosoftTeams module (Connect-MicrosoftTeams first):"
  Write-Host "     Update-M365TeamsApp -Id $idText -AppAssignmentType UsersAndGroups -Users $($userIds -join ',') -OperationType Add"
  Write-Host "     Update-M365TeamsApp -Id $idText -AppInstallType UsersAndGroups -InstallForOperationType Add -InstallForUsers $($userIds -join ',') -InstallVersion $version"
  Write-Host "Carrying on with the Claude Code part."
}

# 5. Claude Code plugin: install, then save the three values. The secret goes over stdin only,
#    never on a command line, and Claude Code keeps it in your OS keychain.
Step "Installing the Claude Code plugin"
# On a re-run, refresh the marketplace and the plugin first: configure needs the current
# plugin.json, which declares the three settings at plugin level.
if ((& claude plugin marketplace list | Out-String) -match "awaymode") {
  & claude plugin marketplace update awaymode
} else {
  & claude plugin marketplace add fbrinadze/awaymode4Claude
}
if ($LASTEXITCODE -ne 0) { throw "Couldn't add or refresh the Away Mode marketplace in Claude Code." }
& claude plugin install $plugin
if ($LASTEXITCODE -ne 0) { Write-Warning "claude plugin install reported a problem; trying to update it instead." }
& claude plugin update $plugin
if ($LASTEXITCODE -ne 0) { Write-Warning "claude plugin update reported a problem; trying to save the settings anyway." }
@{ tenant_id = $app.TenantId; bot_app_id = $app.AppId; bot_secret = $app.Secret } |
  ConvertTo-Json -Compress | & claude plugin configure $plugin --values-stdin
if ($LASTEXITCODE -ne 0) { throw "Couldn't save Away Mode's settings in Claude Code." }
$app.Secret = $null
Write-Host "Plugin installed and configured."

Step "All set"
Write-Host "1. Open a NEW terminal (so it picks up Bun) and start Claude Code with:"
Write-Host "     $launch" -ForegroundColor Green
Write-Host "2. Run /away-mode:setup: sign in with the code it shows, then reply hi to Away Mode in Teams."
Write-Host "3. When you step away, just say so, for example: going to lunch, back at 1:30."
