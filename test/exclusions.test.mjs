import test from 'node:test'
import assert from 'node:assert/strict'
import { bindSources } from '../sources.mjs'
import { bindProfiles } from '../profiles.mjs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { filename } from '../store.mjs'

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'threadbrief-exclusions-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const state = { id: 'identity:wt2:local:1', session: 'a', project: 'p', host: 'local', snapshots: 0, history: 0, reveals: 0 }
  const events = {}, memory = new Map()
  const orca = { storage: { get: async k => memory.get(k), set: async (k, v) => memory.set(k, structuredClone(v)) }, host: { call: async name => name === 'workspace.readContext' ? { workspaceId: state.id } : { workspaces: [{ id: state.id, hostId: state.host, name: 'Same name', projectId: state.project, project: 'Same name' }] } }, events: { on: (k, cb) => { events[k] = cb } }, panels: { post() {} } }
  const roots = { *[Symbol.iterator]() { state.snapshots++; yield root } }
  const command = async args => {
    if (args[1] === 'list') return { agents: [{ kind: 'terminal', paneKey: 'tab:leaf', orcaSessionId: state.session, state: state.liveState ?? 'done', lastAssistantMessage: state.statusReply, title: 'Same name' }] }
    if (args[1] === 'read') { state.history++; return { orcaSessionId: state.historyId ?? state.session, state: state.transcriptState, entries: state.reply ? [{ role: 'assistant', kind: 'message', text: state.reply }] : [] } }
  }
  const restart = () => {
    const api = bindSources(orca, { roots, settings: async () => ({ autoOpen: true, manualLoad: state.manual }), focus: async () => ({ workspace: state.id, host: state.host, tab: 'tab', leaf: 'leaf', kind: 'terminal', ...state.focus }), command, reveal: async () => { state.reveals++ }, interval:10 })
    t.after(api.stop)
    return api
  }
  const save = (goal = 'Shared') => writeFile(join(root, filename(state.id)), JSON.stringify({ goal, done: 'Checked', next: 'None', links: {} }), { mode: 0o600 })
  return { state, api: restart(), restart, save, events, orca, created: () => events['workspace.created']({ kind: 'worktree', workspaceId: state.id }) }
}

test('session exclusion skips all report access, history, workflow, recap and auto-open; removal restores existing report', async t => {
  const { state, api, save, created } = await fixture(t)
  await save()
  const session = (await api.exclusions.list()).choices.find(r => r.kind === 'session')
  await api.exclusions.set({ ...session, excluded: true })
  assert.equal((await api.focused()).excluded, 'session')
  assert.equal((await api.workflowFocused()).summary, null)
  await assert.rejects(api.recapSource(), /off/)
  await created()
  assert.deepEqual([state.snapshots, state.history, state.reveals], [0, 0, 0])
  state.session = 'b'
  assert.equal((await api.focused()).summary.goal, 'Shared')
  state.session = 'a'
  await api.exclusions.set({ ...session, excluded: false })
  await created()
  assert.equal(state.reveals, 1)
})

test('manual briefs do not touch reports or history until requested for the current selection', async t => {
  const { state, api, save, created } = await fixture(t)
  state.manual = true
  await save()
  const idle = await api.focused({ listen: true })
  assert.equal(idle.scope, 'manual')
  assert.equal((await api.workflowFocused()).scope, 'manual')
  await created()
  assert.deepEqual([state.snapshots, state.history, state.reveals], [0, 0, 0])
  const input = { loadFor: idle.contextKey }
  assert.equal((await api.focused(input)).summary.goal, 'Shared')
  const before = [state.snapshots, state.history]
  assert.ok(before.every(n => n > 0))
  assert.equal((await api.focused()).summary.goal, 'Shared')
  state.id = 'identity:wt2:local:other'
  await assert.rejects(api.focused(input), /selection changed/)
  await assert.rejects(api.workflowFocused(input), /selection changed/)
  assert.deepEqual([state.snapshots, state.history], before)
  const target = (await api.exclusions.list()).choices.find(r => r.kind === 'session')
  await api.exclusions.set({ ...target, excluded: true })
  const next = await api.focused()
  assert.equal((await api.focused({ loadFor: next.contextKey })).scope, 'excluded')
  assert.deepEqual([state.snapshots, state.history], before)
})

