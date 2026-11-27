# Away Mode setup

Away Mode needs three things in Microsoft 365, plus the plugin in Claude Code:
- an app registration, which is who signs in,
- an Azure Bot, which is who sends the messages,
- and a Teams app, which is where the chat lives.

On Windows, **one command does all of it**. On macOS/Linux, or without Teams admin rights, follow the manual steps.

## What you need

- [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli), signed in to your work tenant. The installer runs `az login` for you if needed.
- An Azure subscription. The bot uses the free F0 tier, and Away Mode deploys no web app, so nothing is billed.
- Permission to create app registrations in Entra ID. Most tenants allow this by default.
- Claude Code. [Bun](https://bun.sh) too, though the Windows installer installs it if it's missing.
- For the Teams part: a Teams admin (or Global Administrator). Without one, see [Tenant notes](#tenant-notes).

## Windows: one command

From a copy of this repo, in PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File setup\install.ps1
```

For a team, add the people who should get Away Mode:

```powershell
powershell -ExecutionPolicy Bypass -File setup\install.ps1 -ForUsers alice@contoso.com,bob@contoso.com
```

It:
1. **Checks prerequisites:** the Azure CLI, Claude Code and Bun (installing Bun with winget if needed).
2. **Creates or reuses the Azure side.** It runs `create-app.ps1` (below) and adds a fresh bot secret without ever showing it.
3. **Puts Away Mode in Teams.** It signs you in to the Teams PowerShell module (installing it if needed) and publishes the app to your organization's apps, or updates it if it's already there. It then makes the app **available to** and **installs it for** you and anyone in `-ForUsers`. Installs can take a few minutes to show up.
4. **Installs the plugin** with `claude plugin install away-mode@awaymode`, and saves the Tenant ID, Bot app ID and Bot secret (plus the `sessions` and `reply_routing` settings, from `-Sessions several|one` and `-ReplyRouting on|off`) with `claude plugin configure`. The secret goes to your OS keychain.
5. **Prints what to do next.**

It's safe to re-run. Each run adds one new bot secret; older ones keep working until you delete them in Entra (**App registrations → away-mode → Certificates & secrets**).

If the Teams step fails, for example because you aren't a Teams admin, the installer prints the exact steps to send to your admin and still sets up the plugin.

**Upgrading from an earlier Away Mode:** the Tenant ID, Bot app ID and Bot secret moved from the channel settings to the plugin settings. Re-run `install.ps1`, which refreshes the plugin and saves them, or re-enter them under `/plugin` → Away Mode.

## Then: pair

1. Run `claude --dangerously-load-development-channels plugin:away-mode@awaymode`.
2. Run `/away-mode:setup`. Sign in at the microsoft.com link with the code it shows.
3. Reply **hi** to Away Mode in Teams. Claude confirms you're paired.

If the terminal closes after you sign in, start Claude Code again and say "I signed in". The code is kept for about 15 minutes.

## Manual setup (macOS/Linux, or step by step)

1. **Create the app and bot:** run `./setup/create-app.sh` (or `.\setup\create-app.ps1`). Optional arguments are the name (`away-mode`), resource group (`away-mode-rg`) and location (`eastus`). It:
   - creates or reuses a single-tenant **Entra app registration**, with public client flows on (for device-code sign-in) and the delegated permissions `User.Read`, `Chat.Read`, `TeamsAppInstallation.ReadWriteSelfForUser` and `offline_access`, none of which need admin consent,
   - adds a **bot secret**, valid for two years,
   - creates or reuses a free **Azure Bot** on that app, with its Microsoft Teams channel on. The messaging endpoint is a placeholder on purpose: Away Mode sends from your computer and reads replies through Graph,
   - writes `setup/teams-app/away-mode-teams.zip`,
   - and prints the **Tenant ID**, **Bot app ID** and **Bot secret**. The secret is shown once.
2. **Add the Teams app.** If your Teams lets you: **Apps → Manage your apps → Upload an app → Upload a custom app**, and choose the zip. Otherwise see [Tenant notes](#tenant-notes).
3. **Install the plugin** at the Claude Code prompt with `/plugin marketplace add fbrinadze/awaymode4Claude` and then `/plugin install away-mode@awaymode`. Enter the three values under `/plugin` → Away Mode.
4. **Pair** as above.

## Tenant notes

- **"Upload a custom app" is missing.** Many organizations turn off personal uploads. Choose **Submit an app to your org** instead; a Teams admin then publishes it. Or have an admin run the installer, which publishes it directly.
- **The app is published but Teams says "Request approval", and the admin center's *Users and groups → Availability* page won't load** ("We can't get assignments right now"). Set availability and install from PowerShell instead. You need the `MicrosoftTeams` module and must run `Connect-MicrosoftTeams` first. The catalog ID is the **App ID** shown in the admin center; the user ID is the Entra object ID.

  ```powershell
  Update-M365TeamsApp -Id <catalog id> -AppAssignmentType UsersAndGroups -Users <user id> -OperationType Add
  Update-M365TeamsApp -Id <catalog id> -AppInstallType UsersAndGroups -InstallForOperationType Add -InstallForUsers <user id> -InstallVersion <manifest version>
  ```

- **Teams deep links** for org apps use the catalog ID, not the bot ID: `https://teams.microsoft.com/l/app/<catalog id>`.
- **Your tenant blocks device-code sign-in.** Browser sign-in isn't supported yet.

## Troubleshooting

- **Away Mode's server won't start, or hooks say `bun` isn't found.** Claude Code only sees the PATH it was started with, and terminal apps like Windows Terminal and VS Code keep the PATH they had when they opened, so Bun installed afterwards can be invisible to them. The Windows installer links Bun into `%LOCALAPPDATA%\Microsoft\WindowsApps`, which is always on PATH. After a Bun update, rerun the installer to refresh that link. If the installer warned that Bun wasn't linked, fully quit your terminal app (every window) and open it again.

## Removing it

Delete the resource group (`az group delete -n away-mode-rg`), the app registration (`az ad app delete --id <Bot app ID>`) and the Teams app (in the Teams admin center), then uninstall the plugin (`/plugin`).
