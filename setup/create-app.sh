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
APP_ID="$(az ad app create --display-name "$NAME" --sign-in-audience AzureADMyOrg \
  --is-fallback-public-client true --query appId -o tsv)"
az ad sp create --id "$APP_ID" >/dev/null
echo "App registration: $APP_ID"

# 2. Delegated Graph permissions, looked up by name. No admin consent: users consent at sign-in.
GRAPH=00000003-0000-0000-c000-000000000000
IDS=()
for s in User.Read Chat.Read TeamsAppInstallation.ReadWriteSelfForUser offline_access; do
  IDS+=("$(az ad sp show --id "$GRAPH" --query "oauth2PermissionScopes[?value=='$s'].id | [0]" -o tsv)=Scope")
done
az ad app permission add --id "$APP_ID" --api "$GRAPH" --api-permissions "${IDS[@]}" >/dev/null

# 3. The bot secret: used only to send messages as the bot.
SECRET="$(az ad app credential reset --id "$APP_ID" --display-name away-mode-bot --years 2 \
  --query password -o tsv)"

# 4. A free Azure Bot on that app. Away Mode never receives calls, so the endpoint is a placeholder.
# `|| true`: head closing the pipe makes tr exit with SIGPIPE, which pipefail would treat as failure.
SUFFIX="$(LC_ALL=C tr -dc 'a-z' </dev/urandom | head -c 6 || true)"
BOT="$NAME-$SUFFIX"
az provider register --namespace Microsoft.BotService --wait >/dev/null
az group create -n "$RG" -l "$LOCATION" >/dev/null
az bot create -g "$RG" -n "$BOT" --app-type SingleTenant --appid "$APP_ID" \
  --tenant-id "$TENANT" --sku F0 --endpoint "https://example.invalid/away-mode-has-no-endpoint" >/dev/null
az bot msteams create -g "$RG" -n "$BOT" >/dev/null
echo "Azure Bot: $BOT (F0, free)"

# 5. The Teams app package: manifest with the bot ID, plus the two icons, zipped flat.
STAGE="$(mktemp -d)"
sed "s/{{BOT_ID}}/$APP_ID/g" "$HERE/manifest.json" >"$STAGE/manifest.json"
cp "$HERE/color.png" "$HERE/outline.png" "$STAGE/"
rm -f "$HERE/away-mode-teams.zip"
(cd "$STAGE" && zip -q "$HERE/away-mode-teams.zip" manifest.json color.png outline.png)
rm -rf "$STAGE"

cat <<EOF

Done. Enter these in Claude Code when the Away Mode plugin asks:
  Tenant ID:   $TENANT
  Bot app ID:  $APP_ID
  Bot secret:  $SECRET
The secret is shown once. Claude Code keeps it in your OS keychain; don't paste it anywhere else.

Then add the app in Teams: Apps > Manage your apps > Upload a custom app > $HERE/away-mode-teams.zip
EOF