test('a manual click cannot load a newly attached agent through the previous selection', async t => {
  const { state, api, orca } = await fixture(t)
  state.manual = true
  const first = await api.focused({listen:true}), notifications = []
  orca.panels.post = (_, data) => notifications.push(data.reason)
  state.session = 'b'
  const reads = [state.snapshots, state.history]
  await assert.rejects(api.focused({loadFor:first.contextKey}), /selection changed/)
  await assert.rejects(api.workflowFocused({loadFor:first.contextKey}), /selection changed/)
  assert.deepEqual([state.snapshots, state.history], reads)
  assert.deepEqual(notifications, ['selection'])
  assert.notEqual((await api.focused()).contextKey, first.contextKey)
})

test('a new agent tab offers no load action until Orca identifies its session', async t => {
  const { state, api, events, orca } = await fixture(t)
  state.manual = true
  state.id = 'folder:new'
  state.session = null
  const before = await api.focused({listen:true})
  assert.equal(before.contextKey, undefined)
  state.session = 'agent-arrived'
  const changed = new Promise(resolve => { orca.panels.post = (_, data) => resolve(data.reason) })
  events['agent.status.changed']({workspaceId:state.id, paneKey:'tab:leaf'})
  assert.equal(await changed, 'selection')
  const ready = await api.focused()
  assert.ok(ready.contextKey)
  assert.deepEqual([state.snapshots, state.history], [0, 0])
})

test('manual monitoring notices a replacement session without reading its reports or history', async t => {
  const { state, api, events, orca } = await fixture(t)
  state.manual = true
  state.reply = 'Reply from A'
  const initial = await api.focused({listen:true})
  await api.focused({loadFor:initial.contextKey})
  const counts = [state.snapshots, state.history], notifications = []
  orca.panels.post = (_, data) => notifications.push(data.reason)
  state.session = 'b'
  events['agent.status.changed']({workspaceId:state.id, paneKey:'tab:leaf'})
  await t.waitFor(() => assert.ok(notifications.includes('selection')))
  assert.deepEqual([state.snapshots, state.history], counts)
  assert.equal((await api.focused()).outcome, undefined)
  state.session = 'a'
  await api.focused()
  notifications.length = 0
  state.session = 'c'
  await t.waitFor(() => assert.ok(notifications.includes('selection')))
  assert.deepEqual([state.snapshots, state.history], counts)
})

test('on-demand A → B → A restores the last explicit read, not the latest history or a reused pane', async t => {
  const { state, api } = await fixture(t)
  state.manual = true
  const counts = () => [state.snapshots, state.history]
  const load = async () => api.focused({ loadFor: (await api.focused()).contextKey })
  state.reply = 'First reply'
  assert.equal((await load()).outcome, 'First reply')
  const first = counts()
  state.session = 'b'
  assert.equal((await api.focused()).scope, 'manual')
  assert.deepEqual(counts(), first)
  state.reply = 'Different session'
  assert.equal((await load()).outcome, 'Different session')
  const both = counts()
  state.session = 'a'
  state.reply = 'Newer reply'
  assert.equal((await api.focused()).outcome, 'First reply')
  assert.deepEqual(counts(), both)
  assert.equal((await load()).outcome, 'Newer reply')
  const refreshed = counts()
  const target = (await api.exclusions.list()).choices.find(r => r.kind === 'session')
  await api.exclusions.set({ ...target, excluded: true })
  assert.equal((await api.focused()).outcome, undefined)
  await api.exclusions.set({ ...target, excluded: false })
  assert.equal((await api.focused()).scope, 'manual')
  assert.deepEqual(counts(), refreshed)
  await load()
  api.historyChanged()
  assert.equal((await api.focused()).scope, 'manual')
})

test('finished session can use its own reported reply when history lags, but not for another or unfinished turn', async t => {
  const { state, api } = await fixture(t)
  state.statusReply = 'The venue confirmed our reservation.'
  assert.equal((await api.focused()).outcome, state.statusReply)
  state.reply = 'The full reply from the transcript.'
  assert.equal((await api.focused()).outcome, state.reply)
  state.session = 'b'
  state.historyId = 'a'
  assert.equal((await api.focused()).outcome, undefined)
  state.historyId = 'b'
  state.transcriptState = 'working'
  assert.equal((await api.focused()).outcome, undefined)
  state.liveState = 'working'
  assert.equal((await api.focused()).outcome, undefined)
})

