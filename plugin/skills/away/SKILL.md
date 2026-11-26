---
name: away
description: Turn on Away Mode so Claude's questions, permission requests and finished notes go to Microsoft Teams. Use when the user says they're stepping away, going to lunch, in a meeting, heading home, done for the day, "back at 1:30", "away for an hour", or runs /away-mode:away [1h | until 5pm].
---

# Turn Away Mode on

1. Work out when they'll be back from their words, against the current local time: "back at 1:30" means the next 1:30, "for 30 minutes" means now plus 30 minutes, "until 5pm" means today at 5 PM (tomorrow if that's passed). With no time given, leave `until` out and the default applies.
2. Call the Away Mode `set_away` tool with `on: true` and, if you worked one out, `until` as an ISO 8601 time with the offset.
3. Confirm in one line, in their local time: "Away mode on until 1:30 PM. I'll message you on Teams."

## While away mode is on

- Ask questions with the Away Mode `ask` tool, not AskUserQuestion. Give numbered options when there are clear choices.
- When a task finishes, send `notify` with type `finished` and two or three lines on what was done.
- When stuck or failing, send `notify` with type `error`: what failed and what you're doing about it.
- Never ask for passwords, keys, tokens or other secrets through Teams. Tell the user to come back to the terminal.

## If it doesn't work

- No `set_away` tool: this session wasn't started with the channel on. Tell them to restart with `claude --dangerously-load-development-channels plugin:away-mode@awaymode` (or `--channels` if their organization approved it).
- It says Teams isn't connected: run the `setup` skill (/away-mode:setup) first.
