# Install and use Threadbrief for someone

Run these steps on the **desktop that displays the Orca sidebar**, as its user. A paired server can supply session history; it does not need the plugin. If your shell only reaches the server, give the user the desktop commands instead of installing there.

## Install or reuse the plugin

1. Use the desktop's Orca CLI (`orca` in the examples; `orca-ide` on Linux outside an Orca terminal, not the screen reader). Threadbrief requires Orca 1.4.268 or newer. Run `orca status --environment local --json`, then `orca plugin list --environment local --json`. If plugins are disabled, have the user turn them on in **Settings → Plugins**.
2. Look for **Threadbrief** in `result.plugins`. Check its `source` and `pluginKey`. Reuse the intended installation, including a folder installation with key `local.session-summary`; do not replace it, create a second copy, or delete its reports. If both are installed and the intended one is unclear, ask which to use. For an existing disabled copy, use `orca plugin enable <pluginKey> --environment local --json` and follow the same approval rule below.
3. If absent, install from GitHub. No checkout, Node.js installation, build, model account or workflow profile is required for installation:

   ```sh
   orca plugin install naqswell/orca-threadbrief --environment local --json
   ```

   On `approval_required`, show the user the publisher, source and exact access Orca reports. This is a **trusted Node worker** with the OS user's access, not a sandboxed theme. Once the user authorizes that access, repeat the command Orca returned in `error.data.command` with its fingerprint for this install. If approval is stale, review the new request. An approval prompt is not an installation receipt.
4. List plugins again. Use the returned key (normally `naqswell.session-summary` for GitHub) to open the **summary** panel:

   ```sh
   orca plugin open <pluginKey> --panel summary --environment local --json
   ```

   Replace `<pluginKey>` with the actual value. Check the open result and `plugin list` for a running worker. If it fails, inspect `orca plugin logs <pluginKey> --environment local --json`. Report the installed version, key and whether the panel opened. No test conversation or paid request is needed.

## First use and optional configuration

- Select an existing Orca session with a completed reply. By default the sidebar reads its saved report or last reply automatically. In on-demand mode, click **Load brief** once for the session; **Refresh** reads the latest text. An empty session can legitimately have no brief. [How to read or save a handoff](docs/getting-started.md).
- For a long session, offer [a checkpoint in the current conversation](docs/getting-started.md#keep-a-running-handoff-in-the-same-session), not a new recap session. Only write one when asked. End your reply with the documented block; carry forward still-relevant facts and note any unknowns. Leave the desktop save to **Handoff → Save checkpoint**. Do not create a background summarizer or install anything on the paired host.
- For a **new model-written recap**, the user chooses **Recap strategy and model**, previews the excerpt and destination, then starts it. Installation does not authorize sending conversation text to a provider.
- For a requested preference change, model catalog, exclusion or workflow profile, use [the configuration CLI](docs/configuration.md) from a checkout matching the installed version. Read current values, apply only the requested changes and read them back. Leave existing settings and model pins alone during installation.
- For **paired sessions**, keep the installation and configuration CLI on the desktop. Discover models and reasoning levels on the source server using its own account; register only their IDs, labels and supported levels for that environment. [Paired setup and limits](docs/getting-started.md#using-a-paired-orca-server).
