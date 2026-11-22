import { readFile } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { parseArgs } from 'node:util'
import { validateConfig } from './settings-config.mjs'
import { inbox, requestConfig } from './profile-imports.mjs'

const usage = 'Usage: node threadbrief-config.mjs schema | check FILE | show --plugin KEY | apply FILE --plugin KEY | exclusions --plugin KEY | exclude FILE --plugin KEY | include FILE --plugin KEY | profiles --plugin KEY | remove-profile ID --plugin KEY | models --agent ID --environment HOST --plugin KEY | set-models FILE|- --agent ID --environment HOST --plugin KEY'

async function readJson(file) {
  const chunks = []
  let total = 0
  for await (const chunk of file === '-' ? process.stdin : createReadStream(file)) {
    total += chunk.length
    if (total > 1024 * 1024) throw Error('Configuration file exceeds 1 MiB.')
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks, total).toString('utf8'))
}
try {
  const { values, positionals: [op, ...args] } = parseArgs({ allowPositionals: true, options: { plugin: { type: 'string' }, agent: { type: 'string' }, environment: { type: 'string' } } })
  const offline = ['schema', 'check'].includes(op)
  const catalog = op === 'models' || op === 'set-models'
  if (catalog ? (!values.agent || !values.environment) : (values.agent !== undefined || values.environment !== undefined)) throw Error(usage)
  const noArg = ['schema', 'show', 'exclusions', 'profiles', 'models'].includes(op)
  const oneArg = ['check', 'apply', 'exclude', 'include', 'remove-profile', 'set-models'].includes(op)
  if ((!noArg && !oneArg) || args.length !== (oneArg ? 1 : 0) || (offline ? values.plugin !== undefined : !values.plugin)) throw Error(usage)
  let result
  if (op === 'schema') {
    const manifest = JSON.parse(await readFile(new URL('./orca-plugin.json', import.meta.url), 'utf8'))
    result = manifest.contributes.settings
  } else {
    let value
    if (catalog) {
      value = { environment: values.environment, agent: values.agent }
      if (op === 'set-models') value.models = await readJson(args[0])
    } else if (['check', 'apply', 'exclude', 'include'].includes(op)) {
      value = await readJson(args[0])
      if (op === 'check' || op === 'apply') validateConfig(value)
    } else if (op === 'remove-profile') value = args[0]
    result = op === 'check' ? { valid: true } : await requestConfig(await inbox(values.plugin), { op, value })
  }
  console.log(JSON.stringify(result, null, 2))
} catch (e) {
  console.error(e.message)
  process.exitCode = 1
}
