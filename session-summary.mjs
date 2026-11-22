import { parseArgs } from 'node:util'
import { directory, maxBytes, saveSession } from './store.mjs'
import { orcaJson, safeEnvironment, sessionId } from './session-context.mjs'

const { values, positionals } = parseArgs({
  options: { environment: { type: 'string', default: 'local' } },
  allowPositionals: true
})
const id = positionals.length === 1 ? sessionId(positionals[0]) : null
if (!id) throw Error('Provide one Orca session ID and a JSON summary on stdin.')

let environment = values.environment
if (environment !== 'local') {
  const { environments } = await orcaJson(['environment', 'list'])
  const matches = environments.filter(item => item.id === environment || item.name === environment)
  if (matches.length !== 1 || !safeEnvironment(matches[0].id)) throw Error('The Orca environment is unknown or ambiguous.')
  environment = matches[0].id
}
const session = await orcaJson(['agent', 'show', `orca_session_id:${id}`, '--environment', environment])
if (sessionId(session?.orcaSessionId) !== id || !Array.isArray(session.places) || session.places.length !== 1 || !session.places[0].paneKey || sessionId(session.places[0].orcaSessionId) !== id) {
  throw Error('Orca did not confirm one open session in the selected environment.')
}
const chunks = []
let size = 0
for await (const chunk of process.stdin) {
  size += chunk.length
  if (size > maxBytes) throw Error('Summary exceeds 16 KiB.')
  chunks.push(chunk)
}
const input = JSON.parse(Buffer.concat(chunks).toString('utf8'))
if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['goal', 'done', 'next', 'links', 'dispatch', 'result'].includes(key))) throw Error('Invalid summary fields.')
if (input.result?.publication || input.result?.pairs || input.result?.noPair) throw Error('Session summaries cannot include publication actions or images.')
const record = input.result && !input.dispatch ? { ...input, dispatch: 'session' } : input
const path = await saveSession(directory, environment, id, record)
console.log(JSON.stringify({ environment, path }))
