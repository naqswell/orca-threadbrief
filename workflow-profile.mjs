import { access, readFile, stat } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import { setTimeout as wait } from 'node:timers/promises'
import { validate } from './profiles.mjs'
import { enqueue, inbox } from './profile-imports.mjs'

try {
  const { values, positionals: [action, file, ...extra] } = parseArgs({ allowPositionals: true, options: { plugin: { type: 'string' }, enable: { type: 'boolean' } } })
  if (!['check', 'apply'].includes(action) || !file || extra.length || (action === 'apply' && !values.plugin) || (action === 'check' && (values.enable || values.plugin))) throw Error('Usage: node workflow-profile.mjs check FILE | apply FILE --plugin PUBLISHER.session-summary [--enable]')
  if ((await stat(file)).size > 1024 * 1024) throw Error('Profile exceeds 1 MiB.')
  const profile = validate(JSON.parse(await readFile(file, 'utf8')))
  if (action === 'check') console.log(JSON.stringify({ valid: true, id: profile.id, projectPrefix: profile.projectPrefix, actions: profile.steps.map(s => s.label) }))
  else {
    const path = await enqueue(await inbox(values.plugin), profile, !!values.enable)
    const exists = p => access(p).then(() => true, e => { if (e.code === 'ENOENT') return false; throw e })
    for (let i = 0; i < 50 && await exists(path); i++) await wait(100)
    if (await exists(path + '.failed')) throw Error('Import rejected. Check the installed plugin’s logs.')
    const queued = await exists(path)
    console.log(JSON.stringify({ status: queued ? 'queued' : 'applied', id: profile.id, enabled: !!values.enable, plugin: values.plugin }))
    if (queued) process.exitCode = 2
  }
} catch (e) { console.error(e.message); process.exitCode = 1 }
