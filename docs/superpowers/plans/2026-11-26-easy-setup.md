# Easy Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One PowerShell command does every setup step outside Claude Code, and `/away-mode:setup` plus "going away" work reliably.

**Architecture:**
- A new `setup/install.ps1` orchestrates:
  - the existing `create-app.ps1`, made safe to re-run and given a `-PassThru` mode,
  - the Teams PowerShell module (publish, availability, install),
  - and the `claude plugin` CLI (install, plus `configure --values-stdin` so the secret travels on stdin only).
- In the server, `setup.ts` persists the pending device code to plugin data, so a closed session doesn't lose pairing.
- `set_away` gets a trigger-style description, and new `away`/`back` skills make "going away" reliable.

**Tech Stack:** Bun + TypeScript (no runtime deps), `bun test`; Windows PowerShell 5.1/7; Azure CLI; MicrosoftTeams PowerShell module; `claude plugin` CLI.

**Spec:** `C:\Users\fbrinadze\.claude\plans\atomic-wandering-quiche.md` (approved 2026-11-26). Background: memory `planned-one-command-installer`, `gti-teams-app-availability`.

## Global Constraints

- Zero runtime dependencies. No file over 150 lines, no function over 40 (`CLAUDE.md`).
- Only `plugin/` ships to users. Tests, docs and `setup/` stay outside it.
- PowerShell scripts run on Windows PowerShell 5.1: no `&&`, `??` or ternary. Write UTF-8 **without BOM** for the manifest. Don't redirect a native command's stderr under `$ErrorActionPreference = "Stop"`.
- The bot secret is never printed by `install.ps1`, never passed as a command-line argument, and only piped to `claude plugin configure --values-stdin`.
- Graph permissions stay exactly `User.Read`, `Chat.Read`, `TeamsAppInstallation.ReadWriteSelfForUser`, plus `offline_access`.
- Plugin id `away-mode@awaymode`, marketplace source `fbrinadze/awaymode4Claude`, launch flag `--dangerously-load-development-channels plugin:away-mode@awaymode`.
- Every change ships with a test where code is testable. Scripts get parser and `bash -n` checks; the live run is the user's.
- Never push to `main`. The work ends in a PR.

## Review Focus

1. **A `device.json` left from an earlier session has expired.** `finish` must ignore it, delete it, and say "run start again", never poll forever. Tested in Task 1.
2. **`device.json` is corrupt or empty.** Treat it as "no pending code", not a crash. Tested in Task 1.
3. **`install.ps1` re-run when everything exists.** It reuses the app, bot and Teams app, re-applying availability and install is harmless, and only a new appended secret is created. Checked by the user's live run (Task 4).
4. **The person isn't a Teams admin**, so `Connect-MicrosoftTeams` or `New-TeamsApp` fails. The installer prints an IT handoff block and still installs and configures the plugin. A code path in Task 4.
5. **"Back at 1:30" with no date, or "30 minutes".** `set_away` needs a future ISO time. The skill tells Claude to resolve it against the current local time, and the tool rejects past times (already tested). The description is checked in Task 2.

---

### Task 1: Pairing survives a closed session

**Files:**
- Modify: `plugin/server/setup.ts`
- Modify: `plugin/skills/setup/SKILL.md`
- Test: `test/setup.test.ts`

**Interfaces:**
- Consumes: `DeviceCode` from `plugin/server/auth.ts` (`{deviceCode: string; message: string; interval: number; expiresAt: number}`); `SetupDeps` (adds nothing new).
- Produces: file `${dir}/device.json` holding a `DeviceCode`, written with mode 0600 by `start`, read by `finish`, deleted after use or once expired. No exported API change.

- [ ] **Step 1: Write the failing tests** in `test/setup.test.ts`. They reuse the existing `harness()`; a second harness pointed at the **same `dir`** stands in for a restart, so give `harness` an optional `dir` parameter.
  - `"finish after a restart uses the saved sign-in code"`: run `start` on harness A. Build harness B on the same dir with an `Auth` whose `finishDeviceCode` records the code it received. Run `finish` on B. Expect the recorded `deviceCode` to be `"dc"`, `isError` false, and `existsSync(join(dir, "device.json"))` false afterwards.
  - `"an expired saved code is ignored and removed"`: write `device.json` with `expiresAt: T - 1` (T is the harness clock). Run `finish` on a fresh harness whose `graphToken` throws `SignedOut`. Expect `isError` true, the text to contain `/away-mode:setup`, and the file to be gone.
  - `"a corrupt saved code is treated as none"`: write `"{oops"` to `device.json`. Same expectations as the expired case.
