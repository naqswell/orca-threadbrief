import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { directory, legacyDirectory, filename, sessionFilename, readSnapshot } from './store.mjs'
import { focusedSession, orcaJson, readFocus, safeEnvironment } from './session-context.mjs'

const identity = id => typeof id === 'string' && id.startsWith('identity:wt2:')
const focusKey = value => value && JSON.stringify([value.workspace, value.host, value.tab, value.leaf, value.kind, value.entity, value.sessionId])
const acknowledgement = /^(?:(?:ok(?:ay)?|done|thanks|thank you|got it|yes|no|да|нет|ок|окей|понял[аи]?|готово|сделано|спасибо)[\s\p{P}]*)+$/iu
export function lastOutcome(history, id) {
  if (history?.orcaSessionId !== id || history.state === 'working' || !Array.isArray(history.entries)) return null
  for (let i = history.entries.length - 1; i >= 0; i--) {
    const entry = history.entries[i]
    if (entry.role !== 'assistant' || entry.kind !== 'message' || entry.tools?.length) continue
    const reply = typeof entry.text === 'string' ? entry.text.trim() : ''
    if (reply && (reply.length > 96 || !acknowledgement.test(reply))) return reply.length > 1600 ? reply.slice(0, 1600).trimEnd() + '…' : reply
  }
  return null
}
async function pairedAddress(id, command, environment) {
  if (typeof id !== 'string' || !/^[^:/]+::[^\0]+$/u.test(id)) return null
  const environments = environment ? [{ id: environment }] : (await command(['environment', 'list']))?.environments
  if (!Array.isArray(environments)) return null
  const targets = await Promise.all(environments.map(async item => {
    if (!safeEnvironment(item.id)) return null
    const found = await command(['worktree', 'show', '--environment', item.id, '--worktree', `id:${id}`]).catch(() => null)
    const worktree = found?.worktree
    return worktree?.id === id && worktree.address?.environment === item.id && identity(worktree.address.worktree) ? worktree.address : null
  }))
  const matches = targets.filter(Boolean)
  return matches.length === 1 ? matches[0] : null
}
export function bindSources(orca, { settings, reveal, roots = [directory, legacyDirectory], command = orcaJson, focus = readFocus, interval = 1000 }) {
  const listeners = new Set(), created = new Map()
  let selection, timer, stopped = false, checking = false, generation = 0
  const context = () => orca.host.call('workspace.readContext')
  const getFocus = () => focus().catch(() => null)
  const post = reason => { if (listeners.size && !stopped) orca.panels.post('summary.changed', { reason }) }
  const invalidate = reason => { generation++; selection = null; post(reason) }
  async function find(parts, name, current) {
    for (const root of roots) {
      current.files.add(join(root, ...parts, name))
      const value = await readSnapshot(root, parts, name).catch(() => null)
      if (value) return { value, root, parts, name }
    }
    return null
  }
  async function fingerprint(files) {
    return Promise.all([...files].sort().map(async path => {
      const s = await stat(path).catch(() => null)
      return s ? `${path}:${s.dev}:${s.ino}:${s.size}:${s.mtimeMs}:${s.ctimeMs}` : `${path}:missing`
    })).then(values => values.join('|'))
  }
  async function tick() {
    if (checking || stopped || !listeners.size) return
    checking = true
    try {
      const current = selection
      if (!current) return
      const [selected, files] = await Promise.all([getFocus(), fingerprint(current.files)])
      if (selection !== current) return
      if (focusKey(selected) !== current.key) invalidate('selection')
      else if (files !== current.fingerprint) invalidate('file')
    } finally { checking = false }
  }
  function listen(panel) {
    listeners.add(panel?.id ?? 'summary')
    if (!timer) { timer = setInterval(() => { void tick() }, interval); timer.unref?.() }
  }
  async function readFocused({ listen: subscribe } = {}, { panel } = {}, includePublication = false) {
    if (subscribe) listen(panel)
    const start = generation
    const active = await context()
    const workspaceId = active?.workspaceId
    if (!workspaceId) return { scope: 'none', summary: null }
    const selected = await getFocus(), key = focusKey(selected)
    const current = { key, files: new Set(), workspaceId, selected, source: null, agent: null }
    const session = await focusedSession(workspaceId, selected, command).catch(() => null)
    current.agent = session
    let view = session ? { scope: 'session', title: session.title, summary: null } : { scope: 'none', summary: null }
    if (session) {
      const saved = await find(['sessions', session.environment], sessionFilename(session.id), current)
      if (saved) { current.source = saved; view.summary = saved.value }
      else if ((await settings()).historyOutcome !== false && session.environment === 'local' && session.state === 'done') {
        const history = await command(['agent', 'read', `orca_session_id:${session.id}`, '--environment', 'local', '--limit', '20']).catch(() => null)
        const outcome = lastOutcome(history, session.id)
        if (outcome) view.outcome = outcome
      }
    }
    if (!view.summary && !view.outcome && !workspaceId.startsWith('folder:')) {
      let address = null
      if (identity(workspaceId)) address = { environment: 'local', worktree: workspaceId }
      else if (!selected || (selected.workspace === workspaceId && selected.host?.startsWith('runtime:'))) {
        address = await pairedAddress(workspaceId, command, selected?.host?.startsWith('runtime:') ? selected.host.slice(8) : undefined).catch(() => null)
      }
      if (address) {
        const parts = address.environment === 'local' ? [] : ['paired', address.environment]
        const saved = await find(parts, filename(address.worktree), current)
        if (saved) { current.source = saved; view = { scope: 'worktree', title: active.displayName, summary: saved.value } }
      }
    }
    if (includePublication && current.source && view.scope === 'worktree') {
      const { root, parts, name } = current.source
      const privateData = await readSnapshot(root, parts, name, undefined, true).catch(() => null)
      if (privateData && JSON.stringify(privateData.meta) === JSON.stringify(view.summary) && privateData.legacyPublication) view.legacyPublication = privateData.legacyPublication
    }
    current.fingerprint = await fingerprint(current.files)
    const [after, selectedAfter] = await Promise.all([context(), getFocus()])
    if (after?.workspaceId !== workspaceId || focusKey(selectedAfter) !== key || generation !== start) throw Error('The active selection changed.')
    if (view.scope !== 'none') view.workspaceId = workspaceId
    selection = current
    return view
  }
  const focused = (input, ctx) => readFocused(input, ctx)
  const workflowFocused = () => readFocused({}, {}, true)
  async function frame({ id, hash } = {}) {
    const current = selection
    if (!current?.source || (id != null && id !== current.workspaceId) || typeof hash !== 'string' || !/^[0-9a-f]{64}$/u.test(hash)) throw Error('Image is unavailable.')
    const [active, selected] = await Promise.all([context(), getFocus()])
    if (selection !== current || active?.workspaceId !== current.workspaceId || focusKey(selected) !== current.key) throw Error('The active selection changed.')
    const { root, parts, name } = current.source
    const data = await readSnapshot(root, parts, name, hash)
    const [after, selectedAfter] = await Promise.all([context(), getFocus()])
    if (selection !== current || after?.workspaceId !== current.workspaceId || focusKey(selectedAfter) !== current.key) throw Error('The active selection changed.')
    return data
  }
  function close(_input, { panel } = {}) {
    listeners.delete(panel?.id ?? 'summary')
    if (!listeners.size) { clearInterval(timer); timer = null; selection = null; generation++ }
    return null
  }
  function stop() { stopped = true; clearInterval(timer); timer = null; listeners.clear(); selection = null; generation++ }
  async function maybeReveal(id) {
    const now = Date.now()
    for (const [raw, item] of created) {
      if (item.expires <= now) { created.delete(raw); continue }
      if (id !== raw && id !== item.workspaceListId) continue
      created.delete(raw)
      if ((await settings()).autoOpen !== true) return
      try { const view = await focused(); if (view.summary && (await context())?.workspaceId === id) await reveal() } catch { /* selection changed */ }
      return
    }
  }
  orca.events.on('workspace.created', async ({ kind, workspaceId, workspaceListId }) => {
    if (kind !== 'worktree' || !workspaceId) return
    created.set(workspaceId, { workspaceListId, expires: Date.now() + 15000 })
    await maybeReveal((await context())?.workspaceId)
  })
  orca.events.on('workspace.changed', ({ context: next } = {}) => { invalidate('workspace'); void maybeReveal(next?.workspaceId) })
  orca.events.on('agent.status.changed', event => {
    const current = selection
    if (!current || (event.workspaceId && event.workspaceId !== current.workspaceId && event.workspaceId !== current.selected?.workspace && event.workspaceListId !== current.workspaceId)) return
    const pane = current.agent?.paneKey ?? (current.selected?.tab && current.selected?.leaf ? `${current.selected.tab.replace(/^web-terminal-/u, '')}:${current.selected.leaf}` : null)
    if (pane && pane === event.paneKey) invalidate('session')
  })
  return { focused, workflowFocused, close, frame, stop }
}
