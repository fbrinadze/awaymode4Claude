# Dot-sourced by install.ps1 for the bot route: who gets the Teams app, and publishing/installing it.
function Publish-TeamsApp($app, [string[]]$ForUsers) {
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
}
