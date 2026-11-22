import test from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { inbox, receive, requestConfig } from '../profile-imports.mjs'
import { bindProfiles } from '../profiles.mjs'

const script = fileURLToPath(new URL('../workflow-profile.mjs', import.meta.url))
const example = fileURLToPath(new URL('../examples/team-profile.json', import.meta.url))
const key = 'local.session-summary'
const configScript = fileURLToPath(new URL('../threadbrief-config.mjs', import.meta.url))

test('CLI applies to the selected installation and distinguishes rejection from a saved profile with a settings failure', async t => {
  const base = await mkdtemp(join(tmpdir(), 'threadbrief-inboxes-'))
  t.after(() => rm(base, { recursive: true, force: true }))
  const roots = ['one', 'two'].map(name => join(base, name))
  const stores = [new Map(), new Map()]
  let failSetting = false, failSave = false
  for (const [index, root] of roots.entries()) {
    await mkdir(root)
    const orca = {
      panels: { handle() {}, post() {} },
      storage: { get: async k => stores[index].get(k), set: async (k, v) => { if (failSave) throw Error('Storage full'); stores[index].set(k, structuredClone(v)) } },
      host: { call: async () => { if (failSetting) throw Error('Settings unavailable') } }
    }
    const stop = await receive(await inbox(key, root), bindProfiles(orca, {}).accept, () => {})
    t.after(stop)
  }
  const apply = async (index, ...flags) => {
    const args = [script, 'apply', example, '--plugin', key, ...flags]
    return promisify(execFile)(process.execPath, args, { env: { ...process.env, ORCA_USER_DATA_PATH: roots[index] } })
  }
  assert.equal(JSON.parse((await apply(1)).stdout).status, 'applied')
  assert.equal(stores[1].get('workflowProfiles')[0].enabled, false)
  assert.equal(stores[0].size, 0)
  failSetting = true
  await assert.rejects(apply(0, '--enable'), error => error.code === 2 && JSON.parse(error.stdout).status === 'saved')
  assert.equal(stores[0].get('workflowProfiles')[0].enabled, true)
  failSave = true
  await assert.rejects(apply(1, '--enable'), error => error.code === 1 && error.stderr.includes('Import rejected'))
  assert.equal(stores[1].get('workflowProfiles')[0].enabled, false)
})

test('configuration requests return results and failures only for the selected inbox', async t => {
  const base = await mkdtemp(join(tmpdir(), 'threadbrief-config-'))
  t.after(() => rm(base, { recursive: true, force: true }))
  const dirs = await Promise.all(['one', 'two'].map(async name => {
    const root = join(base, name)
    await mkdir(root)
    return inbox(key, root)
  }))
  const calls = [[], []]
  for (const [i, dir] of dirs.entries()) {
    const stop = await receive(dir, () => { throw Error('Unexpected profile') }, () => {}, async config => {
      calls[i].push(config)
      if (config.op === 'apply') throw Error('Settings unavailable')
      return { manualLoad: true }
    })
    t.after(stop)
  }
  assert.deepEqual(await requestConfig(dirs[1], { op: 'show' }), { manualLoad: true })
  await assert.rejects(requestConfig(dirs[1], { op: 'apply', value: { manualLoad: true } }), /Settings unavailable/)
  assert.deepEqual(calls[0], [])
  assert.deepEqual(calls[1].map(call => call.op), ['show', 'apply'])
  assert.deepEqual(await readdir(dirs[1]), [])
})

