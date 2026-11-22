import test from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { inbox, receive } from '../profile-imports.mjs'
import { bindProfiles } from '../profiles.mjs'

const script = fileURLToPath(new URL('../workflow-profile.mjs', import.meta.url))
const example = fileURLToPath(new URL('../examples/team-profile.json', import.meta.url))
const key = 'local.session-summary'

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
    const stop = await receive(await inbox(key, root), bindProfiles(orca, {}), () => {})
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
