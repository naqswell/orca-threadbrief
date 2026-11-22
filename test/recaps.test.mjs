import test from 'node:test'
import assert from 'node:assert/strict'
import { bindRecaps } from '../recaps.mjs'

function fixture() {
  const handlers = {}, calls = [], reads = []
  const state = { strategy: 'instant', key: 'original', id: 'session', historyId: 'session', excluded: false }
  const orca = { panels: { handle: (name, fn) => { handlers[name] = fn } }, host: { call: async (name, input) => { calls.push([name, input]); return name === 'agent.launch' ? { terminalId: 'issued' } : { focused: true } } } }
  const command = async args => {
    if (args[1] === 'installed') return { agents: [{ id: 'alternative', name: 'Alternative', default: true }] }
    reads.push(args)
    return { orcaSessionId: state.historyId, entries: [{ role: 'user', kind: 'message', text: 'Context '.repeat(2400) }, { role: 'assistant', kind: 'message', text: 'tool private', tools: ['tool'] }, { role: 'user', kind: 'message', text: 'Question?' }, { role: 'assistant', kind: 'message', text: 'One answer.' }] }
  }
  bindRecaps(orca, { settings: async () => ({ summaryStrategy: state.strategy }), source: async () => { if (state.excluded) throw Error('History off'); return { key: state.key, id: state.id, workspaceId: 'original-ws', environment: 'local' } }, command })
  return { state, calls, reads, preview: () => handlers['recap.preview']({ agent: 'alternative' }), start: p => handlers['recap.start'](p) }
}

for (const [strategy, entries, budget] of [['brief', '12', 3000], ['handoff', '48', 12000]]) {
  test(`${strategy} previews only bounded visible messages and submits exactly the approved prompt once`, async () => {
    const f = fixture(); f.state.strategy = strategy
    const p = await f.preview()
    assert.deepEqual(f.reads, [['agent', 'read', 'orca_session_id:session', '--environment', 'local', '--limit', entries]])
    const messages = JSON.parse(p.prompt.split('Conversation excerpt (oldest first):\n')[1])
    assert.equal(messages.map(m => m.text).join('').length, budget)
    assert.equal(messages.at(-1).text, 'One answer.')
    assert.doesNotMatch(p.prompt, /tool private/)
    assert.deepEqual(f.calls, [])
    const [a, b] = await Promise.allSettled([f.start(p), f.start(p)])
    assert.equal(a.value.focused, true); assert.equal(b.status, 'rejected')
    assert.deepEqual(f.calls, [['agent.launch', { workspaceId: 'original-ws', agent: 'alternative', prompt: p.prompt }], ['terminal.focus', { terminalId: 'issued' }]])
  })
}

test('instant, excluded, mismatched history, and changed target cannot dispatch', async () => {
  const f = fixture()
  await assert.rejects(f.preview(), /strategy|Select Brief/)
  f.state.strategy = 'brief'; f.state.excluded = true
  await assert.rejects(f.preview(), /off/)
  assert.deepEqual(f.reads, [])
  f.state.excluded = false; f.state.historyId = 'other'
  await assert.rejects(f.preview(), /No finished/)
  f.state.historyId = f.state.id
  const p = await f.preview(); f.state.key = 'different'
  await assert.rejects(f.start(p), /changed/)
  const q = await f.preview(); f.state.excluded = true
  await assert.rejects(f.start(q), /off/)
  f.state.excluded = false
  const r = await f.preview(); f.state.strategy = 'handoff'
  await assert.rejects(f.start(r), /changed/)
  assert.deepEqual(f.calls, [])
})
