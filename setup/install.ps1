<#
.SYNOPSIS
  Sets up Away Mode in one go: Azure app and bot, the Teams app, and the Claude Code plugin.

.DESCRIPTION
  Run once from the repo folder:
    powershell -ExecutionPolicy Bypass -File setup\install.ps1
  For a team (as a Teams admin), add the people who should get it:
    powershell -ExecutionPolicy Bypass -File setup\install.ps1 -ForUsers alice@contoso.com,bob@contoso.com

  Optional: -Sessions one (going away in a project hands over from the previous one; default
  several) and -ReplyRouting on (quoting a bot message in Teams routes to its project; default off).

  -Route bot|workflow: bot needs a Teams admin to add the app; workflow (no admin) signs in with
  your own small app registration and posts through a Power Automate Workflow URL you paste in.
  -SignInApp <app id|graph-tools> skips creating that app (graph-tools = Microsoft's Graph
  Command Line Tools app, only if your organisation blocks app registration).

  Safe to re-run. Needs the Azure CLI and Claude Code; installs Bun and the MicrosoftTeams
  PowerShell module if missing. The bot secret is never shown: it goes straight into Claude
  Code's settings (your OS keychain). Works in Windows PowerShell 5.1 and PowerShell 7.
#>
param(
  [string[]]$ForUsers = @(),
  [string]$Name = "away-mode",
  [string]$ResourceGroup = "away-mode-rg",
  [string]$Location = "eastus",
  [ValidateSet("several", "one")][string]$Sessions = "several",
  [ValidateSet("on", "off")][string]$ReplyRouting = "off",
  [ValidateSet("bot", "workflow")][string]$Route,
  [string]$SignInApp
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

# A bot app registered by an earlier run means this is a bot install: keep it, don't ask again.
if (-not $Route -and (Have az) -and (Test-Native { az account show })) {
  $botId = (& az ad app list --filter "displayName eq '$Name'" --query "[0].appId" -o tsv | Out-String).Trim()
  if ($botId) { $Route = "bot"; Write-Host "Found your existing Away Mode bot app; keeping the bot route (use -Route workflow to switch)." }
}
if (-not $Route) {
  $admin = Read-Host "Do you have a Teams admin who can add the Away Mode app? (y/N)"
  $Route = if ($admin -match '^(y|yes)$') { "bot" } else { "workflow" }
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
# Claude Code only sees the PATH it started with, and terminals opened before Bun was installed
# keep the old one. Find Bun's real path (the .exe, never an npm .cmd shim), then hardlink it into
# WindowsApps: that folder is on every user's default PATH and writable without admin rights, so a
# plain "bun" resolves even in a terminal that predates Bun. Hardlinks don't follow Bun updates,
# so a stale link is replaced when size or timestamp differ from the real file.
$bunPath = (& bun -e "console.log(process.execPath)" | Out-String).Trim()
if (-not $bunPath -or -not (Test-Path $bunPath)) { throw "Couldn't find where Bun is installed." }
$bunLink = "$env:LOCALAPPDATA\Microsoft\WindowsApps\bun.exe"
try {
  $real = Get-Item $bunPath
  $cur = Get-Item $bunLink -ErrorAction SilentlyContinue
  if (-not $cur -or $cur.Length -ne $real.Length -or $cur.LastWriteTime -ne $real.LastWriteTime) {
    if ($cur) { Remove-Item $bunLink -Force -ErrorAction Stop }
    New-Item -ItemType HardLink -Path $bunLink -Target $bunPath -ErrorAction Stop | Out-Null
  }
} catch {
  Write-Warning "Bun wasn't linked (bun.exe may be in use): close Claude Code and rerun this script; if Away Mode still can't find Bun, fully restart your terminal app"
}
if (-not (Test-Native { az account show })) {
  if ($Route -eq "workflow") { & az login --allow-no-subscriptions | Out-Null } else { & az login | Out-Null }
  if ($LASTEXITCODE -ne 0) { throw "az login failed." }
}
Write-Host "Azure CLI, Bun and Claude Code are ready."

$settings = @{ sessions = $Sessions; reply_routing = $ReplyRouting }
$graphWarning = "Microsoft's Graph tools app may carry more permissions than Away Mode needs in your organisation (anything already approved for it). Use your own app registration if you can."
if ($Route -eq "workflow") {
  # No admin route: your own app registration (or the Graph tools fallback) plus a workflow URL.
  . (Join-Path $PSScriptRoot "install-workflow.ps1")
  foreach ($kv in (Get-WorkflowSettings $SignInApp).GetEnumerator()) { $settings[$kv.Key] = $kv.Value }
}
if ($Route -eq "bot") {
# 2. Azure app registration, bot and Teams package (reused if they exist). The secret stays in $app.
Step "Creating (or reusing) the Azure app and bot"
$app = @(& (Join-Path $PSScriptRoot "create-app.ps1") -Name $Name -ResourceGroup $ResourceGroup -Location $Location -PassThru)[-1]

. (Join-Path $PSScriptRoot "install-bot.ps1")
Publish-TeamsApp $app $ForUsers
$settings.teams_route = "bot"
$settings.tenant_id = $app.TenantId
$settings.bot_app_id = $app.AppId
$settings.bot_secret = $app.Secret
}

# 5. Claude Code plugin: install, then save the settings. The secret goes over stdin only,
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
$settings | ConvertTo-Json -Compress | & claude plugin configure $plugin --values-stdin
if ($LASTEXITCODE -ne 0) { throw "Couldn't save Away Mode's settings in Claude Code." }
$settings = $null
if ($app) { $app.Secret = $null }
Write-Host "Plugin installed and configured."

Step "All set"
Write-Host "1. Start Claude Code with:"
Write-Host "     $launch" -ForegroundColor Green
$replyTo = if ($Route -eq "workflow") { "the chat with Workflows in Teams" } else { "Away Mode in Teams" }
Write-Host "2. Run /away-mode:setup: sign in with the code it shows, then reply hi in $replyTo."
Write-Host "3. When you step away, just say so, for example: going to lunch, back at 1:30."
