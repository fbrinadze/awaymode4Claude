---
name: back
description: Turn off Away Mode when the user is back at the terminal. Use when the user says they're back, "I'm here", "back from lunch", or runs /away-mode:back.
---

# Turn Away Mode off

1. Call the Away Mode `set_away` tool with `on: false`.
2. Welcome them back in one line, then list anything they missed: questions you asked in Teams that are still unanswered, approvals that timed out, and tasks you finished or parked while they were away. If nothing is open, say so.
3. From now on, ask questions in the terminal as usual.
