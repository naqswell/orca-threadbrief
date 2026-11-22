import test from 'node:test'
import assert from 'node:assert/strict'
import { bindSources } from '../sources.mjs'
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
    if (args[1] === 'list') return { agents: [{ kind: 'terminal', paneKey: 'tab:leaf', orcaSessionId: state.session, state: 'done', title: 'Same name' }] }
    if (args[1] === 'read') { state.history++; return { orcaSessionId: state.session, entries: [] } }
  }
  const restart = () => {
    const api = bindSources(orca, { roots, settings: async () => ({ autoOpen: true }), focus: async () => ({ workspace: state.id, host: state.host, tab: 'tab', leaf: 'leaf', kind: 'terminal' }), command, reveal: async () => { state.reveals++ } })
    t.after(api.stop)
    return api
  }
  const save = () => writeFile(join(root, filename(state.id)), JSON.stringify({ goal: 'Shared', done: 'Checked', next: 'None', links: {} }), { mode: 0o600 })
  return { state, api: restart(), restart, save, created: () => events['workspace.created']({ kind: 'worktree', workspaceId: state.id }) }
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
