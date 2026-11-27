# Away Mode

Away Mode relays Claude Code's questions, permission prompts, finished-task notes and errors to Microsoft Teams while you are away from your desk, and pushes your Teams replies back into the session. Turn it on with `/away-mode:away` and off with `/away-mode:back`.

## Install

```
/plugin marketplace add fbrinadze/awaymode4Claude
/plugin install away-mode@awaymode
/away-mode:setup
```

Away Mode runs on Bun, so Bun must be installed.

There are two routes to Teams: the bot route (needs a Teams admin) and the workflow route (no admin; a Power Automate flow you make sends the messages). See the setup guide linked below.

## Organization admins

Channels must be enabled for the organization and Away Mode allowed. In managed settings:

```json
{"channelsEnabled": true, "allowedChannelPlugins": [{"marketplace": "awaymode", "plugin": "away-mode"}]}
```

Individual users still need to start Claude Code with `--dangerously-load-development-channels` while channels are a research preview.

## More

Full documentation, the Teams bot setup guide and the security model are in the [main README](https://github.com/fbrinadze/awaymode4Claude#readme). See also the [privacy policy](https://github.com/fbrinadze/awaymode4Claude/blob/main/PRIVACY.md).
