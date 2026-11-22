import { createHash } from 'node:crypto'
import { safeEnvironment } from './session-context.mjs'

export function catalogKey(environment, agent) {
  if (!safeEnvironment(environment) || typeof agent !== 'string' || !/^[\w.-]{1,255}$/u.test(agent)) throw Error('Specify a source environment ID and an installed agent ID.')
  return 'model-catalog-' + createHash('sha256').update(JSON.stringify([environment, agent])).digest('hex')
}

export function validateModels(models) {
  if (!Array.isArray(models)) throw Error('Expected an array of models with id and optional name.')
  const ids = new Set()
  for (const entry of models) {
    const { id, name } = entry ?? {}
    if (typeof id !== 'string' || !id || id.length > 256 || /^-|[\s\p{Cc}\p{Cf}]/u.test(id) || ids.has(id)) throw Error('Every model needs a unique launch identifier without spaces.')
    if (Object.keys(entry).some(k => k !== 'id' && k !== 'name') || (name !== undefined && (typeof name !== 'string' || !name.trim() || name.length > 256 || /[\p{Cc}\p{Cf}]/u.test(name)))) throw Error('Use only id and an optional plain-text name for each model.')
    ids.add(id)
  }
  return models
}
