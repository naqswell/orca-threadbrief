# Threadbrief for Orca

Pick up where you left off. Select an agent tab in Orca and open **Threadbrief** in the right sidebar. By default, the panel shows the last substantive reply from that local session once the agent finishes. No workflow profile, API key or report file is required.

**[Start here: get your first summary](docs/getting-started.md)**. Try a short task, see exactly what appears, and learn how to ask for a three-line handoff in your own language.

![Threadbrief cover: a thread leads to three notes labeled Goal, Done and Next.](assets/threadbrief-cover.png)

## Install

Requires Orca **1.4.268** or newer. Enable plugins under **Settings → Plugins**. Once the repository is published, install from GitHub:

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

Click the gear beside the task title. Leave **Use the agent’s last reply** on for automatic local history. Turn it off if you only want saved reports. Expand **How to get your first summary** for a prompt you can copy and adapt. The plugin never sends it for you.

Under **Panel**, hide the colored plugin icon or have the panel open when a new worktree already has a saved summary. Automatic opening is off by default. You can also change preferences in Orca under **Settings → Plugins → Threadbrief**.

## Private workflows

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
