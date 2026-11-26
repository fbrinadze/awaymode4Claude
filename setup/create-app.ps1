<#
.SYNOPSIS
  Creates (or reuses) the Entra app, the free Azure Bot and the Teams app package for Away Mode.

.DESCRIPTION
  Safe to re-run: it reuses the app registration (found by name), its service principal, the bot
  bound to that app and the bot's Teams channel. Each run adds one new bot secret (older ones keep
  working; delete them in Entra when you like).

  Run signed in with `az login`, by you (for yourself) or by an IT admin (for a team).
  Needs: Azure CLI, an Azure subscription (the F0 bot is free), and rights to create app
  registrations. Writes setup/teams-app/away-mode-teams.zip.

  Without -PassThru it prints the three values to enter in Claude Code. With -PassThru (used by
  install.ps1) it prints no secret and returns them as an object instead.

  Works in Windows PowerShell 5.1 and PowerShell 7.
#>
param(
  [string]$Name = "away-mode",
  [string]$ResourceGroup = "away-mode-rg",
  [string]$Location = "eastus",
  [switch]$PassThru
)
$ErrorActionPreference = "Stop"

function Invoke-Az {
  $out = & az @args
  if ($LASTEXITCODE -ne 0) { throw "az $($args -join ' ') failed" }
  return $out
}

# For "does it exist?" checks: true/false instead of throwing. Native stderr is redirected,
# which Windows PowerShell 5.1 turns into a terminating error under "Stop", so relax it here.
function Test-Az {
  $old = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try { & az @args 2>&1 | Out-Null; return ($LASTEXITCODE -eq 0) } finally { $ErrorActionPreference = $old }
}

$tenant = Invoke-Az account show --query tenantId -o tsv
Write-Host "Tenant: $tenant"

# 1. One app registration: the bot's identity and the public client you sign in with.
#    Public client flows on, so device-code sign-in works without the secret.
$appId = Invoke-Az ad app list --display-name $Name --query "[0].appId" -o tsv
if ($appId) {
  Invoke-Az ad app update --id $appId --is-fallback-public-client true | Out-Null
  Write-Host "App registration: $appId (existing)"
} else {
  $appId = Invoke-Az ad app create --display-name $Name --sign-in-audience AzureADMyOrg `
    --is-fallback-public-client true --query appId -o tsv
  Write-Host "App registration: $appId (new)"
}
if (-not (Invoke-Az ad sp list --filter "appId eq '$appId'" --query "[0].id" -o tsv)) {
  Invoke-Az ad sp create --id $appId | Out-Null
}

# 2. Delegated Graph permissions, looked up by name. No admin consent: users consent at sign-in.
$graph = "00000003-0000-0000-c000-000000000000"
$scopes = "User.Read", "Chat.Read", "TeamsAppInstallation.ReadWriteSelfForUser", "offline_access"
$ids = foreach ($s in $scopes) {
  $id = Invoke-Az ad sp show --id $graph --query "oauth2PermissionScopes[?value=='$s'].id | [0]" -o tsv
  "$id=Scope"
}
Invoke-Az ad app permission add --id $appId --api $graph --api-permissions @ids | Out-Null

# 3. A new bot secret, added alongside any older ones (--append), used only to send as the bot.
$secret = Invoke-Az ad app credential reset --id $appId --append --display-name "away-mode-bot" `
  --years 2 --query password -o tsv

# 4. A free Azure Bot on that app. Reuse the one already bound to this app ID (earlier versions
#    named it with a random suffix); otherwise create "<name>-<first 8 of app ID>".
#    Away Mode never receives calls, so the endpoint is a placeholder.
Invoke-Az provider register --namespace Microsoft.BotService --wait | Out-Null
Invoke-Az group create -n $ResourceGroup -l $Location | Out-Null
$botName = $null
$bots = Invoke-Az resource list -g $ResourceGroup --resource-type Microsoft.BotService/botServices --query "[].name" -o tsv
foreach ($b in @($bots | Where-Object { $_ })) {
  if ((Invoke-Az bot show -g $ResourceGroup -n $b --query properties.msaAppId -o tsv) -eq $appId) { $botName = $b; break }
}
if ($botName) {
  Write-Host "Azure Bot: $botName (existing)"
} else {
  $botName = "$Name-" + $appId.Substring(0, 8)
  Invoke-Az bot create -g $ResourceGroup -n $botName --app-type SingleTenant --appid $appId `
    --tenant-id $tenant --sku F0 --endpoint "https://example.invalid/away-mode-has-no-endpoint" | Out-Null
  Write-Host "Azure Bot: $botName (new, F0, free)"
}
if (-not (Test-Az bot msteams show -g $ResourceGroup -n $botName)) {
  Invoke-Az bot msteams create -g $ResourceGroup -n $botName | Out-Null
}

# 5. The Teams app package: manifest with the bot ID, plus the two icons, zipped flat.
$here = Join-Path $PSScriptRoot "teams-app"
$stage = Join-Path ([IO.Path]::GetTempPath()) ("away-mode-teams-" + $appId.Substring(0, 8))
New-Item -ItemType Directory -Force $stage | Out-Null
# No BOM: Windows PowerShell 5.1's -Encoding utf8 adds one, and Teams may reject the manifest.
$manifest = (Get-Content (Join-Path $here "manifest.json") -Raw).Replace("{{BOT_ID}}", $appId)
[IO.File]::WriteAllText((Join-Path $stage "manifest.json"), $manifest, (New-Object Text.UTF8Encoding $false))
Copy-Item (Join-Path $here "color.png"), (Join-Path $here "outline.png") $stage
$zip = Join-Path $here "away-mode-teams.zip"
Compress-Archive -Path (Join-Path $stage "*") -DestinationPath $zip -Force
Remove-Item -Recurse -Force $stage
Write-Host "Teams app package: $zip"

if ($PassThru) {
  return [pscustomobject]@{ TenantId = $tenant; AppId = $appId; Secret = $secret; Zip = $zip }
}

Write-Host ""
Write-Host "Done. Enter these in Claude Code when the Away Mode plugin asks:" -ForegroundColor Green
Write-Host "  Tenant ID:   $tenant"
Write-Host "  Bot app ID:  $appId"
Write-Host "  Bot secret:  $secret"
Write-Host "The secret is shown once. Claude Code keeps it in your OS keychain; don't paste it anywhere else."
Write-Host "Tip: setup\install.ps1 does all of this and configures the plugin without showing the secret."
Write-Host ""
Write-Host "Then add the app in Teams: Apps > Manage your apps > Upload a custom app > $zip"
