import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { directory, legacyDirectory, filename, sessionFilename, readSnapshot } from './store.mjs'
import { focusedSession, orcaJson, readFocus, safeEnvironment, sessionId } from './session-context.mjs'
import { createExclusions } from './exclusions.mjs'

const identity = id => typeof id === 'string' && id.startsWith('identity:wt2:')
const focusKey = value => value && JSON.stringify([value.workspace, value.host, value.tab, value.leaf, value.kind, value.entity, value.sessionId])
const acknowledgement = /^(?:(?:ok(?:ay)?|done|thanks|thank you|got it|yes|no|да|нет|ок|окей|понял[аи]?|готово|сделано|спасибо)[\s\p{P}]*)+$/iu
const historyBlock = (session, prefs) => prefs.historyOutcome === false ? 'historyOff' : session?.environment !== 'local' && prefs.pairedHistory === false ? 'pairedOff' : undefined
function substantiveReply(text) {
  const reply = typeof text === 'string' ? text.trim() : ''
  if (!reply || (reply.length <= 96 && acknowledgement.test(reply))) return null
  return reply.length > 1600 ? reply.slice(0, 1600).trimEnd() + '…' : reply
}
function transcriptBrief(history, id, working) {
  if (history?.orcaSessionId !== id || !Array.isArray(history.entries) || (!working && history.state === 'working')) return null
  const entries = history.entries
  const end = working ? entries.findLastIndex(e => e.role === 'user' && e.kind === 'message') : entries.length
  let brief = null
  for (let i = end - 1; i >= 0; i--) {
    const entry = entries[i]
    if (entry.role !== 'assistant' || entry.kind !== 'message' || entry.tools?.length) continue
    const reply = substantiveReply(entry.text)
    if (!reply) continue
    if (!brief) brief = { outcome: reply, earlierReplies: [] }
    else if (reply !== brief.outcome && !brief.earlierReplies.includes(reply)) {
      brief.earlierReplies.push(reply)
      if (brief.earlierReplies.length === 2) break
    }
  }
  return brief
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
  const completed = new Map(), manualBriefs = new Map()
  let selection, observedPane, timer, stopped = false, checking = false, generation = 0
  const context = () => orca.host.call('workspace.readContext')
  const getFocus = () => focus().catch(() => null)
  const post = reason => { if (listeners.size && !stopped) orca.panels.post('summary.changed', { reason }) }
  const invalidate = reason => {
    if (reason === 'history-setting' || reason === 'exclusions') { completed.clear(); manualBriefs.clear() }
    generation++; selection = null; post(reason)
  }
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
  const exclusions = createExclusions(orca, metadata, () => invalidate('exclusions'))
  const selector = id => /^(?:folder:|identity:wt2:)/u.test(id) ? id : `id:${id}`
  async function recapTarget() {
    const selected = await getFocus()
    if (!selected?.workspace || !selected.host) throw Error('Select a workspace in Orca to list its agents.')
    const environment = selected.host === 'local' ? 'local' : selected.host.startsWith('runtime:') ? selected.host.slice(8) : null
    if (!safeEnvironment(environment) || (environment === 'local' && selected.host !== 'local')) throw Error('Could not identify the selected Orca server.')
    return { environment, worktree: selector(selected.workspace) }
  }
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
    if (excluded || historyBlock(session, prefs)) throw Error('History is off for this selection.')
    const live = session?.environment && session.environment !== 'local' ? await remoteState(session, active.workspaceId) : session
    if (!session || !live || live.state !== 'done' || (session.environment === 'local' && selected.host && selected.host !== 'local')) throw Error('Select a finished agent on a connected Orca host.')
    await verifySelection(start, active.workspaceId, focusKey(selected))
    return { id: session.id, environment: session.environment, worktree: selector(active.workspaceId), workspaceId: active.workspaceId, title: session.title, lastAssistantMessage: live.lastAssistantMessage, key: JSON.stringify([active.workspaceId, focusKey(selected), session.id, live.updatedAt]) }
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
      const [selected, files] = await Promise.all([getFocus(), current.manual ? undefined : fingerprint(current.files)])
      if (selection !== current) return
      if (focusKey(selected) !== current.key) invalidate('selection')
      else if (current.manual) return
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
  async function readFocused({ listen: subscribe, loadFor } = {}, { panel } = {}, includePublication = false, revalidate = false) {
    if (subscribe) listen(panel)
    const start = generation
    const [active, prefs] = await Promise.all([context(), settings()])
    const manual = prefs.manualLoad === true
    if (manual && includePublication && !loadFor && !manualBriefs.size) return { scope: 'manual' }
    const workspaceId = active?.workspaceId
    observedWorkspace = workspaceId
    if (!workspaceId) return { scope: 'none', summary: null, manual }
    const selected = await getFocus(), key = focusKey(selected)
    const current = { start, key, files: new Set(), workspaceId, selected, source: null, agent: null, manual }
    const loadKey = manual && selected ? JSON.stringify([workspaceId, key]) : undefined
    const welcome = () => {
      if (!includePublication) selection = current
      return { scope: 'manual', manual, contextKey: loadKey }
    }
    if (manual) {
      checkGeneration(start)
      if (loadFor && loadFor !== loadKey) throw Error('The active selection changed. Load the brief again.')
      if (!loadFor && (!manualBriefs.size || !loadKey)) return welcome()
    }
    const { session, excluded } = await exclusions.check({ active, selected }, () => resolve(active, selected))
    current.agent = session
    const contextKey = JSON.stringify([workspaceId, session?.environment ?? selected?.host, session?.id ?? key])
    const slot = includePublication ? 'workflow' : 'panel'
    if (manual && !loadFor) {
      await verifySelection(start, workspaceId, key)
      const saved = !excluded && manualBriefs.get(contextKey)
      if (!saved?.[slot]) return welcome()
      if (!includePublication) {
        current.source = saved.source
        observedPane = selection = current
        return { ...saved.panel, contextKey: loadKey }
      }
      if (!revalidate) return saved.workflow
    }
    const blocked = historyBlock(session, prefs)
    let live = session
    let brief
    let view = session ? { scope: 'session', title: session.title, summary: null } : { scope: 'none', summary: null }
    checkGeneration(start)
    if (!includePublication) observedPane = current
    if (excluded) view = { scope: 'excluded', excluded, summary: null }
    else if (session) {
      const saved = await find(['sessions', session.environment], sessionFilename(session.id), current)
      if (saved) {
        current.source = saved; view.summary = saved.value
        if (session.environment !== 'local') {
          live = await remoteState(session, workspaceId)
          Object.assign(current, { monitor: true, nextCheck: Date.now() + 4000, liveState: live?.state, updatedAt: live?.updatedAt })
        }
      } else {
        checkGeneration(start)
        const paired = session.environment !== 'local'
        if (blocked) view.emptyReason = blocked
        else {
          if (paired) live = await remoteState(session, workspaceId)
          const working = live?.state === 'working'
          if (paired) Object.assign(current, { monitor: true, nextCheck: Date.now() + 4000, liveState: live?.state, updatedAt: live?.updatedAt })
          if (!live) view.emptyReason = 'unavailable'
          else if (working || live.state === 'done') {
            checkGeneration(start)
            const history = await command(['agent', 'read', `orca_session_id:${session.id}`, '--environment', session.environment, '--limit', '48']).catch(() => null)
            brief = transcriptBrief(history, session.id, working)
            if (!brief && working) brief = completed.get(contextKey)
            if (!brief && !working && (!history || (history.orcaSessionId === session.id && history.state !== 'working'))) {
              const outcome = substantiveReply(live.lastAssistantMessage)
              if (outcome) brief = { outcome, earlierReplies: [] }
            }
            if (brief) Object.assign(view, brief)
            else view.emptyReason = working ? 'waiting' : !history ? 'unavailable' : 'noReply'
          } else view.emptyReason = 'noReply'
        }
      }
    }
    if (!excluded && !view.summary && !view.outcome && !workspaceId.startsWith('folder:')) {
      let address = null
      const paired = selected?.host?.startsWith('runtime:')
      if (identity(workspaceId) && selected && (!selected.host || selected.host === 'local')) address = { environment: 'local', worktree: workspaceId }
      else if (paired && selected.host !== 'runtime:local' && selected.workspace === workspaceId && safeEnvironment(selected.host.slice(8))) {
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
    if (brief && completed.get(contextKey) !== brief) {
      completed.delete(contextKey)
      completed.set(contextKey, brief)
      if (completed.size > 12) completed.delete(completed.keys().next().value)
    }
    if (!includePublication) {
      view.contextKey = manual ? loadKey : contextKey
      view.working = view.scope !== 'excluded' && live?.state === 'working'
      view.manual = manual
      if (view.scope === 'session' && !blocked && (view.working || live?.state === 'done')) view.reportSessionKey = contextKey
    }
    if (view.scope !== 'none') view.workspaceId = workspaceId
    if (manual && loadFor && !excluded && (view.summary || view.outcome)) {
      const saved = manualBriefs.get(contextKey) ?? {}
      saved[slot] = view
      if (!includePublication) saved.source = current.source
      manualBriefs.delete(contextKey)
      manualBriefs.set(contextKey, saved)
      if (manualBriefs.size > 12) manualBriefs.delete(manualBriefs.keys().next().value)
    }
    if (!includePublication) selection = current
    return view
  }
  const focused = (input, ctx) => readFocused(input, ctx)
  const workflowFocused = (input, revalidate = false) => readFocused(input, {}, true, revalidate)
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
      const prefs = await settings()
      if (prefs.manualLoad || prefs.autoOpen !== true) return
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
    if (current?.manual) return
    if (!current || (event.workspaceId && event.workspaceId !== current.workspaceId && event.workspaceId !== current.selected?.workspace && event.workspaceListId !== current.workspaceId)) return
    const pane = current.agent?.paneKey ?? (current.selected?.tab && current.selected?.leaf ? `${current.selected.tab.replace(/^web-terminal-/u, '')}:${current.selected.leaf}` : null)
    if (pane && pane === event.paneKey) invalidate('session')
  })
  function historyChanged() { invalidate('history-setting') }
  return { focused, workflowFocused, recapTarget, recapSource, close, frame, stop, exclusions, historyChanged }
}
