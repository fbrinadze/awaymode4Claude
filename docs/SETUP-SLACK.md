# Set up Away Mode with Slack

**Not live-tested yet.** The Slack adapter is built and tested against fakes only. Expect rough edges on a real workspace, and please report them.

Slack is an alternative to Teams: when both Slack tokens are set, Away Mode uses Slack. It connects out to Slack over Socket Mode, so it never opens an inbound port.

## Before you start

- You can create apps in your Slack workspace (or an admin does it for you).
- Socket Mode apps can't be listed in the public Slack Marketplace, so each person or team creates their own app. One app allows up to 10 simultaneous connections.

## Steps

1. **Create the app from the manifest.** Go to https://api.slack.com/apps, choose Create New App, From a manifest, pick your workspace and paste `setup/slack-app/manifest.yaml`.
2. **Create the app-level token.** In the app, open Basic Information, App-Level Tokens, Generate Token and Scopes. Add the `connections:write` scope and generate it. This can only be done in the Slack UI. Copy the `xapp-` token.
3. **Install to your workspace.** Open Install App and choose Install to Workspace. Copy the Bot User OAuth Token (`xoxb-`).
4. **Store both tokens.** Run `claude plugin configure away-mode` and enter the Slack bot token and the Slack app-level token. They go to your OS keychain. Never paste them into a chat.
5. **Restart Claude Code** with the channel on: `claude --channels plugin:away-mode@awaymode`.
6. **Pair.** Run `/away-mode:setup`. Claude shows a 6-digit code. In Slack, open the Away Mode app (Apps, Away Mode, Messages tab) and send it the code as a DM. Claude confirms with "Paired", and the bot DMs you "Paired".

The code is valid for 10 minutes and works once. Away Mode records only your Slack user ID.

## Troubleshooting

- **The bot doesn't answer or the code isn't seen:** check that the Messages tab is enabled (the manifest does this) and that `message.im` is subscribed under Event Subscriptions.
- **Re-pair:** run `/away-mode:setup` again.
- **Back to Teams:** clear the two Slack tokens in `claude plugin configure away-mode`.