test('configuration CLI validates offline and sends online operations to the selected installation', async t => {
  const base = await mkdtemp(join(tmpdir(), 'threadbrief-config-cli-'))
  t.after(() => rm(base, { recursive: true, force: true }))
  const dir = await inbox(key, base)
  const calls = []
  const stop = await receive(dir, () => {}, () => {}, async request => {
    calls.push(request)
    if (request.op === 'show') return { manualLoad: true }
    if (request.op === 'exclusions') return { rules: [], choices: [] }
    if (request.op === 'profiles') return { profiles: [] }
    return request.value
  })
  t.after(stop)
  const run = (...args) => promisify(execFile)(process.execPath, [configScript, ...args], { env: { ...process.env, ORCA_USER_DATA_PATH: base } })
  const schema = JSON.parse((await run('schema')).stdout)
  assert.equal(schema.find(s => s.key === 'manualLoad').default, false)
  assert.deepEqual(schema.find(s => s.key === 'summaryStrategy').enum, ['brief', 'handoff', 'instant'])
  const file = join(base, 'input.json')
  await writeFile(file, JSON.stringify({ manualLoad: true }))
  assert.deepEqual(JSON.parse((await run('check', file)).stdout), { valid: true })
  assert.deepEqual(JSON.parse((await run('apply', file, '--plugin', key)).stdout), { manualLoad: true })
  assert.deepEqual(JSON.parse((await run('show', '--plugin', key)).stdout), { manualLoad: true })
  assert.deepEqual(JSON.parse((await run('exclusions', '--plugin', key)).stdout), { rules: [], choices: [] })
  assert.deepEqual(JSON.parse((await run('profiles', '--plugin', key)).stdout), { profiles: [] })
  await writeFile(file, JSON.stringify({ kind: 'workspace', host: 'local', id: 'one' }))
  await run('exclude', file, '--plugin', key)
  await run('include', file, '--plugin', key)
  await run('remove-profile', 'example', '--plugin', key)
  assert.deepEqual(calls.map(call => call.op), ['apply', 'show', 'exclusions', 'profiles', 'exclude', 'include', 'remove-profile'])
  assert.equal(calls.at(-1).value, 'example')
  await writeFile(file, JSON.stringify({ manualLoad: 'yes' }))
  await assert.rejects(run('check', file))
  await assert.rejects(run('apply', file, '--plugin', key))
  assert.equal(calls.length, 7)
  await assert.rejects(run('show'))
  await assert.rejects(run('schema', '--plugin', key))
})

test('receiver rejects unsafe files without invoking handlers', { timeout: 10000 }, async t => {
  const base = await mkdtemp(join(tmpdir(), 'threadbrief-private-'))
  t.after(() => rm(base, { recursive: true, force: true }))
  const dir = await inbox(key, base)
  const outside = join(base, 'outside')
  await writeFile(outside, JSON.stringify({ config: { op: 'show' } }), { mode: 0o600 })
  const name = '1-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.json'
  try { await symlink(outside, join(dir, name)) } catch (e) {
    if (process.platform !== 'win32' || e.code !== 'EPERM') throw e
    t.skip('Creating symbolic links requires Windows Developer Mode or the symlink privilege')
    return
  }
  let called = false
  let rejected
  const failure = new Promise(resolve => { rejected = resolve })
  const stop = await receive(dir, () => { called = true }, () => rejected(), () => { called = true })
  t.after(stop)
  await failure
  assert.equal(called, false)
  assert.ok((await readdir(dir)).includes(name + '.failed'))
  if (process.platform !== 'win32') {
    const other = '2-bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb.json'
    const temporary = join(dir, 'unpublished')
    await writeFile(temporary, JSON.stringify({ config: { op: 'show' } }), { mode: 0o600 })
    await chmod(temporary, 0o644)
    await rename(temporary, join(dir, other))
    const failure2 = new Promise((resolve, reject) => {
      let attempts = 0
      const timer = setInterval(async () => {
        if ((await readdir(dir)).includes(other + '.failed')) { clearInterval(timer); resolve() }
        else if (++attempts === 100) { clearInterval(timer); reject(Error('Receiver did not reject unsafe file')) }
      }, 20)
    })
    await failure2
    assert.equal(called, false)
  }
})

test('configuration timeout removes queued request', { timeout: 10000 }, async t => {
  const base = await mkdtemp(join(tmpdir(), 'threadbrief-timeout-'))
  t.after(() => rm(base, { recursive: true, force: true }))
  const dir = await inbox(key, base)
  await assert.rejects(requestConfig(dir, { op: 'show' }), /timed out/)
  assert.deepEqual(await readdir(dir), [])
})
