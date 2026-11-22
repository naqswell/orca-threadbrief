import { directory, legacyDirectory, maxBytes, readSnapshot, saveSession, sessionFilename, summary } from './store.mjs'

const marker = '```threadbrief-checkpoint'
function latestCheckpoint(history, { id, lastAssistantMessage }) {
  if (history?.orcaSessionId !== id || (history.state !== undefined && history.state !== 'done') || !Array.isArray(history.entries)) throw Error('No finished history for this session. Nothing was saved.')
  for (let i = history.entries.length - 1; i >= 0; i--) {
    const entry = history.entries[i]
    if (entry?.role === 'user' && entry.kind === 'message') break
    if (entry?.role !== 'assistant' || entry.kind !== 'message' || entry.tools?.length || typeof entry.text !== 'string') continue
    const lines = entry.text.trimEnd().split(/\r?\n/u), start = lines.lastIndexOf(marker)
    if (!entry.text.trim()) continue
    if (start < 0) break
    if (!history.state && entry.text.trim() !== lastAssistantMessage?.trim()) throw Error('Orca could not confirm this checkpoint as the agent’s last finished reply.')
    try {
      const block = lines.slice(start + 1, -1).join('\n')
      if (lines.at(-1) !== '```' || Buffer.byteLength(block) > maxBytes) throw Error()
      const { revision, goal, done, next, decisions, checks, open, ...other } = JSON.parse(block)
      if (Object.keys(other).length || [goal, done, next, decisions, checks, open].some(v => typeof v !== 'string' || /^(?:…|\.\.\.)$/u.test(v.trim()))) throw Error()
      return summary({ goal, done, next, checkpoint: { revision, decisions, checks, open } })
    } catch { throw Error('The latest checkpoint is incomplete or invalid. Ask the same agent to correct it; your saved handoff was not changed.') }
  }
  throw Error('No checkpoint in the latest reply. Copy the instructions into the original conversation and save after the agent finishes.')
}

export function bindCheckpoints(orca, { source, command, root = directory, legacyRoot = legacyDirectory }) {
  orca.panels.handle('checkpoint.target', async () => {
    const { key, title, id, environment } = await source()
    return { key, title: title || id, environment }
  })
  orca.panels.handle('checkpoint.capture', async ({ key } = {}, { signal } = {}) => {
    const verify = async () => {
      const active = await source()
      signal?.throwIfAborted()
      if (!key || active.key !== key) throw Error('The session or turn changed. Open Save progress again for the session you want.')
      return active
    }
    const { id, environment } = await verify()
    const history = await command(['agent', 'read', `orca_session_id:${id}`, '--environment', environment, '--limit', '100'])
    const confirmed = await verify()
    const record = latestCheckpoint(history, confirmed), revision = record.checkpoint.revision
    await saveSession(root, environment, id, record, async () => {
      const parts = ['sessions', environment], name = sessionFilename(id)
      const previous = await readSnapshot(root, parts, name) ?? await readSnapshot(legacyRoot, parts, name)
      if (previous && !previous.checkpoint) throw Error('This session already has a manually saved report. It was not replaced.')
      if (previous && previous.checkpoint.revision >= revision && JSON.stringify(previous) !== JSON.stringify(record)) throw Error(`Checkpoint ${previous.checkpoint.revision} is already saved. Ask for a higher revision with the latest state.`)
      await verify()
      return !previous || previous.checkpoint.revision < revision
    })
    return { revision }
  })
}
