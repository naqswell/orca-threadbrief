import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { directory, legacyDirectory, filename, sessionFilename, readSnapshot } from './store.mjs'
import { focusedSession, orcaJson, readFocus, safeEnvironment, sessionId } from './session-context.mjs'
import { createExclusions } from './exclusions.mjs'

const identity = id => typeof id === 'string' && id.startsWith('identity:wt2:')
const focusKey = value => value && JSON.stringify([value.workspace, value.host, value.tab, value.leaf, value.kind, value.entity, value.sessionId])
const acknowledgement = /^(?:(?:ok(?:ay)?|done|thanks|thank you|got it|yes|no|да|нет|ок|окей|понял[аи]?|готово|сделано|спасибо)[\s\p{P}]*)+$/iu
export function lastOutcome(history, id) {
  if (history?.orcaSessionId !== id || history.state === 'working' || !Array.isArray(history.entries)) return null
  return outcomeBefore(history.entries, history.entries.length)
}
function outcomeBefore(entries, end) {
  for (let i = end - 1; i >= 0; i--) {
    const entry = entries[i]
    if (entry.role !== 'assistant' || entry.kind !== 'message' || entry.tools?.length) continue
    const reply = typeof entry.text === 'string' ? entry.text.trim() : ''
    if (reply && (reply.length > 96 || !acknowledgement.test(reply))) return reply.length > 1600 ? reply.slice(0, 1600).trimEnd() + '…' : reply
  }
  return null
}
function previousOutcome(history, id) {
  if (history?.orcaSessionId !== id || !Array.isArray(history.entries)) return null
  const turn = history.entries.findLastIndex(e => e.role === 'user' && e.kind === 'message')
  return outcomeBefore(history.entries, turn)
}
async function pairedAddress(id, command, environment) {
  if (typeof id !== 'string' || !/^[^:/]+::[^\0]+$/u.test(id)) return null
  if (!safeEnvironment(environment)) return null
  const found = await command(['worktree', 'show', '--environment', environment, '--worktree', `id:${id}`]).catch(() => null)
  const worktree = found?.worktree
  return worktree?.id === id && worktree.address?.environment === environment && identity(worktree.address.worktree) ? worktree.address : null
}
export function bindSources(orca, { settings, reveal, roots = [directory, legacyDirectory], command = orcaJson, focus = readFocus, interval = 1000 }) {
  const listeners = new Set(), created = new Map()
  const completed = new Map()
  let selection, observedPane, timer, stopped = false, checking = false, generation = 0
  const context = () => orca.host.call('workspace.readContext')
  const getFocus = () => focus().catch(() => null)
  const post = reason => { if (listeners.size && !stopped) orca.panels.post('summary.changed', { reason }) }
  const invalidate = reason => { generation++; selection = null; post(reason) }
  let observedWorkspace
  async function verifySelection(start, workspaceId, key) {
    const [after, selectedAfter] = await Promise.all([context(), getFocus()])
    checkGeneration(start)
    if (after?.workspaceId !== workspaceId || focusKey(selectedAfter) !== key) {
      invalidate('selection')
      throw Error('The active selection changed.')
    }
  }
  const resolve = (active, selected) => focusedSession(active?.workspaceId, selected, command).catch(() => null)
  async function metadata() {
    const [active, selected] = await Promise.all([context(), getFocus()])
    const session = await resolve(active, selected)
    return { active, selected, session }
  }
  const exclusions = createExclusions(orca, metadata, () => { completed.clear(); invalidate('exclusions') })
  const selector = id => /^(?:folder:|identity:wt2:)/u.test(id) ? id : `id:${id}`
  async function remoteState(session, workspaceId) {
    const list = await command(['agent', 'list', '--environment', session.environment, '--worktree', selector(workspaceId)]).catch(() => null)
    const matches = !list?.truncated && list?.agents?.filter(a => a.paneKey === session.paneKey && sessionId(a.orcaSessionId) === session.id)
    return matches?.length === 1 ? matches[0] : null
  }
  async function recapSource() {
    const start = generation
    const [active, selected] = await Promise.all([context(), getFocus()])
    const { session, excluded } = await exclusions.check({ active, selected }, () => resolve(active, selected))
    const prefs = await settings()
    if (excluded || prefs.historyOutcome === false || (session?.environment !== 'local' && prefs.pairedHistory === false)) throw Error('History is off for this selection.')
    const live = session?.environment && session.environment !== 'local' ? await remoteState(session, active.workspaceId) : session
    if (!session || !live || live.state !== 'done' || (session.environment === 'local' && selected.host && selected.host !== 'local')) throw Error('Select a finished agent on a connected Orca host.')
    await verifySelection(start, active.workspaceId, focusKey(selected))
    return { id: session.id, environment: session.environment, worktree: selector(active.workspaceId), workspaceId: active.workspaceId, title: session.title, key: JSON.stringify([active.workspaceId, focusKey(selected), session.id, live.updatedAt]) }
  }
  function checkGeneration(start) {
    if (start !== generation) throw Error('The active selection changed.')
  }
  async function find(parts, name, current) {
    for (const root of roots) {
      checkGeneration(current.start)
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
      else if (current.monitor && Date.now() >= current.nextCheck) {
        current.nextCheck = Date.now() + 4000
        const live = await remoteState(current.agent, current.workspaceId)
        if (selection === current && (current.liveState !== live?.state || current.updatedAt !== live?.updatedAt)) invalidate('session')
      }
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
    observedWorkspace = workspaceId
    if (!workspaceId) return { scope: 'none', summary: null }
    const selected = await getFocus(), key = focusKey(selected)
    const current = { start, key, files: new Set(), workspaceId, selected, source: null, agent: null }
    const { session, excluded } = await exclusions.check({ active, selected }, () => resolve(active, selected))
    current.agent = session
    const contextKey = JSON.stringify([workspaceId, session?.environment ?? selected?.host, session?.id ?? key])
    let working = false
    let view = session ? { scope: 'session', title: session.title, summary: null } : { scope: 'none', summary: null }
    checkGeneration(start)
    if (!includePublication) observedPane = current
    if (excluded) view = { scope: 'excluded', excluded, summary: null }
    else if (session) {
      working = session.state === 'working'
      const saved = await find(['sessions', session.environment], sessionFilename(session.id), current)
      if (saved) {
        current.source = saved; view.summary = saved.value
        if (session.environment !== 'local') {
          const live = await remoteState(session, workspaceId)
          working = live?.state === 'working'
          Object.assign(current, { monitor: true, nextCheck: Date.now() + 4000, liveState: live?.state, updatedAt: live?.updatedAt })
        }
      } else {
        const prefs = await settings()
        const paired = session.environment !== 'local'
        if (prefs.historyOutcome === false) view.emptyReason = 'historyOff'
        else if (paired && prefs.pairedHistory === false) view.emptyReason = 'pairedOff'
        else {
          const live = paired ? await remoteState(session, workspaceId) : session
          working = live?.state === 'working'
          if (paired) Object.assign(current, { monitor: true, nextCheck: Date.now() + 4000, liveState: live?.state, updatedAt: live?.updatedAt })
          if (!live) view.emptyReason = 'unavailable'
          else if (working || live.state === 'done') {
            checkGeneration(start)
            const history = await command(['agent', 'read', `orca_session_id:${session.id}`, '--environment', session.environment, '--limit', '20']).catch(() => null)
            const outcome = working ? previousOutcome(history, session.id) ?? completed.get(contextKey) : lastOutcome(history, session.id)
            if (outcome) view.outcome = outcome
            else view.emptyReason = working ? 'waiting' : paired && !history ? 'unavailable' : 'noReply'
          } else view.emptyReason = 'noReply'
        }
      }
    }
    if (!excluded && !view.summary && !view.outcome && !workspaceId.startsWith('folder:')) {
      let address = null
      const paired = selected?.host?.startsWith('runtime:')
      if (identity(workspaceId) && selected && (!selected.host || selected.host === 'local')) address = { environment: 'local', worktree: workspaceId }
      else if (paired && selected.workspace === workspaceId && safeEnvironment(selected.host.slice(8))) {
        const environment = selected.host.slice(8)
        address = identity(workspaceId) ? { environment, worktree: workspaceId } : await pairedAddress(workspaceId, command, environment).catch(() => null)
      }
      if (address) {
        const parts = address.environment === 'local' ? [] : ['paired', address.environment]
        const saved = await find(parts, filename(address.worktree), current)
        if (saved) { current.source = saved; view = { scope: 'worktree', title: active.displayName, summary: saved.value } }
      }
    }
    if (includePublication && current.source && view.scope === 'worktree') {
      const { root, parts, name } = current.source
      checkGeneration(start)
      const privateData = await readSnapshot(root, parts, name, undefined, true).catch(() => null)
      if (privateData && JSON.stringify(privateData.meta) === JSON.stringify(view.summary) && privateData.legacyPublication) view.legacyPublication = privateData.legacyPublication
    }
    current.fingerprint = await fingerprint(current.files)
    await verifySelection(start, workspaceId, key)
    if (view.outcome && completed.get(contextKey) !== view.outcome) {
      completed.delete(contextKey)
      completed.set(contextKey, view.outcome)
      if (completed.size > 12) completed.delete(completed.keys().next().value)
    }
    if (!includePublication) { view.contextKey = contextKey; view.working = working }
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
    if (!listeners.size) { clearInterval(timer); timer = null; observedPane = selection = null; generation++ }
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
      try {
        const start = generation
        const view = await focused()
        if (view.summary && (await context())?.workspaceId === id && generation === start) await reveal()
      } catch { /* selection changed or exclusions could not be verified */ }
      return
    }
  }
  orca.events.on('workspace.created', async ({ kind, workspaceId, workspaceListId }) => {
    if (kind !== 'worktree' || !workspaceId) return
    created.set(workspaceId, { workspaceListId, expires: Date.now() + 15000 })
    await maybeReveal((await context())?.workspaceId)
  })
  orca.events.on('workspace.changed', ({ context: next } = {}) => {
    if (observedWorkspace && observedWorkspace === next?.workspaceId) void tick()
    else { observedWorkspace = next?.workspaceId; invalidate('workspace') }
    void maybeReveal(next?.workspaceId)
  })
  orca.events.on('agent.status.changed', event => {
    const current = selection ?? observedPane
    if (!current || (event.workspaceId && event.workspaceId !== current.workspaceId && event.workspaceId !== current.selected?.workspace && event.workspaceListId !== current.workspaceId)) return
    const pane = current.agent?.paneKey ?? (current.selected?.tab && current.selected?.leaf ? `${current.selected.tab.replace(/^web-terminal-/u, '')}:${current.selected.leaf}` : null)
    if (pane && pane === event.paneKey) invalidate('session')
  })
  function historyChanged() { completed.clear(); invalidate('history-setting') }
  return { focused, workflowFocused, recapSource, close, frame, stop, exclusions, historyChanged }
}
