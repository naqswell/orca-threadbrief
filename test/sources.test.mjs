import test from 'node:test'
import assert from 'node:assert/strict'
import { lstat, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { crc32, deflateSync } from 'node:zlib'
import { bindSources } from '../sources.mjs'
import { filename, saveSession, sessionFilename, summary } from '../store.mjs'
import { focusedSession, orcaDataPath, profileDatabase, readFocus } from '../session-context.mjs'

const workspaceId = 'identity:wt2:local:books'
const record = goal => ({ goal, done: 'Done', next: 'Next', links: {} })

async function fixture(t) {
  const base = await mkdtemp(join(tmpdir(), 'summary-sources-'))
  t.after(() => rm(base, { recursive: true, force: true }))
  const roots = [join(base, 'new'), join(base, 'old')]
  for (const root of roots) await mkdir(join(root, 'sessions', 'local'), { recursive: true, mode: 0o700 })
  let selected = { workspace: workspaceId, host: 'local', tab: 'terminal-one', leaf: 'leaf', kind: 'terminal' }
  let active = { workspaceId, displayName: 'Books' }, history = true, state = 'done'
  let entries = [{ role: 'assistant', kind: 'message', text: 'A substantive outcome.' }]
  const events = {}, posted = []
  const orca = { host: { call: async () => active }, panels: { post: (...args) => posted.push(args) }, events: { on: (name, fn) => { events[name] = fn } } }
  orca.storage = { get: async () => null }
  const command = async args => {
    if (args[0] === 'agent' && args[1] === 'list') return { agents: [{ kind: 'terminal', paneKey: `${selected.tab}:${selected.leaf}`, orcaSessionId: selected.tab === 'terminal-one' ? 'first' : 'second', title: selected.tab, state }] }
    if (args[0] === 'agent' && args[1] === 'read') return { orcaSessionId: args[2].replace('orca_session_id:', ''), entries, state }
    return null
  }
  const sources = bindSources(orca, { roots, command, focus: async () => selected, settings: async () => ({ historyOutcome: history, autoOpen: false }), reveal: async () => {}, interval: 10 })
  t.after(() => sources.stop())
  return { roots, sources, events, posted, setFocus: value => { selected = value }, setActive: value => { active = value }, setHistory: value => { history = value }, setState: value => { state = value }, setEntries: value => { entries = value } }
}
async function save(root, parts, name, value) {
  const path = join(root, ...parts)
  await mkdir(path, { recursive: true, mode: 0o700 })
  await writeFile(join(path, name), JSON.stringify(value), { mode: 0o600 })
}

test('a fresh install shows the finished reply without any profiles or summary files', async t => {
  const f = await fixture(t)
  f.setHistory(undefined)
  f.setState('working')
  assert.equal((await f.sources.focused()).emptyReason, 'waiting')
  f.setState('done')
  assert.equal((await f.sources.focused()).outcome, 'A substantive outcome.')
  f.setHistory(false)
  const off = await f.sources.focused()
  assert.equal(off.outcome, undefined)
  assert.equal(off.emptyReason, 'historyOff')
})

test('migration, history and worktree follow the selected session', async t => {
  const f = await fixture(t)
  await save(f.roots[1], ['sessions', 'local'], sessionFilename('first'), record('Old session'))
  await save(f.roots[1], [], filename(workspaceId), record('Shared worktree'))
  let view = await f.sources.focused()
  assert.equal(view.scope, 'session')
  assert.equal(view.summary.goal, 'Old session')
  assert.equal(view.workspaceId, workspaceId)
  f.setFocus({ workspace: workspaceId, host: 'local', tab: 'terminal-two', leaf: 'leaf', kind: 'terminal' })
  view = await f.sources.focused()
  assert.equal(view.scope, 'session')
  assert.equal(view.outcome, 'A substantive outcome.')
  f.setHistory(false)
  view = await f.sources.focused()
  assert.equal(view.scope, 'worktree')
  assert.equal(view.summary.goal, 'Shared worktree')
  await save(f.roots[0], ['sessions', 'local'], sessionFilename('second'), record('New session'))
  view = await f.sources.focused()
  assert.equal(view.summary.goal, 'New session')
  f.setFocus({ workspace: workspaceId, host: 'local', tab: 'file', kind: 'file' })
  view = await f.sources.focused()
  assert.equal(view.scope, 'worktree')
})

test('a working or mismatched history is never shown', async t => {
  const f = await fixture(t)
  f.setState('working')
  const view = await f.sources.focused()
  assert.equal(view.outcome, undefined)
  assert.equal(view.scope, 'session')
})

test('a working session keeps its previous completed outcome, never progress or a neighbouring session’s text', async t => {
  const f = await fixture(t)
  const first = await f.sources.focused()
  f.setState('working')
  f.setEntries([{ role: 'assistant', kind: 'message', text: 'Unfinished progress' }])
  let view = await f.sources.focused()
  assert.equal(view.working, true)
  assert.equal(view.outcome, first.outcome)
  f.sources.close()
  f.setEntries([['user','Missed task'], ['assistant','Newer completed handoff'], ['user','Current task']].map(([role, text]) => ({ role, kind:'message', text })))
  assert.equal((await f.sources.focused()).outcome, 'Newer completed handoff')
  f.setEntries([])
  assert.equal((await f.sources.focused()).outcome, 'Newer completed handoff')
  f.setFocus({ workspace: workspaceId, host:'local', tab:'terminal-two', leaf:'leaf', kind:'terminal' })
  assert.equal((await f.sources.focused()).outcome, undefined)
  f.setEntries([['user','Earlier task'], ['assistant','Earlier handoff'], ['user','New task'], ['assistant','Unfinished progress']].map(([role,text]) => ({ role, kind:'message', text })))
  view = await f.sources.focused()
  assert.equal(view.outcome, 'Earlier handoff')
  assert.notEqual(view.contextKey, first.contextKey)
})

test('agent events invalidate the selected session', async t => {
  const f = await fixture(t)
  await f.sources.focused({ listen: true })
  f.events['agent.status.changed']({ workspaceId, paneKey: 'terminal-one:leaf' })
  assert.equal(f.posted.at(-1)[0], 'summary.changed')
  f.setState('working')
  const refreshing = f.sources.focused({ listen: true })
  f.setState('done')
  f.events['agent.status.changed']({ workspaceId, paneKey: 'terminal-one:leaf' })
  await assert.rejects(refreshing, /selection changed/)
  assert.equal(f.posted.length, 2)
  assert.equal((await f.sources.focused()).outcome, 'A substantive outcome.')
  f.sources.close()
})

test('listeners refresh after a report is written or the selected session changes', async t => {
  const f = await fixture(t)
  await f.sources.focused({ listen: true })
  await save(f.roots[0], ['sessions', 'local'], sessionFilename('first'), record('Fresh'))
  await t.waitFor(() => assert.equal(f.posted.at(-1)?.[1].reason, 'file'))
  assert.equal((await f.sources.focused()).summary.goal, 'Fresh')
  f.setFocus({ workspace: workspaceId, host: 'local', tab: 'terminal-two', leaf: 'leaf', kind: 'terminal' })
  await t.waitFor(() => assert.equal(f.posted.at(-1)?.[1].reason, 'selection'))
  assert.equal((await f.sources.focused()).outcome, 'A substantive outcome.')
})

test('rejects symlinks and strips old publication commands', async t => {
  const f = await fixture(t)
  const result = { status: 'completed', changes: 'Changed', checks: 'Checked', publication: { commands: ['secret'] } }
  assert.equal(summary({ ...record('Safe'), result }).result.publication, undefined)
  if (process.platform === 'win32') return
  const target = join(f.roots[0], 'target')
  await writeFile(target, JSON.stringify(record('Unsafe')), { mode: 0o600 })
  await symlink(target, join(f.roots[0], 'sessions', 'local', sessionFilename('first')))
  f.setHistory(false)
  const view = await f.sources.focused()
  assert.equal(view.summary, null)
})

test('frames are checked against the current summary and selection', async t => {
  const f = await fixture(t)
  const chunk = (type, data) => {
    const tag = Buffer.from(type), size = Buffer.alloc(4), checksum = Buffer.alloc(4)
    size.writeUInt32BE(data.length)
    checksum.writeUInt32BE(crc32(Buffer.concat([tag, data])))
    return Buffer.concat([size, tag, data, checksum])
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(1, 0); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 6
  const image = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.from([0, 0, 0, 0, 255]))), chunk('IEND', Buffer.alloc(0))])
  const hash = createHash('sha256').update(image).digest('hex')
  const result = { status: 'completed', changes: 'Changed', checks: 'Checked', pairs: [{ title: 'Image', before: hash, after: hash }] }
  await save(f.roots[0], ['sessions', 'local'], sessionFilename('first'), { ...record('Images'), result, frames: { [hash]: image.toString('base64') } })
  await f.sources.focused()
  assert.equal(await f.sources.frame({ id: workspaceId, hash }), image.toString('base64'))
  await assert.rejects(f.sources.frame({ id: 'other', hash }))
  f.setFocus({ workspace: workspaceId, host: 'local', tab: 'file', kind: 'file' })
  await assert.rejects(f.sources.frame({ id: workspaceId, hash }))
})

