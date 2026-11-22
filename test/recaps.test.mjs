import test from 'node:test'
import assert from 'node:assert/strict'
import { bindRecaps } from '../recaps.mjs'
import { orcaJson } from '../session-context.mjs'

function fixture() {
  const handlers = {}, calls = [], reads = []
  const state = { strategy: 'instant', key: 'original', id: 'session', historyId: 'session', excluded: false }
  const orca = { panels: { handle: (name, fn) => { handlers[name] = fn } }, host: { call: async (name, input) => { calls.push([name, input]); return name === 'agent.launch' ? { terminalId: 'issued' } : { focused: true } } } }
  const command = async args => {
    if (args[1] === 'installed') return { agents: [{ id: 'alternative', name: 'Alternative', default: true }] }
    if (args[1] === 'launch') { calls.push(args); if (state.refused) throw Error('Unknown model'); return { outcome: { kind: 'terminal', handle: 'new-terminal' } } }
    reads.push(args)
    return { orcaSessionId: state.historyId, entries: [{ role: 'user', kind: 'message', text: 'Context '.repeat(2400) }, { role: 'assistant', kind: 'message', text: 'tool private', tools: ['tool'] }, { role: 'user', kind: 'message', text: 'Question?' }, { role: 'assistant', kind: 'message', text: 'One answer.' }] }
  }
  const target = async () => ({ environment: state.environment ?? 'local', worktree: 'id:original-ws' })
  bindRecaps(orca, { settings: async () => ({ summaryStrategy: state.strategy, recapModel: state.model, recapAgent: state.agent }), target, source: async () => { if (state.excluded) throw Error('History off'); return { ...await target(), key: state.key, id: state.id, workspaceId: 'original-ws' } }, command })
  return { state, calls, reads, preview: () => handlers['recap.preview']({ agent: 'alternative' }), start: (p, ctx) => handlers['recap.start'](p, ctx) }
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

for (const environment of ['local', 'peer']) {
  test(`pinned model on ${environment}: preview and launch agree; no fallback after refusal`, async () => {
    const f = fixture()
    Object.assign(f.state, { strategy: 'brief', environment, agent: 'alternative', model: 'provider/version-1' })
    const p = await f.preview()
    assert.equal(p.model, 'provider/version-1')
    f.state.model = 'provider/version-2'
    await assert.rejects(f.start(p), /model changed/)
    assert.deepEqual(f.calls, [])
    const next = await f.preview()
    await f.start(next)
    const args = ['agent', 'launch', '--environment', environment, '--worktree', 'id:original-ws', '--agent', 'alternative', '--surface', 'terminal', '--model', 'provider/version-2', '--prompt', next.prompt]
    assert.deepEqual(f.calls, [args])
    const refused = await f.preview()
    f.state.refused = true
    await assert.rejects(f.start(refused), /Unknown model/)
    assert.deepEqual(f.calls, [args, args])
    const stale = await f.preview()
    f.state.agent = 'another-agent'
    await assert.rejects(f.start(stale), /preferred agent changed/)
    assert.equal(f.calls.length, 2)
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

test('closing the recap panel cancels a pending start before launch', async () => {
  const f = fixture()
  f.state.strategy = 'brief'
  const preview = await f.preview(), controller = new AbortController()
  const request = f.start(preview, { signal: controller.signal })
  controller.abort()
  await assert.rejects(request, { name: 'AbortError' })
  assert.deepEqual(f.calls, [])
})

test('CLI launch errors never echo the conversation excerpt', async t => {
  const executable = process.env.ORCA_CLI_COMMAND
  t.after(() => { if (executable === undefined) delete process.env.ORCA_CLI_COMMAND; else process.env.ORCA_CLI_COMMAND = executable })
  process.env.ORCA_CLI_COMMAND = 'threadbrief-test-missing-executable'
  await assert.rejects(orcaJson(['agent', 'launch', '--prompt', 'synthetic private excerpt']), error => {
    assert.doesNotMatch(error.message, /synthetic private excerpt|--prompt/)
    assert.match(error.message, /Check Orca/)
    return true
  })
})
