import { createHash } from 'node:crypto'
import { safeEnvironment } from './session-context.mjs'

export function catalogKey(environment, agent) {
  if (!safeEnvironment(environment) || typeof agent !== 'string' || !/^[\w.-]{1,255}$/u.test(agent)) throw Error('Specify a source environment ID and an installed agent ID.')
  return 'model-catalog-' + createHash('sha256').update(JSON.stringify([environment, agent])).digest('hex')
}

export const validEffort = value => typeof value === 'string' && /^[a-z][a-z0-9_-]{0,31}$/u.test(value)

export function validateModels(models) {
  if (!Array.isArray(models)) throw Error('Expected an array of models.')
  const ids = new Set()
  for (const entry of models) {
    const { id, name, efforts } = entry ?? {}
    if (typeof id !== 'string' || !id || id.length > 256 || /^-|[\s\p{Cc}\p{Cf}]/u.test(id) || ids.has(id)) throw Error('Every model needs a unique launch identifier without spaces.')
    if (Object.keys(entry).some(k => !['id', 'name', 'efforts'].includes(k)) || (name !== undefined && (typeof name !== 'string' || !name.trim() || name.length > 256 || /[\p{Cc}\p{Cf}]/u.test(name)))) throw Error('Use id, an optional plain-text name and optional efforts for each model.')
    if (efforts !== undefined && (!Array.isArray(efforts) || efforts.length > 32 || new Set(efforts).size !== efforts.length || efforts.some(e => !validEffort(e)))) throw Error('Efforts must be distinct reasoning level IDs.')
    ids.add(id)
  }
  return models
}
