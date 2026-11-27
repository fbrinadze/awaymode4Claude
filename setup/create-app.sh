#!/usr/bin/env bash
# Creates the Entra app, the free Azure Bot and the Teams app package for Away Mode.
# Run once, signed in with `az login`, by you (for yourself) or by an IT admin (for a team).
# Needs: Azure CLI, zip, an Azure subscription (the F0 bot is free), and rights to create
# app registrations. Prints the three values to enter in Claude Code, and writes
# setup/teams-app/away-mode-teams.zip to upload in Teams.
#
# Usage: ./create-app.sh [name] [resource-group] [location]
set -euo pipefail

NAME="${1:-away-mode}"
RG="${2:-away-mode-rg}"
LOCATION="${3:-eastus}"
HERE="$(cd "$(dirname "$0")" && pwd)/teams-app"
command -v zip >/dev/null || { echo "zip is required" >&2; exit 1; }

TENANT="$(az account show --query tenantId -o tsv)"
echo "Tenant: $TENANT"

# 1. One app registration: the bot's identity and the public client you sign in with.
#    Public client flows on, so device-code sign-in works without the secret.
#    Safe to re-run: reuses the app (by name) and its service principal.
# Exact name match: --display-name is a prefix match and could pick "away-mode-dev" or similar.
APP_ID="$(az ad app list --filter "displayName eq '$NAME'" --query "[0].appId" -o tsv)"
if [ -n "$APP_ID" ]; then
  az ad app update --id "$APP_ID" --is-fallback-public-client true >/dev/null
  echo "App registration: $APP_ID (existing)"
else
  APP_ID="$(az ad app create --display-name "$NAME" --sign-in-audience AzureADMyOrg \
    --is-fallback-public-client true --query appId -o tsv)"
  echo "App registration: $APP_ID (new)"
fi
if [ -z "$(az ad sp list --filter "appId eq '$APP_ID'" --query "[0].id" -o tsv)" ]; then
  az ad sp create --id "$APP_ID" >/dev/null
fi

# 2. Delegated Graph permissions, looked up by name. No admin consent: users consent at sign-in.
GRAPH=00000003-0000-0000-c000-000000000000
IDS=()
for s in User.Read Chat.Read TeamsAppInstallation.ReadWriteSelfForUser offline_access; do
  IDS+=("$(az ad sp show --id "$GRAPH" --query "oauth2PermissionScopes[?value=='$s'].id | [0]" -o tsv)=Scope")
done
az ad app permission add --id "$APP_ID" --api "$GRAPH" --api-permissions "${IDS[@]}" >/dev/null

# 3. A new bot secret, added alongside any older ones (--append), used only to send as the bot.
SECRET="$(az ad app credential reset --id "$APP_ID" --append --display-name away-mode-bot --years 2 \
  --query password -o tsv)"

# 4. A free Azure Bot on that app. Reuse the one already bound to this app ID (earlier versions
#    named it with a random suffix); otherwise create "<name>-<first 8 of app ID>".
#    Away Mode never receives calls, so the endpoint is a placeholder.
az provider register --namespace Microsoft.BotService --wait >/dev/null
az group create -n "$RG" -l "$LOCATION" >/dev/null
BOT=""
for b in $(az resource list -g "$RG" --resource-type Microsoft.BotService/botServices --query "[].name" -o tsv); do
  if [ "$(az bot show -g "$RG" -n "$b" --query properties.msaAppId -o tsv)" = "$APP_ID" ]; then BOT="$b"; break; fi
done
if [ -n "$BOT" ]; then
  echo "Azure Bot: $BOT (existing)"
else
  BOT="$NAME-${APP_ID:0:8}"
  az bot create -g "$RG" -n "$BOT" --app-type SingleTenant --appid "$APP_ID" \
    --tenant-id "$TENANT" --sku F0 --endpoint "https://example.invalid/away-mode-has-no-endpoint" >/dev/null
  echo "Azure Bot: $BOT (new, F0, free)"
fi
az bot msteams show -g "$RG" -n "$BOT" >/dev/null 2>&1 || az bot msteams create -g "$RG" -n "$BOT" >/dev/null

# 5. The Teams app package: manifest with the bot ID, plus the two icons, zipped flat.
STAGE="$(mktemp -d)"
sed "s/{{BOT_ID}}/$APP_ID/g" "$HERE/manifest.json" >"$STAGE/manifest.json"
cp "$HERE/color.png" "$HERE/outline.png" "$STAGE/"
rm -f "$HERE/away-mode-teams.zip"
(cd "$STAGE" && zip -q "$HERE/away-mode-teams.zip" manifest.json color.png outline.png)
rm -rf "$STAGE"

# Show the secret only on a live terminal, so CI logs or redirected output never capture it.
if [ -t 1 ]; then
  SHOWN="$SECRET
The secret is shown once. Claude Code keeps it in your OS keychain; don't paste it anywhere else."
else
  SHOWN="(not shown: output isn't a terminal. Run this again in a terminal to get a new one.)"
fi
cat <<EOF

Done. Enter these in Claude Code when the Away Mode plugin asks:
  Tenant ID:   $TENANT
  Bot app ID:  $APP_ID
  Bot secret:  $SHOWN

Then add the app in Teams: Apps > Manage your apps > Upload a custom app > $HERE/away-mode-teams.zip
EOF