test('private workflow metadata never reaches the panel', async t => {
  const f = await fixture(t)
  f.setHistory(false)
  const result = { status: 'completed', changes: 'Changed', checks: 'Checked', publication: { cwd: '/repo', branch: 'feature', repo: 'example', mr: { title: 'Title', description: 'Draft', base: 'main' }, commands: ['private command'] } }
  await save(f.roots[1], [], filename(workspaceId), { ...record('Shared'), result })
  const view = await f.sources.focused()
  assert.equal(view.legacyPublication, undefined)
  assert.equal(view.summary.result.publication, undefined)
  const trusted = await f.sources.workflowFocused()
  assert.deepEqual(trusted.legacyPublication, { cwd: '/repo', branch: 'feature', repo: 'example', mr: { title: 'Title', description: 'Draft', base: 'main' } })
})

test('focus must resolve to the active workspace and exact pane', async () => {
  const focus = { workspace: 'project::/other', host: 'local', tab: 'terminal', leaf: 'one', kind: 'terminal' }
  const command = async args => args[0] === 'worktree'
    ? { worktree: { id: 'project::/current', address: { environment: 'local', worktree: workspaceId } } }
    : { agents: [{ kind: 'terminal', paneKey: 'terminal:one', orcaSessionId: 'first' }] }
  assert.equal(await focusedSession(workspaceId, focus, command), null)
})

