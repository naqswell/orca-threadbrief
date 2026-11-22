const storageKey = 'summary-exclusions-v1'
const kinds = ['project', 'workspace', 'session']
const identify = rule => JSON.stringify([rule.kind, rule.host, rule.id])
const rule = (kind, host, id, label) => ({ kind, host, id, label: label || id })

export function createExclusions(orca, current, changed) {
  let cached, writes = Promise.resolve()
  function read() {
    return cached ??= orca.storage.get(storageKey).then(value => {
      if (value == null) return []
      if (!Array.isArray(value) || value.some(r => !kinds.includes(r?.kind) || [r.host, r.id, r.label].some(x => typeof x !== 'string' || !x))) throw Error('Could not verify saved exclusions.')
      return value
    }).catch(error => { cached = undefined; throw error })
  }
  async function targets({ active, selected, session }, lookupWorkspace) {
    const out = []
    if (session) out.push(rule('session', session.environment, session.id, session.title))
    if (!active?.workspaceId || !lookupWorkspace) return out
    const { workspaces, truncated } = await orca.host.call('workspace.list', {})
    const rows = workspaces.filter(row => row.id === active.workspaceId)
    const hostHint = selected?.workspace === active.workspaceId ? selected.host : null
    const matches = hostHint ? rows.filter(row => (row.hostId || 'local') === hostHint) : rows
    if (matches.length !== 1 || (truncated && !hostHint)) return out
    const ws = matches[0], host = ws.hostId || 'local'
    out.push(rule('workspace', host, ws.id, ws.name || active.displayName))
    if (ws.projectId) out.push(rule('project', host, ws.projectId, ws.project))
    return out
  }
  async function check(context, resolveSession) {
    const rules = await read()
    if (rules.some(r => r.kind !== 'session')) {
      const choices = await targets(context, true)
      for (const choice of choices.reverse()) {
        if (rules.some(r => identify(r) === identify(choice))) return { excluded: choice.kind }
      }
      const workspace = choices.find(r => r.kind === 'workspace')
      if (!workspace || (!choices.some(r => r.kind === 'project') && rules.some(r => r.kind === 'project' && r.host === workspace.host))) return { excluded: 'unverified' }
    }
    const session = await resolveSession()
    if (session && rules.some(r => r.kind === 'session' && r.host === session.environment && r.id === session.id)) return { excluded: 'session' }
    if (!session && (!context.selected?.kind || ['agent-session', 'terminal'].includes(context.selected.kind)) && rules.some(r => r.kind === 'session')) return { excluded: 'unverified' }
    return { session }
  }
  async function list() {
    const rules = await read()
    try { return { rules, choices: await targets(await current(), true) } }
    catch { return { rules, choices: [], unavailable: true } }
  }
  function set({ kind, host, id, excluded } = {}) {
    const key = identify({ kind, host, id })
    if (!kinds.includes(kind) || typeof host !== 'string' || typeof id !== 'string' || typeof excluded !== 'boolean') throw Error('Invalid exclusion.')
    const pending = writes.then(async () => {
      const rules = await read()
      let next
      if (excluded) {
        const target = (await targets(await current(), kind !== 'session')).find(r => identify(r) === key)
        if (!target) throw Error('The selection changed. Choose the current item again.')
        if (rules.some(r => identify(r) === key)) return
        next = [...rules, target]
      } else next = rules.filter(r => identify(r) !== key)
      await orca.storage.set(storageKey, next)
      cached = Promise.resolve(next)
      changed()
    })
    writes = pending.catch(() => {})
    return pending.then(() => ({}))
  }
  return { check, list, set }
}
