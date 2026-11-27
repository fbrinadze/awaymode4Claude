# Contributing

Issues and PRs are welcome. The project stays small on purpose.

- **Zero runtime dependencies.** Use plain `fetch`. Adding one needs a strong written reason.
- **No file over 150 lines, no function over 40.** Split by job.
- **Every change ships with a test.** Use the fake adapter, not live Microsoft calls.
- **Run `bun run check` before opening a PR.** It runs typecheck, tests and strict manifest validation.
- **Everything reaches `main` through a PR.** No direct pushes.

Keep security invariants intact (see [SECURITY.md](SECURITY.md)): don't widen the Microsoft scopes, add an inbound listener, or loosen the sender and approval checks.

## Releasing

Bump `version` in `plugin/.claude-plugin/plugin.json` and add a CHANGELOG entry in the release PR. `claude plugin update` compares that version, so a release that skips the bump never reaches users. Tag the merge commit afterwards with the same version.
