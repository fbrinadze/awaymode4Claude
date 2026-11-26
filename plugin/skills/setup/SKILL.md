---
name: setup
description: Connect Away Mode to Microsoft Teams - sign in, find the Away Mode bot chat, send a test message and pair. Use when the user runs /away-mode:setup, asks to set up or re-pair Away Mode, or an Away Mode tool says it isn't connected or the sign-in expired.
---

# Set up Away Mode

Walk the user through connecting this Claude Code session to Teams, using the Away Mode MCP server's `setup` tool. Keep each message to the user short and concrete.

## Before you start

- If no Away Mode `setup` tool is available, the plugin's channel isn't running. Tell the user to restart Claude Code with:
  `claude --channels plugin:away-mode@awaymode`
  or, if their organization hasn't approved the plugin yet:
  `claude --dangerously-load-development-channels plugin:away-mode@awaymode`
  Then stop.
- If `setup` says the Tenant ID, Bot app ID and Bot secret aren't set: those come from `setup/create-app.ps1` (Windows) or `setup/create-app.sh`, run by the user or their IT admin. Point them to the README's setup section, then stop.

## Steps

1. Call `setup` with `step: "start"`. Show the user the sign-in instruction it returns, exactly as given (a microsoft.com link and a code). Ask them to tell you when they've signed in.
2. When they say they're done, call `setup` with `step: "finish"`.
   - If it says the app isn't added in Teams, relay those instructions (upload `away-mode-teams.zip` in Teams, or add it from their organization's apps), wait for them, then call `finish` again. They don't need to sign in again.
   - If sign-in failed because their organization blocks device-code sign-in, say so plainly: browser sign-in isn't supported yet.
3. Ask them to reply **hi** to the Away Mode bot in Teams, then call `setup` with `step: "verify"`. If there's no reply yet, wait for them to confirm and verify again.
4. When it says "Paired", tell them they're ready: when they step away, they can just say so (for example "going to lunch, back at 1:30").

## Rules

- Never ask the user to paste a password, token, secret or code into the chat. The sign-in code goes into Microsoft's page, not here.
- Don't call `set_away` during setup.