test('a paired worktree uses the confirmed remote identity', async t => {
  const base = await mkdtemp(join(tmpdir(), 'summary-paired-'))
  t.after(() => rm(base, { recursive: true, force: true }))
  const root = join(base, 'store'), remoteId = 'project::/remote/books'
  await save(root, ['paired', 'peer'], filename(workspaceId), record('Paired'))
  const selected = { workspace: remoteId, host: 'runtime:peer', tab: 'file', kind: 'file' }
  const orca = { host: { call: async () => ({ workspaceId: remoteId }) }, panels: { post() {} }, events: { on() {} } }
  orca.storage = { get: async () => null }
  const command = async args => args[0] === 'worktree' ? { worktree: { id: remoteId, address: { environment: 'peer', worktree: workspaceId } } } : null
  const sources = bindSources(orca, { roots: [root], command, focus: async () => selected, settings: async () => ({ historyOutcome: true }), reveal() {} })
  t.after(() => sources.stop())
  const view = await sources.focused()
  assert.equal(view.scope, 'worktree')
  assert.equal(view.workspaceId, remoteId)
  assert.equal(view.summary.goal, 'Paired')
})

test('session writer replaces its private snapshot', async t => {
  const base = await mkdtemp(join(tmpdir(), 'summary-writer-'))
  t.after(() => rm(base, { recursive: true, force: true }))
  const root = join(base, 'store')
  const path = await saveSession(root, 'local', 'first', record('First'))
  await saveSession(root, 'local', 'first', record('Second'))
  assert.equal(JSON.parse(await readFile(path, 'utf8')).goal, 'Second')
  if (process.platform !== 'win32') {
    assert.equal((await lstat(path)).mode & 0o777, 0o600)
    assert.equal((await lstat(root)).mode & 0o777, 0o700)
  }
  await assert.rejects(saveSession(root, '../outside', 'first', record('Invalid')))
})

test('profile paths are portable and profile IDs cannot escape', async t => {
  assert.equal(orcaDataPath({}, 'darwin', '/home/user'), join('/home/user', 'Library', 'Application Support', 'orca'))
  assert.equal(orcaDataPath({ XDG_CONFIG_HOME: '/config' }, 'linux', '/home/user'), join('/config', 'orca'))
  assert.equal(orcaDataPath({ APPDATA: 'C:\\Users\\user\\AppData\\Roaming' }, 'win32', 'C:\\Users\\user'), join('C:\\Users\\user\\AppData\\Roaming', 'orca'))
  assert.equal(orcaDataPath({ ORCA_USER_DATA_PATH: '/custom', XDG_CONFIG_HOME: '/config' }, 'linux', '/home/user'), '/custom')
  const dir = await mkdtemp(join(tmpdir(), 'summary-profile-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  await writeFile(join(dir, 'orca-profile-index.json'), JSON.stringify({ activeProfileId: '../outside' }))
  assert.equal(await profileDatabase(dir), null)
})

test('focus reads the active profile using built-in SQLite', async t => {
  let DatabaseSync
  try { ({ DatabaseSync } = await import('node:sqlite')) } catch { t.skip('Built-in SQLite is unavailable'); return }
  const dir = await mkdtemp(join(tmpdir(), 'summary-sqlite-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  await mkdir(join(dir, 'profiles', 'default'), { recursive: true })
  await writeFile(join(dir, 'orca-profile-index.json'), JSON.stringify({ activeProfileId: 'default' }))
  const db = new DatabaseSync(join(dir, 'profiles', 'default', 'profile-state.db'))
  db.exec('CREATE TABLE profile_state_document_parts(domain TEXT, part_key TEXT, payload TEXT)')
  const insert = db.prepare('INSERT INTO profile_state_document_parts VALUES (?, ?, ?)')
  for (const [key, value] of Object.entries({ activeWorktreeId: workspaceId, activeTabId: 'terminal', activeWorkspaceExecutionHostId: 'local' })) insert.run('workspaceSession', JSON.stringify([key]), JSON.stringify(value))
  db.close()
  const value = await readFocus(dir)
  assert.equal(value.workspace, workspaceId)
  assert.equal(value.tab, 'terminal')
})
