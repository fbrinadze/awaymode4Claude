---
name: doctor
description: Check why Away Mode isn't working and fix it. Use when the user runs /away-mode:doctor, says "away mode isn't working", "check away mode", "Teams messages aren't arriving", or an Away Mode tool is missing or errors.
---

# Away Mode doctor

1. Run two shell checks that need neither Bun nor the Away Mode server: is Bun on the PATH (`where bun` on Windows, `command -v bun` elsewhere), and does `claude plugin list` contain `away-mode` (and is it enabled)?
2. If the Away Mode `doctor` tool isn't available in this session, say so, give the three likely causes, and stop:
   - Bun isn't found (the server can't start without it).
   - The session wasn't started with the channel on: `claude --dangerously-load-development-channels plugin:away-mode@awaymode` (or your organization's `--channels` setting).
   - The plugin is disabled (`/plugin`).
3. Otherwise call `doctor` and show its lines exactly as they come. Each line is a tick (works) or a cross with the fix. Add the results of step 1 and, for any cross, tell the user the fix in plain words.
4. Only if the user agrees, call `doctor` again with `send_test: true` to send one test message to Teams, and report whether it worked.
