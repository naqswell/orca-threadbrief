# Your first session summary

If you want to know where you left off, you only need the plugin and a local agent session. Leave the settings at their defaults. You do not need a workflow profile, an API key, a Git repository, or a script.

## Try it on one task

1. [Install the plugin](../README.md#install). Open a local agent conversation in Orca, or select one where the agent has already finished a task.
2. For a quick trial, ask: **“I have six guests and eight chairs. How many chairs will be spare? Answer in one sentence.”** Wait for the answer. Leave the conversation tab selected; you don't have to close it.
3. Open **Threadbrief** in the right sidebar. Under **Last agent reply**, you should see the agent's answer about the two spare chairs. Switch to a different conversation and the panel follows that selection.

Opening the panel displays a reply the agent already wrote, in its original language. It never starts a second model. The panel looks through the last 20 history entries for the latest assistant message with text, skips tool calls and short acknowledgements, and shows up to 1,600 characters before an ellipsis.

No formatting prompt is required. Plain text keeps its line breaks. Markdown replies display headings, lists, tables, emphasis and code; command examples are selectable text, not actions. Web links open through Orca when you click them. File links keep their label and show the path on hover. HTML is displayed as text and remote images are not loaded.

### Load a brief only when you need it

Turn on **Load briefs only on click** in the gear menu or Orca’s settings for Threadbrief. Select a session and click **Load brief**. When you leave and come back, Threadbrief restores what you last read, even if the agent has since replied. **Refresh**, pinned beside the gear, fetches the latest version. Expand a before/after pair to load its images.

The worker remembers the last 12 manually loaded sessions in memory, separately for each workspace and source host. Returning does not reread reports or conversation history. Restarting the worker, changing the history or load settings, or editing exclusions clears the remembered briefs. New worktrees do not auto-open in this mode. [Set this preference from an agent](configuration.md).

These buttons display existing material, including on a paired server. To ask a model for a new recap, use the preview and start buttons below. Turn off **Load briefs only on click** to resume automatic updates.

## Keep a running handoff in the same session

Use a checkpoint when one task spans many turns. Instead of asking another agent to reread a chat excerpt, ask the agent already doing the work to leave a handoff at a milestone.

1. Open **Handoff → Copy instructions** in the panel. Copying reads no conversation and sends nothing. Paste into your next regular message in the **original** conversation. That message and the agent’s answer use its normal input and output tokens; Threadbrief cannot quote a price.
2. When that turn finishes, click **Handoff → Save checkpoint** before another reply replaces it. Threadbrief checks the selected server and session, reads up to the 100 most recent entries through Orca, and saves only the block at the end of the latest assistant reply. This does not start an agent. The panel shows **Session handoff · checkpoint N**.
3. At the next milestone, ask the same agent to update the checkpoint. Each revision is a **complete replacement**: it carries forward relevant decisions and evidence, not the whole transcript. Nothing runs between saves to maintain it. If the agent loses earlier context, use **Copy saved handoff** and paste the snapshot into your next turn.

For agents: finish the reply with this fenced JSON block. Use the conversation’s language, one line of text per field (up to 480 characters). Start at revision 1 and increase it on each update. Use “None” for an empty field; do not invent missing history.

````text
```threadbrief-checkpoint
{"revision":1,"goal":"Seat six guests.","done":"Reserved room A.","decisions":"Choose room A for its step-free entrance.","checks":"The venue confirmed eight seats.","open":"Final guest count.","next":"Send invitations."}
```
````

Only the latest saved version is kept per server and session, on the desktop showing the panel. A duplicate changes nothing. An older, conflicting or malformed checkpoint cannot replace it. A report written with the CLI takes precedence and is never replaced by **Save checkpoint**. If you start midway through a long session, earlier facts the agent no longer sees cannot be recovered from this feature. With paired history off or the server disconnected, Threadbrief cannot capture a new checkpoint.

## Choose a strategy and an agent

| Settings → Recap strategy | What it does | Extra model usage |
| --- | --- | --- |
| **Brief recap** (default) | Prepares up to 3,000 characters from the last 12 entries. Asks for goal, outcome and next step in up to 90 words. | One new agent session per confirmed request |
| **Instant** | Reads existing text. Use it to pick up where you left off. | None |
| **Detailed handoff** | Sends up to 12,000 characters from the last 48 entries. Asks for decisions, evidence, loose ends and next steps in up to 400 words. | One new session with a larger input and requested output |

Open **Settings → Recap strategy and model** to choose an agent installed in the selected workspace, even while a turn is running. Once the conversation finishes, choose **Preview recap request**. Read the destination and the exact prompt, including the excerpt. Tool calls and tool output are left out; ordinary messages may still contain private information. **Start recap in new session** opens a separate agent terminal in that workspace. Select the new terminal to read the answer there or in Threadbrief. The source conversation and its saved report are not changed.

**Choose a model:** keep **Use agent’s default** or pick a named model under **Reported by**. If the list is empty, [ask the agent to register its models](configuration.md#let-an-agent-fill-the-model-picker). **Add a model…** still lets you pin an exact identifier yourself. Check the model and host in the preview. To unpin, choose **Use agent’s default**. In Orca’s plugin settings the same selection is **Preferred recap agent** and **Custom recap model (optional)**. Threadbrief does not retry a rejected launch with a different model.

**Reasoning effort** appears below Model when the selected agent reports levels for that model on this host. Keep **Agent default** to leave the level up to the agent. A higher level may use more time and tokens; it does not increase the history window or word budget. The preview shows the exact effort requested. If a host stops offering it, choose another level before starting.

With the field empty the recap uses the agent’s default model, not necessarily the one in the original tab. It uses the agent’s configured account and permissions either way. The prompt asks for a text-only answer; the plugin does not sandbox the agent. Character and word budgets are not token or price guarantees. Previewing and refreshing never launch a model. If history is disabled or the selection is excluded, no recap can start.

## Choose what goes into the recap

The default is the agent's reply as written. To get a handoff instead, ask the agent before it finishes, or send a follow-up in the same conversation. The gear beside the task title opens **Settings → How to get your first summary → Copy prompt**. Copying does not send a message.

> Sum up this task in my language. Use three short lines: Goal, Done, Next. Mention anything still unresolved. If nothing remains, say so.

For example, after planning a small event, the panel might show:

```text
Goal: Seat six guests.
Done: Counted eight chairs. Two will be spare.
Next: Confirm whether anyone else is coming.
```

Change the prompt to suit the work: ask for a decision and its reason, an unanswered question, or the next person's first step. If you want this format regularly, put the instruction in your agent's usual preferences. The plugin doesn't need to know which agent or industry you use. A prompt changes what the agent **says**; it does not write a saved report.

## Where did this text come from?

The panel shows the first available source, not a blend of conversations:

| Label in the panel | Whose work it describes |
| --- | --- |
| **Saved for this session** | A report explicitly written for this Orca session. It wins even if there is a newer reply. |
| **Session handoff · checkpoint N** | A snapshot written in the original conversation and saved by you. It does not change when the agent replies again. |
| **Last agent reply** | The selected agent's last substantive reply, not a recap of the conversation. On by default for both local and paired sessions. |
| **Shared with this worktree** | A saved report for the checkout. It can include other sessions' work; it isn't attributed to the selected agent. |

Turning off **Use the agent’s last reply** disables history, including manual recap previews. It doesn't delete anything. No history is sent to an agent unless you confirm the preview.

## Using a paired Orca server

Install Threadbrief on the desktop that shows the panel. Pair the server in Orca, select its agent tab and leave **Read paired session history** on. Threadbrief checks the server, workspace, pane and session ID before requesting history over the Orca connection. It never substitutes a local transcript or launches a local agent if the server disconnects. Brief and Detailed list the agents installed on that server and launch the confirmed prompt in a new terminal there, with that server's agent account. Select the new terminal from the paired workspace to see the result.

Turn off **Read paired session history** for saved reports only. To supply a remote report, run the writer in the next section **on the desktop**, with `--environment <paired-name>` and the remote session ID. The writer verifies the session with the server, then saves the report locally. The server does not need its own plugin. Installing a second copy does not synchronize files, settings or exclusions. Project-specific workflow commands still require a local Git worktree.

## Save a report that won't change with the next reply

Skip this if history is enough. Use a saved report for a stable handoff or when a host does not expose readable session history.

1. On the machine running the plugin, open a terminal in a checkout of this plugin's source. The writer needs Node.js 24 and the Orca CLI. Keep the target session open. Run `orca agent list --environment local --json` and find its `orcaSessionId`; don't use the tab title. For a paired environment, substitute its name or ID for `local`.
2. Create a UTF-8 file named `summary.json`. All three fields below are required. Use one line of plain text per field, up to 480 characters each. For `next`, say what remains or explicitly say that nothing remains. Don't include credentials or private links you wouldn't want someone reading the panel to see.

   ```json
   {
     "goal": "Seat six guests.",
     "done": "Counted eight chairs. Two will be spare.",
     "next": "Confirm the final guest count."
   }
   ```

3. Replace `SESSION_ID` with the actual ID. From bash or zsh:

   ```sh
   node session-summary.mjs SESSION_ID < summary.json
   ```

   From PowerShell:

   ```powershell
   Get-Content -Raw -Encoding utf8 summary.json | node session-summary.mjs SESSION_ID
   ```

   For a paired session, add `--environment NAME` after `SESSION_ID`. On success, the writer returns the environment and file path. It keeps the report under `.session-summary` in your home directory, not in the project. Running the writer again for the same session and environment replaces that report.
4. Select that session. Under **Saved for this session** you should see **Goal**, **Done** and **Next** with the text from the file.

## If you don't see the result you expected

| What you see | What to try |
| --- | --- |
| The panel asks you to select an agent tab | Select the conversation itself, not a file, empty shell, or browser tab. In a split terminal, select the pane with the agent. |
| **Loading summary…** | The panel is fetching its first brief. After that, switching sessions keeps the previous brief visible until the next one is ready, with no loading animation. |
| **Agent working** | You can keep reading this session’s last completed reply or saved report. The unfinished turn is not a summary. If there is no previous result, the panel waits for the first one. |
| **Update available** | You were reading when the same session changed. Click **Update available** in the top bar to read the new version. Switching sessions follows the new selection; turning off history or excluding it clears the old view immediately. |
| You prefer a live view even while reading | Turn off **Pause updates while reading** in the gear under **Panel**, or in Orca’s plugin settings. Any pending result appears immediately; future updates no longer wait for **Refresh**. This does not start a model. |
| The agent finished, but there is no history reply | Check **Use the agent’s last reply**. Ask for a short recap in the same tab. If Orca has no readable history for this session, use a saved report. |
| A paired session has no reply | Check the paired connection, both history preferences and whether the agent finished. If the server does not expose that transcript, use a saved report. |
| The panel shows a shared report or an older saved report | Check the source label above. A shared report belongs to the checkout. To change a saved session report, write it again for the same session ID. |

## Turn off summaries for selected work

Open the gear and expand **Excluded summaries**. Choose **Exclude** beside the current session, workspace or project. A workspace rule covers its sessions; a project rule also covers future workspaces in that project. If more than one rule matches, any one of them keeps summaries off. Under **Saved exclusions**, choose **Remove** to undo a rule, even if the original session is closed.

Threadbrief keeps these rules locally by ID, not by name. It still needs Orca's selection metadata to check a rule, but it skips history, saved reports, workflow actions and automatic panel opening for an excluded selection. It does not stop agents, disable Orca's own history or delete saved reports. If it cannot verify a relevant exclusion, it withholds the summary.

## What about Orca Bots?

Threadbrief follows the selected Orca agent session, not a bot account, connector or inbox. If a bot run is available as a regular selected agent session with a confirmed ID, the same source order and exclusions apply. A bot conversation with no such session is not a source of session history. The plugin does not search background bot runs, read Slack threads or post replies on the bot's behalf.

## Do I need a workflow profile?

No. Profiles add project-specific command buttons; they do not generate or format summaries. Leave **Workflow profiles** closed unless you want them. If you enable profile commands, **Show first** only chooses which button appears first: **Copy command** or **Open terminal**. Both stay available for a matching command. Neither executes it. See [private workflows](../README.md#private-workflows) to set one up.
