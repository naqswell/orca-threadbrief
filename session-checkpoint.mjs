import { createHash } from 'node:crypto'
import { directory, legacyDirectory, maxBytes, readSnapshot, saveSession, sessionFilename, summary } from './store.mjs'

const marker = '```threadbrief-checkpoint'
function parseFields({ revision, goal, done, next, decisions, checks, open, formatted, ...other }) {
  if (Object.keys(other).length || [goal, done, next, decisions, checks, open].some(v => typeof v !== 'string' || /^(?:…|\.\.\.)$/u.test(v.trim()))) throw Error('Incomplete report fields.')
  return summary({ goal, done, next, checkpoint: { revision, decisions, checks, open, formatted } })
}
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
      return parseFields(JSON.parse(block))
    } catch { throw Error('The latest checkpoint is incomplete or invalid. Ask the same agent to correct it; your saved handoff was not changed.') }
  }
  throw Error('No checkpoint in the latest reply. Copy the instructions into the original conversation and save after the agent finishes.')
}

export function bindCheckpoints(orca, { source, command, settings, root = directory, legacyRoot = legacyDirectory }) {
  async function base({ id, environment }) {
    const parts = ['sessions', environment], name = sessionFilename(id)
    const previous = await readSnapshot(root, parts, name) ?? await readSnapshot(legacyRoot, parts, name)
    const format = (await settings()).reportFormat?.trim() ?? ''
    const key = createHash('sha256').update(JSON.stringify([environment, id, previous, format])).digest('hex')
    const cp = previous?.checkpoint
    const fields = previous && { goal:previous.goal, done:previous.done, next:previous.next, ...(cp ? {revision:cp.revision, decisions:cp.decisions, checks:cp.checks, open:cp.open} : previous.result ? {checks:previous.result.checks} : {}) }
    return { key, fields, format, manual:Boolean(previous && !cp), revision:cp?.revision ?? 0 }
  }
  orca.panels.handle('checkpoint.target', async ({sessionKey, revision} = {}) => {
    const active = await source()
    if (sessionKey !== JSON.stringify([active.workspaceId, active.environment, active.id])) return {stale:'session'}
    const state = await base(active)
    if ((await source()).key !== active.key) throw Error('The session or turn changed.')
    if (state.manual || state.revision !== revision) return {stale:'report'}
    return { ...state, title: active.title || active.id, environment: active.environment }
  })
  async function save(active, expected, record, signal) {
    const { id, environment } = active, revision = record.checkpoint.revision
    await saveSession(root, environment, id, record, async () => {
      const current = await base(active)
      if (current.manual) throw Error('This session already has a manually saved report. It was not replaced.')
      if (current.format && !record.checkpoint.formatted) throw Error('Your requested Markdown report is missing. Ask the agent to include the formatted field.')
      const confirmed = await source()
      signal?.throwIfAborted()
      if (confirmed.key !== active.key) throw Error('The session or turn changed.')
      if (current.key !== expected || revision !== current.revision + 1) throw Error('The saved report changed or the revision is wrong. Reopen the report and use its current instructions.')
      return true
    })
    return { revision }
  }
  orca.panels.handle('checkpoint.capture', async ({ key } = {}, { signal } = {}) => {
    const active = await source(), { id, environment } = active
    const current = await base(active)
    if (current.manual) throw Error('This session already has a manually saved report.')
    if (key !== current.key) throw Error('The selected session or saved report changed. Reopen the report.')
    const history = await command(['agent', 'read', `orca_session_id:${id}`, '--environment', environment, '--limit', '100'])
    const confirmed = await source()
    if (confirmed.key !== active.key) throw Error('The session or turn changed.')
    const record = latestCheckpoint(history, confirmed)
    if (current.revision === record.checkpoint.revision) {
      const previous = await readSnapshot(root, ['sessions',environment], sessionFilename(id)) ?? await readSnapshot(legacyRoot, ['sessions',environment], sessionFilename(id))
      if (JSON.stringify(previous) === JSON.stringify(record)) return { revision:current.revision }
    }
    return save(active, key, record, signal)
  })
  orca.panels.handle('checkpoint.import', async ({ key, draft } = {}, { signal } = {}) => {
    if (typeof draft !== 'string' || Buffer.byteLength(draft) > maxBytes) throw Error('Paste the report JSON from the recap agent.')
    const content = draft.trim()
    const { reportKey, ...fields } = JSON.parse(content.match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/u)?.[1] ?? content)
    if (!key || reportKey !== key) throw Error('This draft belongs to another session or an older report.')
    return save(await source(), key, parseFields(fields), signal)
  })
  return base
}
