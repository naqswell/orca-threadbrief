import { readFile, stat } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import { validateConfig } from './settings-config.mjs'
import { inbox, requestConfig } from './profile-imports.mjs'

const usage = 'Usage: node threadbrief-config.mjs schema | check FILE | show --plugin KEY | apply FILE --plugin KEY | exclusions --plugin KEY | exclude FILE --plugin KEY | include FILE --plugin KEY | profiles --plugin KEY | remove-profile ID --plugin KEY'
try {
  const { values, positionals: [op, ...args] } = parseArgs({ allowPositionals: true, options: { plugin: { type: 'string' } } })
  const offline = ['schema', 'check'].includes(op)
  const noArg = ['schema', 'show', 'exclusions', 'profiles'].includes(op)
  const oneArg = ['check', 'apply', 'exclude', 'include', 'remove-profile'].includes(op)
  if ((!noArg && !oneArg) || args.length !== (oneArg ? 1 : 0) || (offline ? values.plugin !== undefined : !values.plugin)) throw Error(usage)
  let result
  if (op === 'schema') {
    const manifest = JSON.parse(await readFile(new URL('./orca-plugin.json', import.meta.url), 'utf8'))
    result = manifest.contributes.settings
  } else {
    let value
    if (['check', 'apply', 'exclude', 'include'].includes(op)) {
      if ((await stat(args[0])).size > 1024 * 1024) throw Error('Configuration file exceeds 1 MiB.')
      const content = await readFile(args[0], 'utf8')
      if (Buffer.byteLength(content) > 1024 * 1024) throw Error('Configuration file exceeds 1 MiB.')
      value = JSON.parse(content)
      if (op === 'check' || op === 'apply') validateConfig(value)
    } else if (op === 'remove-profile') value = args[0]
    result = op === 'check' ? { valid: true } : await requestConfig(await inbox(values.plugin), { op, value })
  }
  console.log(JSON.stringify(result, null, 2))
} catch (e) {
  console.error(e.message)
  process.exitCode = 1
}
