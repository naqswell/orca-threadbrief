import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
    root, legacyRoot, source:async () => { if (!state.allowed) throw Error('History is off'); return {...state} },
    command:async args => {
      calls.push(args)
      assert.deepEqual(args, ['agent','read','orca_session_id:same','--environment',state.environment,'--limit','100'])
      state.duringRead?.()
      return {orcaSessionId:state.returnId ?? state.id, state:state.working ? 'working' : 'done', entries:state.entries}
    }
  })
  return { state, root, legacyRoot, calls, target:handlers['checkpoint.target'], capture:handlers['checkpoint.capture'], saved:(env = state.environment) => readSnapshot(root, ['sessions',env], sessionFilename(state.id)) }
}

test('checkpoint capture stays in the original local or paired session; newer snapshots replace, duplicates are harmless, old ones cannot roll back', async t => {
  const f = await setup(t)
  for (const environment of ['local','peer']) {
    Object.assign(f.state, {environment, key:environment + ':turn'})
    const before = f.calls.length, target = await f.target()
    assert.equal(f.calls.length, before)
    f.state.entries = [entry(block(90,'Ignore user'),'user'), entry(block(1,'Reserved '+environment)), {...entry(block(91,'Ignore tool')),tools:['note']}]
    assert.deepEqual(await f.capture(target), {revision:1})
    f.state.entries = [entry(block(2,'Reserved '+environment+'; sent invites'))]
    await f.capture(target); await f.capture(target)
    for (const text of [block(1,'Old'), block(2,'Conflict'), '```threadbrief-checkpoint\n{}\n```', '```threadbrief-checkpoint\n{"revision":3}']) {
      f.state.entries = [entry(text)]
      await assert.rejects(f.capture(target))
    }
    assert.equal((await f.saved()).checkpoint.revision, 2)
  }
  assert.equal((await f.saved('local')).done, 'Reserved local; sent invites')
  assert.equal((await f.saved('peer')).done, 'Reserved peer; sent invites')
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
