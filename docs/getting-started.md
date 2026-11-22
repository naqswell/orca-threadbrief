# Your first session summary

If you want to know where you left off, you only need the plugin and a local agent session. Leave the settings at their defaults. You do not need a workflow profile, an API key, a Git repository, or a script.

## Try it on one task

1. [Install the plugin](../README.md#install). Open a local agent conversation in Orca, or select one where the agent has already finished a task.
2. For a quick trial, ask: **“I have six guests and eight chairs. How many chairs will be spare? Answer in one sentence.”** Wait for the answer. Leave the conversation tab selected; you don't have to close it.
3. Open **Threadbrief**. With no saved summary, **Last agent reply** shows the answer about the two spare chairs. You don’t have to create anything. If there are earlier replies, expand **Earlier replies** to read those too.

These are quotes, not a whole-session summary. Threadbrief shows up to three distinct replies from the last 48 history entries, newest first, up to 1,600 characters each. Tool calls and short acknowledgements are skipped. Reading the replies does not start another model.

No formatting prompt is required. Plain text keeps its line breaks. Markdown replies display headings, lists, tables, emphasis and code; command examples are selectable text, not actions. Web links open through Orca when you click them. File links keep their label and show the path on hover. HTML is displayed as text and remote images are not loaded.

### Load a brief only when you need it

Turn on **Load briefs only on click** in the gear menu or Orca’s settings for Threadbrief. Select a session and click **Load brief**. When you leave and come back, Threadbrief restores what you last read, even if the agent has since replied. **Reload view** in the top bar checks for a newer saved summary or reply. It doesn’t create a summary. Expand a before/after pair to load its images.

The worker remembers the last 12 manually loaded sessions in memory, separately for each workspace and source host. Returning does not reread reports or conversation history. Restarting the worker, changing the history or load settings, or editing exclusions clears the remembered briefs. New worktrees do not auto-open in this mode. [Set this preference from an agent](configuration.md).

Creating or updating a report checks the selected session and saved revision first. If another report was saved since you last looked, the panel loads it instead of opening the creation dialog.

In a newly opened agent tab, Load brief becomes available only after Orca identifies the session. Loading and reloading stay disabled until the current read finishes. If a different session takes over the same terminal pane, an old click cannot load its history.

These buttons display existing material, including on a paired server. To ask a model for a new recap, use the preview and start buttons below. Turn off **Load briefs only on click** to resume automatic updates.

## Keep a running handoff in the same session

Use a checkpoint when one task spans many turns. Instead of asking another agent to reread a chat excerpt, ask the agent already doing the work to leave a handoff at a milestone.

1. Choose **Save a summary…** below the reply, or **Revise saved summary…** below an existing summary. Choose **Copy request** and paste it into your next regular message in the **original** conversation. The request includes the previous facts, next revision and your format preference, not the whole transcript. Copying sends nothing; the turn you send uses your agent’s normal tokens.
2. Once the agent finishes, choose **Save summary** in the same dialog before its next reply. Threadbrief verifies the host and session and checks the end of the latest finished reply. Only the marked summary is saved on this desktop. The panel shows **Saved summary · revision N**.
3. At each milestone, repeat with the latest instructions. The new report replaces the previous one, carrying forward decisions and evidence that still apply. Nothing runs between saves. If you started late or cleared the chat, state what is unknown rather than claiming full coverage.

If history is off or a paired server is disconnected, you can still read a saved summary. To revise it, enable history for that session and wait for a finished turn on the connected host.

For agents: finish the reply with this fenced JSON block. Use the conversation’s language, one line of text per field (up to 480 characters). Start at revision 1 and increase it on each update. Use “None” for an empty field; do not invent missing history.

````text
```threadbrief-checkpoint
{"revision":1,"goal":"Seat six guests.","done":"Reserved room A.","decisions":"Choose room A for its step-free entrance.","checks":"The venue confirmed eight seats.","open":"Final guest count.","next":"Send invitations."}
```
````

Only the latest saved version is kept per server and session, on the desktop showing the panel. A duplicate changes nothing. An older, conflicting or malformed checkpoint cannot replace it. A report written with the CLI takes precedence and cannot be replaced from the panel. If you start midway through a long session, earlier facts the agent no longer sees cannot be recovered from this feature. With paired history off or the server disconnected, Threadbrief cannot capture a new checkpoint.

## Choose a strategy and an agent

| Settings → Recap strategy | What it does | Extra model usage |
| --- | --- | --- |
| **Brief recap** (default) | Choose up to 3,000 characters from the last 12 entries; asks for up to 90 words. | One new agent session per confirmed request |
| **Instant** | Reads existing text. Use it to pick up where you left off. | None |
| **Detailed handoff** | Choose up to 12,000 characters from the last 48 entries; asks for up to 400 words. | One new session with a larger budget |

In **Settings → Recap strategy and model**, choose the agent. After the source turn finishes, click **Choose messages…**. Nothing is preselected. If the saved checkpoint is still visible, only later messages are offered. Otherwise there may be a gap: hand-pick the changes you recognize. Orca does not provide a reliable cursor through the entire session. With no eligible messages, there is nothing to send.

Choose **Preview recap request** to see the destination, previous compact facts, formatting instructions and exact selected text. Tool calls are excluded, but ordinary messages can contain private data. Only **Start recap in new session** sends this request. To keep its answer, copy the JSON, return to the **original** session, and open **Save a summary…** (or **Revise saved summary…**). Choose **Use a model-written draft**. A draft for a different session or an obsolete revision is refused. A manually written CLI report stays under its writer’s control.

**Choose a model:** keep **Use agent’s default** or pick a named model under **Reported by**. If the list is empty, [ask the agent to register its models](configuration.md#let-an-agent-fill-the-model-picker). **Add a model…** still lets you pin an exact identifier yourself. Check the model and host in the preview. To unpin, choose **Use agent’s default**. In Orca’s plugin settings the same selection is **Preferred recap agent** and **Custom recap model (optional)**. Threadbrief does not retry a rejected launch with a different model.

**Reasoning effort** appears below Model when the selected agent reports levels for that model on this host. Keep **Agent default** to leave the level up to the agent. A higher level may use more time and tokens; it does not increase the history window or word budget. The preview shows the exact effort requested. If a host stops offering it, choose another level before starting.

With the field empty the recap uses the agent’s default model, not necessarily the one in the original tab. It uses the agent’s configured account and permissions either way. The prompt asks for a text-only answer; the plugin does not sandbox the agent. Character and word budgets are not token or price guarantees. Previewing and refreshing never launch a model. If history is disabled or the selection is excluded, no recap can start.

## Choose what goes into the recap

To choose a lasting layout, open **Settings → Report format** and describe the result in your own words: for example, “Start with a one-line conclusion in French, then a table of options and risks.” Save by leaving the field. Your next checkpoint or separate recap request includes the preference. The panel renders the returned Markdown, with **Facts for the next update** collapsed underneath. Clear the preference to return to the standard layout on the next report. Editing it does not rewrite existing reports or start an agent.

For a one-off request in the original conversation, you can also copy this plain prompt from the gear under **How to get your first summary**. It changes the agent’s reply, not the saved report:

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
| **Saved summary · revision N** | A checkpoint or explicitly imported draft saved for this session. A new reply does not overwrite it. |
| **Last agent reply** / **Earlier replies** | Quotes from this session, shown when no saved report exists. If the transcript has no usable text, Threadbrief can show the last reply Orca reports for the same finished session. |
| **Shared with this worktree** | A saved report for the checkout. It can include other sessions' work; it isn't attributed to the selected agent. |

Turning off **Read recent agent replies** disables history, including manual recap previews. It doesn't delete anything. No history is sent to an agent unless you confirm the preview.

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
4. Select that session. Under **Saved for this session** check **Goal**, **Result**, **Confirmation** and **Next**. With no recorded checks, Confirmation says **Not recorded**.

## If you don't see the result you expected

| What you see | What to try |
| --- | --- |
| The panel asks you to select an agent tab | Select the conversation itself, not a file, empty shell, or browser tab. In a split terminal, select the pane with the agent. |
| **Loading summary…** | The panel is fetching its first brief. After that, switching sessions keeps the previous brief visible until the next one is ready, with no loading animation. |
| **Agent working** | You can keep reading this session’s last completed reply or saved report. The unfinished turn is not a summary. If there is no previous result, the panel waits for the first one. |
| **Show update** | The session changed while you were reading. Choose **Show update** in the top bar when you’re ready. Switching sessions follows the new selection; turning off history or excluding it clears the old view immediately. |
| You prefer a live view even while reading | Turn off **Pause updates while reading** under **Sources and reading** or in Orca’s plugin settings. Any pending result appears immediately; future updates no longer wait for a click. This does not start a model. |
| The agent finished, but there is no history reply | Check **Read recent agent replies**, then choose **Reload view**. If Orca has no readable history for this session, use a saved report. |
| A paired session has no reply | Check the paired connection, both history preferences and whether the agent finished. If the server does not expose that transcript, use a saved report. |
| The panel shows a shared report or an older saved report | Check the source label above. A shared report belongs to the checkout. To change a saved session report, write it again for the same session ID. |

## Turn off summaries for selected work

Open the gear and expand **Excluded summaries**. Choose **Exclude** beside the current session, workspace or project. A workspace rule covers its sessions; a project rule also covers future workspaces in that project. If more than one rule matches, any one of them keeps summaries off. Under **Saved exclusions**, choose **Remove** to undo a rule, even if the original session is closed.

Threadbrief keeps these rules locally by ID, not by name. It still needs Orca's selection metadata to check a rule, but it skips history, saved reports, workflow actions and automatic panel opening for an excluded selection. It does not stop agents, disable Orca's own history or delete saved reports. If it cannot verify a relevant exclusion, it withholds the summary.

## What about Orca Bots?

Threadbrief follows the selected Orca agent session, not a bot account, connector or inbox. If a bot run is available as a regular selected agent session with a confirmed ID, the same source order and exclusions apply. A bot conversation with no such session is not a source of session history. The plugin does not search background bot runs, read Slack threads or post replies on the bot's behalf.

## Do I need a workflow profile?

No. Profiles add project-specific command buttons; they do not generate or format summaries. Leave **Workflow profiles** closed unless you want them. If you enable profile commands, **Show first** only chooses which button appears first: **Copy command** or **Open terminal**. Both stay available for a matching command. Neither executes it. See [private workflows](../README.md#private-workflows) to set one up.
