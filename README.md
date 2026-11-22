# Session Summary for Orca

Open **Session Summary** in Orca’s right sidebar to see what happened in the active session. You do not need a workflow profile, a Git hosting account or a script that writes summaries.

The panel first looks for a saved summary of the selected session. If none exists, **From session history** shows the last substantive reply from that completed local session. **Worktree summary** is a shared report for the checkout, not a reply from the selected agent. If no source applies, the panel says so. Your text stays in its original language.

## Install

Requires Orca **1.4.268** or newer. Enable plugins under **Settings → Plugins**. Once the repository is published, install from GitHub:

```sh
orca plugin install naqswell/orca-session-summary --json
```

Orca asks for approval before running code. Review the publisher, repository and permissions, then run the approval command printed by your own installation. Open the panel from the sidebar or with:

```sh
orca plugin open naqswell.session-summary --panel summary
```

A folder installation uses `local.session-summary` instead. **If you already use that local plugin, do not install another folder under the same ID.** Install the GitHub version alongside it, check your existing reports, then disable the old plugin if you no longer need it. Do not delete your saved reports. The public release starts at `0.1.0`; it is not an in-place update to the older local series.

## Settings

Click **Settings** in the panel header. Its preferences are the same ones shown under **Settings → Plugins → Session Summary** in Orca. You can turn off the history fallback, open the panel automatically for new worktrees that have a summary, enable workflow profile actions, or change the preferred command action. History is enabled by default. Auto-open and profile actions are off.

Turn off **Show icon in panel header** to hide the colored mark next to the title. The sidebar tab stays available. Use Orca’s own Source Control for normal GitHub or GitLab work. A known review URL can be opened from the summary.

## Private workflows

Under **Settings → Workflow profiles** in the panel, create a profile or import a local JSON file. The [example profile](examples/team-profile.json) uses neutral project data. A profile matches the beginning of an Orca project ID, not the visible workspace title. Review the matching projects before saving. Imported profiles start disabled; enable the profile and turn on **Enable workflow profile actions** when ready. If two enabled profiles match, the panel does not choose one.

A profile describes commands as an executable and its arguments, not a shell script. Choose the shell in which you will paste the command. **Copy command** leaves the active tab alone; **Open terminal** opens a shell without entering or executing the command. `Copied` means the clipboard changed, not that a push succeeded. Edit a review draft in the panel before copying the command. An existing review link replaces the creation steps.

You can allow a profile to open a review with a specific local executable instead of the browser. Inspect the executable, fixed arguments and review host. This grant is separate from importing or enabling the profile. Use only an executable you trust. Keep real profiles out of this repository. Never put credentials into a profile, summary or link.

## Write a session summary

This is optional. With Node.js 24, run the following from a source checkout, replacing `SESSION_ID` with the ID copied from Orca. The input file contains UTF-8 JSON, for example `{"goal":"Fix the parser","done":"Fixed parsing; tests pass","next":"Review the change"}`.

```sh
node session-summary.mjs SESSION_ID < summary.json
```

In PowerShell, use `Get-Content -Raw -Encoding utf8 summary.json | node session-summary.mjs SESSION_ID`. Add `--environment NAME` to select a paired Orca environment. The CLI checks the session before writing under `.session-summary` in your home directory. The panel also reads the older store without rewriting it.

## Access and data

This is a **trusted worker**, not a sandboxed theme. It reads local saved reports and Orca’s selected-tab information. The history fallback uses the Orca CLI on this machine; it does not send the conversation to a model or a remote summarization service.

| Orca permission | Why it is requested |
| --- | --- |
| `workspace:read`, `agent:read` | Identify the worktree and agent session, and react when selection or agent state changes. |
| `settings:own`, `storage:own` | Read plugin preferences and keep workflow profiles and opener approvals in the plugin’s own store. |
| `workspace:write` | Focus the empty terminal explicitly opened by the user for a workflow action. |
| `terminal:send` | Orca requires this capability to create an empty terminal. The plugin does not send text or Enter. |

## Development and release checks

No package installation or build step is needed. With Node.js 24 and the Orca CLI:

```sh
node --test
orca plugin validate . --json
```

The [release checklist](docs/v0.1.0.md#release-gates) requires a clean Orca installation on macOS, Linux and Windows plus a separate migration check. Passing Node tests or manifest validation is not a substitute for those desktop checks.

[MIT license](LICENSE)
