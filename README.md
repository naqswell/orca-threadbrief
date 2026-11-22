# Threadbrief for Orca

Threadbrief puts the selected Orca session’s last finished reply in the sidebar. Switch tabs and the brief follows. If the agent starts another turn, you can keep reading the previous result. To have a model write a new recap, preview the request and start a separate agent session.

<picture>
  <source media="(prefers-reduced-motion: reduce)" srcset="assets/threadbrief-demo.png">
  <img src="assets/threadbrief-demo.gif" alt="Threadbrief shows the workshop notes from session history. Switching to Workshop invite shows its saved Goal, Done and Next. The handoff stays visible with an Agent working indicator during a new turn." width="960">
</picture>

**[Install](#install)** · [Install with an agent](AGENTS.md) · [Try it with your first session](docs/getting-started.md) · [Compare recap strategies](docs/getting-started.md#choose-a-strategy-and-an-agent)

**Paired Orca servers:** install Threadbrief on the desktop that shows the panel. It reads the selected session from its own paired server and starts a recap there only after a preview. No plugin installation on the server is required. Report files, exclusions and workflow profiles do not sync between machines. [Paired setup and limitations](docs/getting-started.md#using-a-paired-orca-server).

## Install

To hand installation to your agent, send: **“Install Threadbrief for my Orca desktop from https://github.com/naqswell/orca-threadbrief. Follow AGENTS.md, verify the panel opens, and keep my current settings.”**

Requires Orca **1.4.268** or newer. Enable plugins under **Settings → Plugins**, then install from GitHub:

```sh
orca plugin install naqswell/orca-threadbrief --json
```

Orca asks for approval before running code. Review the publisher, repository and permissions, then run the approval command printed by your own installation. Open the panel from the sidebar or with:

```sh
orca plugin open naqswell.session-summary --panel summary
```

If you have the plugin source locally, run `orca plugin install . --json` from its directory instead. On Linux outside an Orca-managed terminal, use `orca-ide` in place of `orca` for the CLI examples.

A folder installation uses `local.session-summary` instead. **If you already use that local plugin, do not install another folder under the same ID.** Install the GitHub version alongside it, check your existing reports, then disable the old plugin if you no longer need it. Do not delete your saved reports. The public release starts at `0.1.0`; it is not an in-place update to the older local series.

## Settings

Click the gear at the top of the panel. **Brief recap** (default) asks for up to 90 words; **Detailed handoff** asks for up to 400. In **Recap strategy and model**, keep the agent’s default or pick a model from the [list reported by your agent](docs/configuration.md#let-an-agent-fill-the-model-picker). Check the agent, model, host and excerpt before starting. **Instant** only shows existing text. [Compare strategies and costs](docs/getting-started.md#choose-a-strategy-and-an-agent).

Prefer to load a brief yourself? Turn on **Load briefs only on click**. Click **Load brief** once, switch sessions, and return to the version you read. Use **Refresh** in the top bar to reread the report or latest reply.

**Configuring Threadbrief from an agent or terminal?** [Set preferences, choose a model, manage exclusions and profiles with JSON](docs/configuration.md). No developer mode or GUI automation required.

**Excluded summaries** skips history and saved reports for a session, workspace or project. Remove any rule there to resume. For saved reports only, turn off **Use the agent’s last reply**.

Use **Orca Settings → Plugins → Threadbrief** or the panel gear for the same preferences: local/paired history, recap strategy, preferred agent, icon, auto-open, workflow commands and their order. In native Settings the preferred agent is its installed ID (empty uses the host default); the panel offers a live picker. Context-specific operations—excluding the selected item, editing profiles and previewing an actual recap—belong to the panel, not the native preference form.

## Private workflows

**Configuring this for someone else?** [Create, check and apply a profile from the CLI](docs/workflow-profiles.md). The installed worker accepts the same JSON as the panel; no developer mode or GUI automation needed.

Expand **Settings → Workflow profiles** only if you want project-specific commands. Create a profile or choose **Import JSON** with a local file. The [example profile](examples/team-profile.json) uses neutral project data. A profile matches the beginning of an Orca project ID, not the visible workspace title. Preview the matches before saving. Imports start disabled; enable the profile and turn on **Show profile commands** when ready. If two enabled profiles match, the panel does not choose one.

A profile describes commands as an executable and its arguments, not a shell script. Choose the shell where you will paste the command. **Show first** only changes the order of two buttons on a matching command. **Copy command** copies text; **Open terminal** opens an empty shell. Neither runs the command. Use Orca’s Source Control for ordinary Git operations. An existing review link replaces the creation steps.

You can allow a profile to open a review with a specific local executable instead of the browser. Inspect the executable, fixed arguments and review host. This grant is separate from importing or enabling the profile. Use only an executable you trust. Keep real profiles out of this repository. Never put credentials into a profile, summary or link.

## Save a session report

Use a [saved report](docs/getting-started.md#save-a-report-that-wont-change-with-the-next-reply) when the handoff should stay put as the conversation continues, or when you're using a paired environment. The guide includes a complete JSON example and writer commands for bash, zsh and PowerShell. Saved session reports take priority over history; a shared worktree report is the last fallback. The panel still reads older reports without rewriting them.

## Access and data

This is a **trusted worker**, not a sandboxed theme. It reads local saved reports and Orca’s selected-tab information. The history fallback uses the Orca CLI on this machine; it does not send the conversation to a model or a remote summarization service.

| Orca permission | Why it is requested |
| --- | --- |
| `workspace:read`, `agent:read` | Identify the worktree and agent session, and react when selection or agent state changes. |
| `agent:launch` | Start a separate recap agent after you approve its prompt. Opening the panel never launches one. |
| `settings:own`, `storage:own` | Keep preferences, exclusions, workflow profiles and opener approvals on this installation. |
| `workspace:write` | Focus the new recap agent or the empty terminal opened for a workflow action. |
| `terminal:send` | Orca requires this capability to create an empty terminal. The plugin does not send text or Enter. |

## Development and release checks

No package installation or build step is needed. With Node.js 24 and the Orca CLI:

```sh
node --test
orca plugin validate . --json
```

The [release checklist](docs/v0.1.0.md#release-gates) requires a clean Orca installation on macOS, Linux and Windows plus a separate migration check. Passing Node tests or manifest validation is not a substitute for those desktop checks.

For the [Orca community directory](https://orca.dev/plugins/add), add the `orca-plugin` GitHub topic and push a new `vX.Y.Z` tag on the tested commit whose manifest has that version. Do not move a published tag. Check the [Threadbrief listing status](https://orca.dev/plugins/naqswell/orca-threadbrief) for the result. No separate GitHub Release or catalog pull request is required.

The panel tokenizes Markdown offline with [Marked 18.2.1](https://github.com/markedjs/marked/tree/v18.2.1). The browser module and its [license](vendor/marked.LICENSE) ship in `vendor/`; no CDN is used.

[MIT license](LICENSE)
