import test from 'node:test'
import assert from 'node:assert/strict'
import { bindSources } from '../sources.mjs'
import { bindRecaps } from '../recaps.mjs'

test('paired history and generation target only the confirmed peer; disconnect, ID mismatch, exclusion and opt-out never use a local agent', async t => {
  const workspaceId = 'folder:room', handlers = {}, calls = [], rules = new Map()
  let online = true, actualId = 'same', enabled = true
  const orca = { host: { call: async name => { assert.equal(name, 'workspace.readContext'); return { workspaceId } } }, panels: { handle: (k,v) => { handlers[k] = v } }, events: { on() {} }, storage: { get: async k => rules.get(k), set: async (k,v) => rules.set(k,v) } }
  const focus = async () => ({ workspace: workspaceId, host: 'runtime:peer', tab: 'web-terminal-one', kind: 'terminal', leaf: 'two', sessionId: 'same' })
  const command = async args => {
    calls.push(args)
    assert.equal(args[args.indexOf('--environment') + 1], 'peer')
    if (!online) throw Error('Offline')
    if (args[1] === 'list') return { agents: [{ orcaSessionId: actualId, paneKey: 'one:two', state: 'done' }] }
    if (args[1] === 'installed') return { agents: [{ id: 'remote-agent' }] }
    if (args[1] === 'read') return { orcaSessionId: 'same', entries: [{ role: 'assistant', kind: 'message', text: 'The peer outcome.' }] }
    if (args[1] === 'launch') return { outcome: { kind: 'terminal', handle: 'remote-terminal' } }
    throw Error('Unexpected command')
  }
  const settings = async () => ({ pairedHistory: enabled, summaryStrategy: 'brief' })
  const sources = bindSources(orca, { settings, command, focus, roots: [], reveal() {} }); t.after(sources.stop)
  bindRecaps(orca, { settings, command, source: sources.recapSource })
  assert.equal((await sources.focused()).outcome, 'The peer outcome.')
  const preview = await handlers['recap.preview']({ agent: 'remote-agent' })
  assert.equal(preview.environment, 'peer')
  await handlers['recap.start'](preview)
  assert.deepEqual(calls.at(-1), ['agent','launch','--environment','peer','--worktree',workspaceId,'--agent','remote-agent','--surface','terminal','--prompt',preview.prompt])
  const revoked = await handlers['recap.preview']({ agent: 'remote-agent' })
  calls.length = 0; online = false
  assert.equal((await sources.focused()).emptyReason, 'unavailable')
  await assert.rejects(handlers['recap.start'](revoked))
  online = true; actualId = 'wrong'
  assert.equal((await sources.focused()).emptyReason, 'unavailable')
  assert.ok(calls.every(c => c[1] === 'list'))
  calls.length = 0; enabled = false; actualId = 'same'
  assert.equal((await sources.focused()).emptyReason, 'pairedOff')
  enabled = true
  await sources.exclusions.set({ kind: 'session', host: 'peer', id: 'same', excluded: true })
  assert.equal((await sources.focused()).excluded, 'session')
  await assert.rejects(handlers['recap.agents'](), /off/)
  assert.deepEqual(calls, [])
})

test('changing selection, strategy or history access during a paired lookup cancels the pending operation', async t => {
  const workspaceId = 'folder:sample', handlers = {}
  let leaf = 'first', strategy = 'brief', allowed = true, duringLookup = () => {}, launches = 0, reads = 0
  const focus = async () => ({ workspace: workspaceId, host: 'runtime:peer', tab: 'web-terminal-main', leaf, kind: 'terminal', sessionId: leaf })
  const orca = { host: { call: async () => ({ workspaceId }) }, panels: { handle: (k, fn) => { handlers[k] = fn } }, events: { on() {} }, storage: { get: async () => [] } }
  const command = async ([, op]) => {
    if (op === 'list') {
      const agent = { paneKey: `main:${leaf}`, orcaSessionId: leaf, state: 'done' }
      duringLookup()
      return { agents: [agent] }
    }
    if (op === 'installed') return { agents: [{ id: 'writer' }] }
    if (op === 'read') { reads++; return { orcaSessionId: leaf, state: 'done', entries: [{ role: 'user', kind: 'message', text: 'First context' }] } }
    if (op === 'launch') launches++
  }
  const settings = async () => ({ summaryStrategy: strategy, pairedHistory: allowed })
  const sources = bindSources(orca, { settings, command, focus, roots: [] })
  t.after(sources.stop)
  bindRecaps(orca, { settings, command, source: sources.recapSource })
  const preview = await handlers['recap.preview']({ agent: 'writer' })
  duringLookup = () => { leaf = 'second' }
  await assert.rejects(handlers['recap.start'](preview), /selection changed/)
  duringLookup = () => {}
  const next = await handlers['recap.preview']({ agent: 'writer' })
  duringLookup = () => { strategy = 'instant' }
  await assert.rejects(handlers['recap.start'](next), /Select Brief/)
  const before = reads
  duringLookup = () => { allowed = false; sources.historyChanged() }
  await assert.rejects(sources.focused(), /selection changed/)
  assert.equal(reads, before)
  assert.equal(launches, 0)
})