- [ ] **Step 2: Run** `bun test test/setup.test.ts`. Expect the 3 new tests to FAIL: the code isn't persisted, and the file still exists.
- [ ] **Step 3: Implement in `setup.ts`:**
  - `savePending(dir, dc)` with mode 0600, and `takePending(dir, now): DeviceCode | null`. `takePending` reads the file, always deletes it, and returns null when it's corrupt or `expiresAt <= now`.
  - `start` saves the code.
  - `finish` uses `pending ?? takePending(d.dir, d.ctx.deps.now())`. Comment: `// ponytail: device_code is a short-lived credential; 0600 + delete-on-read, 15-min TTL`.
- [ ] **Step 4: Update `SKILL.md`:** if the user says they already signed in, for example after a restart, call `finish` before `start`.
- [ ] **Step 5: Run** `bun test`. Expect all to PASS.
- [ ] **Step 6: Commit** with `fix: keep the pending sign-in code across sessions`.

### Task 2: "Going away" turns away mode on

**Files:**
- Modify: `plugin/server/tools.ts` (the `set_away` description)
- Create: `plugin/skills/away/SKILL.md`, `plugin/skills/back/SKILL.md`
- Test: `test/flows.test.ts`

**Interfaces:**
- Consumes: the `set_away` tool `{on: boolean, until?: string}`, unchanged.
- Produces: the skills `away-mode:away` and `away-mode:back`.

- [ ] **Step 1: Write the failing test** in `flows.test.ts`: `"set_away tells Claude when to call it"`. List the tools via `tools/list`, find `set_away`, and expect its description to match `/stepping away/`, `/lunch/` and `/back/`.
- [ ] **Step 2: Run** `bun test test/flows.test.ts`. Expect FAIL.
- [ ] **Step 3: Set the `set_away` description to:**
  "Turn Away Mode on or off. Call it with on=true when the user says they're stepping away, going to lunch, in a meeting, heading home or done for the day; pass until as an ISO time worked out from their words (\"back at 1:30\", \"for 30 minutes\") or leave it out for the default. Call it with on=false when they say they're back."
- [ ] **Step 4: Write `away/SKILL.md`.**
  - Frontmatter `name: away`. The description triggers on away wording and `/away-mode:away [1h | until 5pm]`.
  - Body: call `set_away`, confirm in one line ("Away mode on until 1:30 PM. I'll message you on Teams."), then while away use `ask` for questions and `notify` type `finished` or `error`.
  - If `set_away` is unavailable, say the session needs the channel flag.
- [ ] **Step 5: Write `back/SKILL.md`.** It triggers on "I'm back" and `/away-mode:back`, calls `set_away` with on=false, and lists anything still open.
- [ ] **Step 6: Run** `bun test` and `bun run validate`. Expect PASS, with the skills listed as `away-mode:away`, `away-mode:back` and `away-mode:setup`.
- [ ] **Step 7: Commit** with `feat: away and back skills, clearer set_away trigger`.

### Task 3: `create-app` safe to re-run

**Files:**
- Modify: `setup/create-app.ps1`, `setup/create-app.sh`

**Interfaces:**
- Produces:
  - `create-app.ps1 -PassThru` returns `[pscustomobject]@{TenantId; AppId; Secret; Zip}` and writes no secret to the host.
  - Without `-PassThru`, the output is as today.
  - The bot name becomes `"$Name-" + $appId.Substring(0,8)` (`${APP_ID:0:8}` in bash).

- [ ] **Step 1: Find the app registration first.** Look it up with `az ad app list --display-name $Name --query "[0].appId" -o tsv`, and create it only if that's empty.
- [ ] **Step 2: Create the service principal only if missing.** Check with `az ad sp list --filter "appId eq '$appId'" --query "[0].id" -o tsv`; an empty result means create it.
- [ ] **Step 3: Use the fixed bot name.** Create the bot only if `az bot show -g $RG -n $bot` fails. Check that failure with `$LASTEXITCODE` from a direct call, not through `Invoke-Az`, which throws.
- [ ] **Step 4: Create the Teams channel only if missing**, using `az bot msteams show`.
- [ ] **Step 5: Make the secret reset non-destructive.** Use `--append`.
- [ ] **Step 6: Add `-PassThru`.** It returns the object and prints only non-secret progress.
- [ ] **Step 7: Apply the same changes to `create-app.sh`.** `-PassThru` stays PowerShell-only.
- [ ] **Step 8: Verify syntax.** Run the PowerShell parser on the `.ps1` and `bash -n setup/create-app.sh`. Expect no errors.
- [ ] **Step 9: Commit** with `fix: create-app scripts are safe to re-run`.

