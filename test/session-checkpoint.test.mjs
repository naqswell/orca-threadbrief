import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { bindCheckpoints } from '../session-checkpoint.mjs'
import { readSnapshot, saveSession, sessionFilename } from '../store.mjs'

const block = (revision, done) => 'Task update.\n\n```threadbrief-checkpoint\n' + JSON.stringify({ revision, goal:'Plan the workshop', done, decisions:'Use room A', checks:'Capacity confirmed', open:'Guest count', next:'Send invitations' }) + '\n```'
const entry = (text, role = 'assistant') => ({ kind:'message', role, text })

async function setup(t) {
  const dir = await mkdtemp(join(tmpdir(), 'threadbrief-checkpoints-'))
  t.after(() => rm(dir, {recursive:true, force:true}))
  const root = join(dir, 'reports'), legacyRoot = join(dir, 'legacy'), handlers = {}, calls = []
  const state = { environment:'local', key:'first', id:'same', entries:[], allowed:true }
  bindCheckpoints({panels:{handle:(k, fn) => { handlers[k] = fn }}}, {
    root, legacyRoot, settings:async () => ({reportFormat:state.format}), source:async () => { if (!state.allowed) throw Error('History is off'); return {...state} },
    command:async args => {
      calls.push(args)
      assert.deepEqual(args, ['agent','read','orca_session_id:same','--environment',state.environment,'--limit','100'])
      state.duringRead?.()
      return {orcaSessionId:state.returnId ?? state.id, state:state.working ? 'working' : state.noTranscriptState ? undefined : 'done', entries:state.entries}
    }
  })
  const saved = (env = state.environment) => readSnapshot(root, ['sessions',env], sessionFilename(state.id))
  const target = async (input = {}) => handlers['checkpoint.target']({sessionKey:JSON.stringify([state.workspaceId, state.environment, state.id]), revision:(await saved())?.checkpoint?.revision ?? 0, ...input})
  return { state, root, legacyRoot, calls, target, capture:handlers['checkpoint.capture'], importDraft:handlers['checkpoint.import'], saved }
}

test('a terminated writer releases its lock and concurrent writes cannot bypass revision checks', async t => {
  const f = await setup(t), record = {goal:'Plan', done:'Reserved', next:'Invite'}
  const child = spawnSync(process.execPath, ['--input-type=module', '-e',
    `import {saveSession} from ${JSON.stringify(new URL('../store.mjs', import.meta.url).href)}; await saveSession(${JSON.stringify(f.root)}, 'local', 'same', ${JSON.stringify(record)}, () => process.exit(0))`], {encoding:'utf8'})
  assert.equal(child.status, 0, child.stderr)
  await saveSession(f.root, 'local', 'same', record)
  assert.equal((await f.saved()).done, 'Reserved')
  let release, entered
  const ready = new Promise(resolve => {entered = resolve})
  const blocked = new Promise(resolve => {release = resolve})
  const first = saveSession(f.root, 'local', 'same', {...record, done:'First'}, async () => {entered(); await blocked; return true})
  await ready
  try { await assert.rejects(saveSession(f.root, 'local', 'same', {...record, done:'Conflicting'})) }
  finally { release(); await first }
  assert.equal((await f.saved()).done, 'First')
})

test('checkpoint capture stays in the original local or paired session; newer snapshots replace, duplicates are harmless, old ones cannot roll back', async t => {
  const f = await setup(t)
  for (const environment of ['local','peer']) {
    Object.assign(f.state, {environment, key:environment + ':turn'})
    const before = f.calls.length, target = await f.target()
    assert.equal(f.calls.length, before)
    f.state.entries = [entry(block(90,'Ignore user'),'user'), entry(block(1,'Reserved '+environment)), {...entry(block(91,'Ignore tool')),tools:['note']}]
    assert.deepEqual(await f.capture(target), {revision:1})
    f.state.entries = [entry(block(2,'Reserved '+environment+'; sent invites'))]
    await assert.rejects(f.capture(target), /changed/)
    await f.capture(await f.target()); await f.capture(await f.target())
    for (const text of [block(1,'Old'), block(2,'Conflict'), '```threadbrief-checkpoint\n{}\n```', '```threadbrief-checkpoint\n{"revision":3}']) {
      f.state.entries = [entry(text)]
      await assert.rejects(f.capture(await f.target()))
    }
    assert.equal((await f.saved()).checkpoint.revision, 2)
  }
  assert.equal((await f.saved('local')).done, 'Reserved local; sent invites')
  assert.equal((await f.saved('peer')).done, 'Reserved peer; sent invites')
})

