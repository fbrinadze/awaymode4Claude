# Privacy

Away Mode runs entirely on your machine. There is no Away Mode server and no telemetry.

## What leaves your machine

Away Mode talks to a short list of Microsoft hosts, and only to relay your own messages while away mode is on:

- `login.microsoftonline.com`: sign-in and token requests (bot client credentials, and your delegated sign-in).
- `graph.microsoft.com`: reading replies in your Away Mode chat (`User.Read`, `Chat.Read`, plus `TeamsAppInstallation.ReadWriteSelfForUser` on the bot route).
- `smba.trafficmanager.net`: sending messages to you through the Bot Connector (bot route).
- `*.environment.api.powerplatform.com`: your own Power Automate flow's address (workflow route). It is the host in the Workflow URL you paste in during setup.

On the workflow route, the text of each message passes through your own Power Automate flow, in your own Microsoft 365 tenant, on its way to Teams. Away Mode runs no server of its own.

What is sent is the text of Claude's questions, permission prompts, finished-task notes and error alerts, so they can appear in Teams. Credential requests and secret-looking replies are blocked before they are sent or relayed. Nothing else leaves the machine.

## What is stored locally

- The plugin data folder (`CLAUDE_PLUGIN_DATA`): away-mode state (`state.json`), and a restricted-permission fallback file for credentials when no keychain is available.
- Your OS keychain: the bot secret (bot route), the workflow URL (workflow route) and your Microsoft refresh token.

Nothing is stored in the repository or written to logs. Remove the plugin and delete its data folder and keychain entries to erase everything.

## Contact

Questions or concerns: https://github.com/fbrinadze/awaymode4Claude/issues