test('returning to an empty manual load offers a fresh read without fetching history on its own', async t => {
  const { state, api } = await fixture(t)
  state.manual = true
  const input = { loadFor:(await api.focused()).contextKey }
  assert.equal((await api.focused(input)).emptyReason, 'noReply')
  state.session = 'b'
  await api.focused()
  state.session = 'a'
  state.reply = 'The completed answer is now available.'
  const reads = state.history
  assert.equal((await api.focused()).scope, 'manual')
  assert.equal(state.history, reads)
  assert.equal((await api.focused(input)).outcome, state.reply)
})

test('a host without a local agent namespace cannot restore or refresh a local brief', async t => {
  const { state, api } = await fixture(t)
  state.manual = true
  state.reply = 'Desktop session'
  assert.equal((await api.focused({ loadFor: (await api.focused()).contextKey })).outcome, state.reply)
  const reads = state.history
  for (state.host of ['ssh:other', 'runtime:local']) {
    const selected = await api.focused()
    assert.equal(selected.outcome, undefined)
    assert.equal((await api.focused({ loadFor: selected.contextKey })).outcome, undefined)
  }
  assert.equal(state.history, reads)
})

test('a manually loaded shared report survives a workspace switch without an agent session', async t => {
  const { state, api, save } = await fixture(t)
  state.manual = true
  state.session = null
  await save()
  const workspace = state.id
  const brief = await api.focused({ loadFor: (await api.focused()).contextKey })
  assert.equal(brief.summary.goal, 'Shared')
  const reads = state.snapshots
  state.id = 'identity:wt2:local:other'
  assert.equal((await api.focused()).scope, 'manual')
  state.id = workspace
  assert.equal((await api.focused()).summary?.goal, 'Shared')
  assert.equal(state.snapshots, reads)
})

test('restored workflow actions reject a changed report without replacing the remembered brief', async t => {
  const { state, api, save } = await fixture(t)
  state.manual = true
  await save()
  const workspace = { id:state.id, kind:'worktree', hostId:'local', projectId:'p', branch:'main', path:tmpdir() }
  const methods = {}, data = new Map(), terminals = []
  bindProfiles({
    storage: { get: k => data.get(k), set: (k, v) => data.set(k, v) },
    panels: { handle: (k, fn) => { methods[k] = fn }, post() {} },
    host: { call: async (method, input) => {
      if (method === 'workspace.readContext') return { workspaceId:state.id, branch:'main' }
      if (method === 'workspace.list') return { workspaces:[workspace] }
      if (method === 'project.list') return { projects:[{ id:'p', kind:'git', hostId:'local', path:'/work/books' }] }
      if (method === 'terminal.create') { terminals.push(input); return { terminalId:'new' } }
      if (method === 'terminal.focus') return { focused:true }
    } }
  }, { settings: async () => ({profileActions:true}), focused:api.workflowFocused })
  await methods['profiles.save']({ profile:{id:'sample', name:'Sample', enabled:true, projectPrefix:'p', shell:'posix', reviewHost:'example.org', steps:[{label:'Status', kind:'push', argv:['git','status']}]} })
  const loadFor = (await api.focused()).contextKey
  await api.focused({loadFor})
  await methods['workflow.view']({loadFor})
  const restored = await methods['workflow.view']()
  assert.equal(restored.state, 'actions')
  await save('Updated report')
  await assert.rejects(methods['workflow.terminal']({key:restored.key}), /changed/i)
  assert.deepEqual(terminals, [])
  assert.equal((await api.focused()).summary.goal, 'Shared')
})

test('overlapping exclusions survive restart, apply to future workspaces, and are not matched by display name', async t => {
  const { state, api, restart } = await fixture(t)
  const [workspace, project] = (await api.exclusions.list()).choices.filter(r => r.kind !== 'session')
  await Promise.all([workspace, project].map(r => api.exclusions.set({ ...r, excluded: true })))
  const next = restart()
  state.id = 'identity:wt2:local:2'
  assert.equal((await next.focused()).excluded, 'project')
  state.project = null
  assert.equal((await next.focused()).excluded, 'unverified')
  state.project = 'q'
  assert.equal((await next.focused()).excluded, undefined)
  await assert.rejects(next.exclusions.set({ ...project, excluded: true }), /selection changed/i)
  state.id = workspace.id
  await next.exclusions.set({ ...project, excluded: false })
  assert.equal((await next.focused()).excluded, 'workspace')
  state.host = 'ssh:other'
  assert.equal((await next.focused()).excluded, undefined)
})
