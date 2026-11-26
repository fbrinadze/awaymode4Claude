<#
.SYNOPSIS
  Creates the Entra app, the free Azure Bot and the Teams app package for Away Mode.

.DESCRIPTION
  Run once, signed in with `az login`, by you (for yourself) or by an IT admin (for a team).
  Needs: Azure CLI, an Azure subscription (the F0 bot is free), and rights to create app
  registrations. Prints the three values to enter in Claude Code, and writes
  setup/teams-app/away-mode-teams.zip to upload in Teams.

  Works in Windows PowerShell 5.1 and PowerShell 7.
#>
param(
  [string]$Name = "away-mode",
  [string]$ResourceGroup = "away-mode-rg",
  [string]$Location = "eastus"
)
$ErrorActionPreference = "Stop"

function Invoke-Az {
  $out = & az @args
  if ($LASTEXITCODE -ne 0) { throw "az $($args -join ' ') failed" }
  return $out
}

$tenant = Invoke-Az account show --query tenantId -o tsv
Write-Host "Tenant: $tenant"

# 1. One app registration: the bot's identity and the public client you sign in with.
#    Public client flows on, so device-code sign-in works without the secret.
$appId = Invoke-Az ad app create --display-name $Name --sign-in-audience AzureADMyOrg `
  --is-fallback-public-client true --query appId -o tsv
Invoke-Az ad sp create --id $appId | Out-Null
Write-Host "App registration: $appId"

# 2. Delegated Graph permissions, looked up by name. No admin consent: users consent at sign-in.
$graph = "00000003-0000-0000-c000-000000000000"
$scopes = "User.Read", "Chat.Read", "TeamsAppInstallation.ReadWriteSelfForUser", "offline_access"
$ids = foreach ($s in $scopes) {
  $id = Invoke-Az ad sp show --id $graph --query "oauth2PermissionScopes[?value=='$s'].id | [0]" -o tsv
  "$id=Scope"
}
Invoke-Az ad app permission add --id $appId --api $graph --api-permissions @ids | Out-Null

# 3. The bot secret: used only to send messages as the bot.
$secret = Invoke-Az ad app credential reset --id $appId --display-name "away-mode-bot" --years 2 `
  --query password -o tsv

# 4. A free Azure Bot on that app. Away Mode never receives calls, so the endpoint is a placeholder.
$suffix = -join ((97..122) | Get-Random -Count 6 | ForEach-Object { [char]$_ })
$botName = "$Name-$suffix"
Invoke-Az provider register --namespace Microsoft.BotService --wait | Out-Null
Invoke-Az group create -n $ResourceGroup -l $Location | Out-Null
Invoke-Az bot create -g $ResourceGroup -n $botName --app-type SingleTenant --appid $appId `
  --tenant-id $tenant --sku F0 --endpoint "https://example.invalid/away-mode-has-no-endpoint" | Out-Null
Invoke-Az bot msteams create -g $ResourceGroup -n $botName | Out-Null
Write-Host "Azure Bot: $botName (F0, free)"

# 5. The Teams app package: manifest with the bot ID, plus the two icons, zipped flat.
$here = Join-Path $PSScriptRoot "teams-app"
$stage = Join-Path ([IO.Path]::GetTempPath()) "away-mode-teams-$suffix"
New-Item -ItemType Directory -Force $stage | Out-Null
# No BOM: Windows PowerShell 5.1's -Encoding utf8 adds one, and Teams may reject the manifest.
$manifest = (Get-Content (Join-Path $here "manifest.json") -Raw).Replace("{{BOT_ID}}", $appId)
[IO.File]::WriteAllText((Join-Path $stage "manifest.json"), $manifest, (New-Object Text.UTF8Encoding $false))
Copy-Item (Join-Path $here "color.png"), (Join-Path $here "outline.png") $stage
$zip = Join-Path $here "away-mode-teams.zip"
Compress-Archive -Path (Join-Path $stage "*") -DestinationPath $zip -Force
Remove-Item -Recurse -Force $stage

Write-Host ""
Write-Host "Done. Enter these in Claude Code when the Away Mode plugin asks:" -ForegroundColor Green
Write-Host "  Tenant ID:   $tenant"
Write-Host "  Bot app ID:  $appId"
Write-Host "  Bot secret:  $secret"
Write-Host "The secret is shown once. Claude Code keeps it in your OS keychain; don't paste it anywhere else."
Write-Host ""
Write-Host "Then add the app in Teams: Apps > Manage your apps > Upload a custom app > $zip"
