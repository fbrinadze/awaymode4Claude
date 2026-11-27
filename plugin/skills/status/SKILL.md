---
name: status
description: Show whether Away Mode is on, until when, and which Teams questions and approvals are still open. Use when the user runs /away-mode:status or asks "am I away?", "is away mode on?", or "what's waiting in Teams?".
---

# Away Mode status

1. Call the Away Mode `status` tool.
2. Tell the user in a few lines, in their local time: whether away mode is on and until when, then each open question (its ID and text) and how many approvals are waiting.
3. If something is open and they're at the terminal now, offer to handle it here. If away mode is still on but they're clearly back, offer to turn it off (the `back` skill).

If there's no Away Mode `status` tool, this session wasn't started with the channel on: say so, and give the launch command `claude --dangerously-load-development-channels plugin:away-mode@awaymode`.