### Task 4: One-command installer

**Files:**
- Create: `setup/install.ps1`

**Interfaces:**
- Consumes: `create-app.ps1 -PassThru` (Task 3). Teams cmdlets: `Get-TeamsApp -ExternalId`, `New-TeamsApp -DistributionMethod organization -Path`, and `Update-M365TeamsApp` (both forms, exactly as in the spec). The `claude plugin` CLI.
- Produces: the script `setup\install.ps1 [-ForUsers <string[]>] [-Name away-mode] [-ResourceGroup away-mode-rg] [-Location eastus]`.

- [ ] **Step 1: Prerequisites.**
  - `az`: if missing, point to `winget install Microsoft.AzureCLI` and stop.
  - `bun`: if missing, run `winget install Oven-sh.Bun`, then put the bun folder on `$env:Path` for this process.
  - `claude`: if missing, stop with an explanation.
  - Run `az account show`, and `az login` if it fails.
- [ ] **Step 2: Create the app.** `$r = & "$PSScriptRoot\create-app.ps1" -Name … -ResourceGroup … -Location … -PassThru`.
- [ ] **Step 3: Work out who gets the app.** Use the object ID from `az ad user show --id <upn> --query id -o tsv` for each of `-ForUsers`, plus yourself from `az ad signed-in-user show`.
- [ ] **Step 4: Teams, in `try`/`catch`.**
  - Install the `MicrosoftTeams` module if missing, then `Connect-MicrosoftTeams`.
  - Publish with `New-TeamsApp` unless `Get-TeamsApp -ExternalId $r.AppId` already returns the app.
  - Run `Update-M365TeamsApp` for availability, then again to install at the manifest version (read from `setup/teams-app/manifest.json`).
  - **On failure:** print an "Ask your Teams admin to:" block with the zip path, the two `Update-M365TeamsApp` commands filled in, and the catalog ID if known. Then carry on.
- [ ] **Step 5: Plugin.**
  - Run `claude plugin marketplace add fbrinadze/awaymode4Claude` and `claude plugin install away-mode@awaymode`.
  - Then `@{tenant_id=$r.TenantId; bot_app_id=$r.AppId; bot_secret=$r.Secret} | ConvertTo-Json -Compress | claude plugin configure away-mode@awaymode --values-stdin`.
- [ ] **Step 6: Finish.** Print the launch command and "then run /away-mode:setup". Remind the user to open a **new** terminal.
- [ ] **Step 7: Verify syntax.** The PowerShell parser must report no errors. Grep the script for `Write-Host.*Secret` and expect no matches.
- [ ] **Step 8: Commit** with `feat: one-command Windows installer`.

### Task 5: Docs

**Files:**
- Modify: `README.md` (Quick start, One-time setup), `docs/SETUP.md`, `docs/PLAN.md`

- [ ] **Step 1: README Quick start.**
  1. `git clone` the repo, or download it.
  2. `powershell -ExecutionPolicy Bypass -File setup\install.ps1`.
  3. In a new terminal, run the launch command.
  4. Run `/away-mode:setup`, then say "going to lunch".

  Keep the manual steps under "Manual setup (macOS/Linux, or without admin rights)".
- [ ] **Step 2: SETUP.md.**
  - Lead with the installer section and `-ForUsers` for teams.
  - Add a "Tenant notes" section: custom uploads are often blocked (use "Submit an app to your org", or the installer); if the admin center's availability page fails, use the two `Update-M365TeamsApp` commands.
  - Note that re-running is safe and adds a new secret, so old ones can be deleted in Entra.
- [ ] **Step 3: PLAN.md.**
  - Tick Phase 2's live check.
  - In Risks, record the Phase 0 finding: replies reach Claude with no bot endpoint.
  - Mark the `away`/`back` skills as done early in Phase 3.
- [ ] **Step 4: Run** `bun run check`. Expect all PASS.
- [ ] **Step 5: Commit** with `docs: one-command setup, tenant notes, Phase 2 verified`.
