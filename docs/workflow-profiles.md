# Set up a workflow profile without the UI

Use this runbook to add project-specific command buttons, not to configure summaries. Work on the machine that runs the installed Threadbrief worker, as the same OS user. Use Node.js 24 or later and a checkout of the plugin matching the installed version. No developer mode, database edits, API keys or access to Orca internals are required.

For summary behavior, agent or model selection, exclusions, and listing or removing profiles, use the [configuration CLI](configuration.md).

1. Run `orca plugin list --environment local --json`. Use the `pluginKey` of the installed Threadbrief **0.2.3 or later**, not the manifest ID. A folder install usually uses `local.session-summary`; a GitHub install uses the repository owner's prefix. Run `orca project list --environment local --json` and choose the target project's ID, not its display name. These command buttons support local Git worktrees, not paired workspaces.
2. Start with [the complete JSON example](../examples/team-profile.json). Save your own copy outside the repository. Use a string `id` of 1–128 letters, digits, underscores or hyphens, and the narrowest `projectPrefix` that matches the intended project(s). `name` is the button group's display name. `enabled` is a required boolean in the file, but import never trusts it. Set `shell` to `posix` or `powershell`. Set `reviewHost` to the lowercase hostname (without scheme) used for review links.
3. Each `steps` entry has a `label`, `kind` (`push` for a regular command, `review` for one using a review draft) and `argv`: executable first, then one argument per element. Supported substitutions are `{repo}`, `{branch}`, `{base}`, `{title}`, `{description}` as **whole arguments**. Do not embed a shell pipeline, interpreter or secrets. Optional `excludeBranchPrefix` hides command steps on matching branches. Optional `openReview` is a separate absolute executable and argument list with exactly one `{url}`; it is never trusted by CLI import.
4. Check the candidate before writing anything:

   ```sh
   node workflow-profile.mjs check my-profile.json
   ```

5. Apply it to the chosen installation. Use the key from step 1:

   ```sh
   node workflow-profile.mjs apply my-profile.json --plugin local.session-summary
   ```

   The default saves a **disabled** profile. To activate it and turn on **Show profile commands**, add `--enable` only if the user wants these commands. This setting also reveals other enabled matching profiles. Neither command runs a workflow step or authorizes an opener. Apply again with the same ID to replace the profile, or without `--enable` to disable it. Replacing a profile revokes any earlier custom-opener approval. An overlapping prefix produces a conflict, never an arbitrary winner.

6. Read the JSON result. `applied` (exit 0) means the installed worker saved the profile and completed the requested settings change. `saved` (exit 2) means the profile was saved, but the worker could not confirm **Show profile commands**; check that setting rather than importing again. `queued` (exit 2) is not a receipt; enable or open the target installation so its worker starts. For a rejection (exit 1), use `orca plugin logs <plugin-key> --environment local --json`. **Settings → Workflow profiles** lists applied profiles; no UI interaction is needed for an active worker to import one.

The CLI and worker exchange private files under `threadbrief-profile-imports/<plugin-key>/` inside the target Orca data directory. For a non-default installation, set `ORCA_USER_DATA_PATH` to its data directory before running `apply`. No profiles sync between machines or Orca installations. Requests left queued by versions before 0.2.3 are not replayed: after upgrading the worker and CLI, reapply the profile to the intended installation. On Linux outside Orca terminals use `orca-ide` instead of `orca`.
