# Your first session summary

If you want to know where you left off, you only need the plugin and a local agent session. Leave the settings at their defaults. You do not need a workflow profile, an API key, a Git repository, or a script.

## Try it on one task

1. [Install the plugin](../README.md#install). Open a local agent conversation in Orca, or select one where the agent has already finished a task.
2. For a quick trial, ask: **“I have six guests and eight chairs. How many chairs will be spare? Answer in one sentence.”** Wait for the answer. Leave the conversation tab selected; you don't have to close it.
3. Open **Threadbrief** in the right sidebar. Under **From session history**, you should see the agent's answer about the two spare chairs. Switch to a different conversation and the panel follows that selection.

The panel displays a reply the agent already wrote, in its original language. It doesn't call a second model to summarize the conversation. It looks through the last 20 history entries for the latest assistant message with text, skips tool calls and short acknowledgements, and shows up to 1,600 characters before an ellipsis.

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
| **From session history** | The selected local agent's last substantive reply after the session finishes. On by default. |
| **Shared with this worktree** | A saved report for the checkout. It can include other sessions' work; it isn't attributed to the selected agent. |

Turning off **Use the agent’s last reply** disables the middle source only. It doesn't delete anything. The plugin doesn't send your history to a summarization service.

## Save a report that won't change with the next reply

Skip this if history is enough. Use a saved report for a stable handoff, or when the session runs in a paired environment where the plugin doesn't read history.

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
| The panel asks you to select a local agent tab | Select the conversation itself, not a file, empty shell, or browser tab. In a split terminal, select the pane with the agent. |
| The agent is still working | Wait for its turn to finish. A progress message isn't a final reply. |
| The agent finished, but there is no history reply | Check **Use the agent’s last reply**. Ask for a short recap in the same tab. If Orca has no readable history for this session, use a saved report. |
| A paired session has no reply | This is expected. Use a saved session report or a shared worktree report. |
| The panel shows a shared report or an older saved report | Check the source label above. A shared report belongs to the checkout. To change a saved session report, write it again for the same session ID. |

## Do I need a workflow profile?

No. Profiles add project-specific command buttons; they do not generate or format summaries. Leave **Workflow profiles** closed unless you want them. If you enable profile commands, **Show first** only chooses which button appears first: **Copy command** or **Open terminal**. Both stay available for a matching command. Neither executes it. See [private workflows](../README.md#private-workflows) to set one up.
