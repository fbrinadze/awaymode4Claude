# Away Mode setup

Away Mode needs three things in Microsoft 365: an app registration (who signs in), an Azure Bot (who sends the messages) and a Teams app (where the chat lives). One script creates the first two and packages the third.

You can do this **for yourself** or, as an IT admin, **once for a team**. The only difference is step 3.

## What you need

- [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli), signed in with `az login` to your work tenant.
- An Azure subscription. The bot uses the free F0 tier and Away Mode deploys no web app, so nothing is billed.
- Permission to create app registrations in Entra ID. Most tenants allow this by default; if yours doesn't, ask IT.
- For the personal path: permission to upload custom apps in Teams. If **Upload a custom app** is missing in Teams, ask IT or use the team path.
- macOS/Linux only: `zip`.

## 1. Create the app and bot

```powershell
# Windows (PowerShell 5.1 or 7), from the repo folder
.\setup\create-app.ps1
```

```bash
# macOS / Linux
./setup/create-app.sh
```

Optional parameters: name (default `away-mode`), resource group (default `away-mode-rg`), location (default `eastus`).

The script:

1. Creates a single-tenant **Entra app registration** with public client flows on (for device-code sign-in) and these delegated permissions: `User.Read`, `Chat.Read`, `TeamsAppInstallation.ReadWriteSelfForUser`, `offline_access`. None need admin consent.
2. Creates a **client secret** for the bot, valid for two years.
3. Creates a free **Azure Bot** on that app and turns on its Microsoft Teams channel. The bot's messaging endpoint is a placeholder on purpose: Away Mode sends from your computer and reads replies through Graph, so nothing ever calls the bot.
4. Writes **`setup/teams-app/away-mode-teams.zip`**, the Teams app package.

It ends by printing the **Tenant ID**, **Bot app ID** and **Bot secret**. The secret is shown once. Running the script again creates a new app and bot rather than reusing them.

## 2. Enter the values in Claude Code

Install the plugin (see the README's Quick start). Claude Code asks for the three values and keeps the secret in your OS keychain. To change them later, use `/plugin`.

## 3. Add the Teams app

- **For yourself:** in Teams, open **Apps → Manage your apps → Upload a custom app** and choose `away-mode-teams.zip`. That adds the Away Mode bot to your chats.
- **For a team (admin):** upload the zip in the Teams admin center under **Teams apps → Manage apps → Upload new app**, and allow it for the people who'll use it. Each person then finds **Away Mode** under **Apps** and clicks **Add**. Share the three values with them through your usual secure channel.

## 4. Pair

Start Claude Code with the channel on and run `/away-mode:setup`:

1. Claude shows a microsoft.com link and a code. Sign in there with your work account.
2. Away Mode finds your bot chat and sends a test message.
3. Reply **hi** in Teams. Claude confirms you're paired.

Your sign-in stays valid while you use it. Run `/away-mode:setup` again if it expires or you change machines.

## Removing it

Delete the resource group (`az group delete -n away-mode-rg`), the app registration (`az ad app delete --id <Bot app ID>`) and the Teams app, then uninstall the plugin.