test('a stateless transcript can save only the reply confirmed by the finished agent', async t => {
  const f = await setup(t), target = await f.target(), reply = block(1, 'Seats confirmed')
  Object.assign(f.state, {noTranscriptState:true, entries:[entry(reply)], lastAssistantMessage:'A different reply'})
  await assert.rejects(f.capture(target))
  assert.equal(await f.saved(), null)
  f.state.lastAssistantMessage = reply
  await f.capture(target)
  assert.equal((await f.saved()).done, 'Seats confirmed')
})

test('unmarked, unfinished, excluded or changed session cannot write a checkpoint', async t => {
  const f = await setup(t), target = await f.target()
  f.state.entries = [entry(block(1,'Only a user example'),'user')]
  await assert.rejects(f.capture(target), /No checkpoint/)
  f.state.entries = [entry(block(1,'Earlier turn')), entry('Different task','user'), entry('An unmarked newer answer')]
  await assert.rejects(f.capture(target), /No checkpoint/)
  f.state.entries = [entry(block(1,'Valid'))]; f.state.working = true
  await assert.rejects(f.capture(target), /finished history/)
  f.state.working = false; f.state.returnId = 'different'
  await assert.rejects(f.capture(target), /finished history/)
  f.state.returnId = undefined; f.state.allowed = false
  const reads = f.calls.length
  await assert.rejects(f.capture(target), /off/); assert.equal(f.calls.length, reads)
  f.state.allowed = true; f.state.duringRead = () => { f.state.key = 'new-turn' }
  await assert.rejects(f.capture(target), /session or turn changed/)
  assert.equal(await f.saved(), null)
})

test('a checkpoint cannot replace or shadow an existing manual report', async t => {
  const f = await setup(t), target = await f.target()
  f.state.entries = [entry(block(1,'New'))]
  const manual = {goal:'Original', done:'Manual', next:'Continue'}
  await saveSession(f.legacyRoot, 'local', 'same', manual)
  await assert.rejects(f.capture(target), /manually saved/)
  assert.equal(await f.saved(), null)
  await saveSession(f.root, 'local', 'same', manual)
  await assert.rejects(f.capture(target), /manually saved/)
  assert.equal((await f.saved()).done, 'Manual')
})

test('a Create click is bound to its displayed session, host and absence of a report', async t => {
  const f = await setup(t), input = {sessionKey:JSON.stringify([f.state.workspaceId,'local','same']),revision:0}
  f.state.environment = 'peer'
  assert.deepEqual(await f.target(input), {stale:'session'})
  f.state.environment = 'local'
  const first = await f.target(input)
  f.state.entries = [entry(block(1, 'Reserved'))]
  await f.capture(first)
  assert.deepEqual(await f.target(input), {stale:'report'})
  assert.equal((await f.target({...input,revision:1})).fields.done, 'Reserved')
})

test('formatted drafts attach only to their original host, report and format; malformed changes leave the saved version alone', async t => {
  const f = await setup(t)
  f.state.format = 'Use a table.'
  const target = await f.target()
  const fields = {reportKey:target.key, revision:1, goal:'Seats', done:'Reserved', checks:'Receipt', next:'Invite', decisions:'None', open:'None'}
  const save = async (record, scope = target) => f.importDraft({key:scope.key, draft:JSON.stringify(record)})
  await assert.rejects(save(fields), /Markdown/)
  const report = {...fields, formatted:'| Result | Check |\\n|---|---|\\n| Reserved | Receipt |'.replaceAll('\\n','\n')}
  f.state.environment = 'peer'
  await assert.rejects(save(report, await f.target()), /another session/)
  f.state.environment = 'local'
  f.state.format = 'Only bullets'
  await assert.rejects(save(report), /changed/)
  f.state.format = 'Use a table.'
  await save(report)
  assert.equal((await f.saved()).checkpoint.formatted, report.formatted)
  await assert.rejects(save({...report, done:'Stale'}), /changed/)
  const next = await f.target()
  assert.equal(next.fields.done, 'Reserved')
  assert.equal(next.fields.formatted, undefined)
  assert.deepEqual(f.calls, [])
})
