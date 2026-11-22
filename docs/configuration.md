# Configure Threadbrief without opening the panel

Use the config CLI for preferences, summary exclusions and installed profiles. It talks to the installed worker. Changes appear in Orca's native plugin settings and the panel. Configuring a model does not call it.

## Find the installation

Run `orca plugin list --environment local --json` on the desktop that displays the sidebar. Find **Threadbrief 0.2.5 or later** and copy its `pluginKey`. The examples use `local.session-summary` for a folder install; replace it everywhere with the actual key. On Linux outside an Orca terminal use `orca-ide` instead of `orca`.

Run the scripts with Node.js 24 or later from a Threadbrief checkout matching the installed version, **as the same OS user as the desktop worker**. Pairing a remote Orca server does not give a shell on that server access to the desktop's settings. Run the config CLI on the desktop instead. For a non-default Orca data directory, use the worker's `ORCA_USER_DATA_PATH`.

## Read, change, verify

```sh
node threadbrief-config.mjs schema
node threadbrief-config.mjs show --plugin local.session-summary
node threadbrief-config.mjs check examples/on-demand.json
node threadbrief-config.mjs apply examples/on-demand.json --plugin local.session-summary
node threadbrief-config.mjs show --plugin local.session-summary
```

`schema` describes the keys, types, allowed values and defaults for this checkout. `show` reads the installed preferences. `check` validates a JSON object offline. `apply` changes **only the keys present**. The [on-demand example](../examples/on-demand.json) sets `manualLoad` to `true` and `summaryStrategy` to `instant`. If only the loading behavior should change, use `{"manualLoad":true}`. To resume automatic loading, apply `{"manualLoad":false}`. Save your patch outside the plugin checkout.

Check the returned values against the requested patch. On a failed or unconfirmed write, inspect `show` before retrying. A file on disk is not proof that Orca applied it. If the worker is not running, check `orca plugin list --environment local --json` and `orca plugin logs local.session-summary --environment local --json`. This CLI needs an installed, enabled worker, not a development folder.

## Choose an agent or model

Use `orca agent installed --environment local --worktree active --json` to discover agent IDs for a local workspace. For a paired workspace use its server selector and worktree ID instead. `recapAgent` is that installed agent's ID. `recapModel` is an identifier the agent accepts on the **source host**; the agent list is not a model catalog. Set both in one patch when pinning a model. Use `"recapModel":""` for the agent's configured default; use `"recapAgent":""` and `"recapModel":""` for the host default. There is no need to guess a model ID or start a paid test session.

`manualLoad` controls **when the panel reads**. `summaryStrategy` controls **what a requested recap does**: `instant` displays existing material; `brief` and `handoff` offer a preview and a separate start action. Neither setting authorizes sending an excerpt to a provider. See [strategies and budgets](getting-started.md#choose-a-strategy-and-an-agent).

### Let an agent fill the model picker

With **Threadbrief 0.2.6 or later**, ask the agent: “List the chat models your configured account can use on this Orca host and register them in Threadbrief. Leave my selected model alone.” The agent should use its own model-list command or authenticated model picker, not a public list of everything a provider sells. If it cannot enumerate available models, leave the existing catalog alone.

For OMP, run this on the desktop when the source environment is `local`. It uses OMP's launch selector, not a display name. No chat is started.

```sh
omp models --json | jq -e '[.models[] | {id: .selector, name}] | select(length > 0)' | node threadbrief-config.mjs set-models - --agent omp --environment local --plugin local.session-summary
node threadbrief-config.mjs models --agent omp --environment local --plugin local.session-summary
```

For other agents, pass a UTF-8 JSON file instead of `-`. Use an array such as `[{"id":"provider/exact-id","name":"Display name"}]`, replacing the example with real launch IDs; `name` is optional. For a paired server, collect the list **on that server** using the relevant account, transfer only the IDs and labels to the desktop, then run `set-models` on the desktop with the server’s **environment ID** and actual Orca agent ID. No credentials belong in this file.

A successful write returns the environment, agent and number of models. **Settings → Recap strategy and model → Model** shows the list under **Reported by** for that agent on that host. Re-register after changing accounts or available models: each write replaces that one list. Send `[]` deliberately to clear it. A failed collection is not an empty catalog. Registration never pins a model or changes a previous pin.

## Exclude or restore a selection

```sh
node threadbrief-config.mjs exclusions --plugin local.session-summary
node threadbrief-config.mjs exclude rule.json --plugin local.session-summary
node threadbrief-config.mjs include rule.json --plugin local.session-summary
```

For `exclude`, copy `kind`, `host` and `id` from one entry in the current `choices` into `rule.json`. For `include`, take the same fields from a saved `rules` entry. Use the IDs exactly as returned; a workspace's display name is not its ID. If the selection changes, list again rather than applying a rule to a different session. A project rule also covers future sessions in that project. List again to verify. Exclusions do not erase history or reports.

## Manage workflow profiles

```sh
node threadbrief-config.mjs profiles --plugin local.session-summary
node workflow-profile.mjs check my-profile.json
node workflow-profile.mjs apply my-profile.json --plugin local.session-summary --enable
node threadbrief-config.mjs remove-profile team --plugin local.session-summary
```

Use a profile's `id` to update or remove it; replace `team` with the intended ID. Omit `--enable` to save a disabled profile. See the [profile format and import receipts](workflow-profiles.md). Importing a profile does not grant permission to launch a custom executable. That grant and Orca's approval to run a trusted plugin are separate user decisions. No config command starts an agent, runs workflow commands or edits Orca's database.
