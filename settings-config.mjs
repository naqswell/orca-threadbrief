import { readFileSync } from 'node:fs'

const manifest = JSON.parse(readFileSync(new URL('./orca-plugin.json', import.meta.url), 'utf8'))
const settings = new Map(manifest.contributes.settings.map(setting => [setting.key, setting]))
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)

export function validateConfig(patch) {
  if (!object(patch)) throw Error('Preferences must be an object.')
  for (const key of Reflect.ownKeys(patch)) {
    const spec = settings.get(key), value = patch[key]
    if (!spec || typeof value !== spec.type || (spec.enum && !spec.enum.includes(value)) ||
        (typeof value === 'string' && ((spec.maxLength !== undefined && value.length > spec.maxLength) || /[\u0000-\u001f\u007f]/u.test(value))) ||
        (key === 'recapModel' && value && (/^-/u.test(value) || /\s/u.test(value)))) {
      throw Error(`Invalid preference: ${String(key)}.`)
    }
  }
  return patch
}

export function createConfig(orca, exclusions, profiles) {
  let writes = Promise.resolve()
  const show = async () => {
    const result = await orca.host.call('settings.get')
    if (!object(result?.settings)) throw Error('Could not read preferences.')
    return result.settings
  }
  const apply = patch => {
    validateConfig(patch)
    const pending = writes.then(async () => {
      try {
        for (const [key, value] of Object.entries(patch)) {
          const result = await orca.host.call('settings.set', {key, value})
          if (result?.ok === false) throw Error(`Could not save ${key}.`)
        }
        const actual = await show()
        if (Object.entries(patch).some(([key, value]) => actual[key] !== value)) throw Error('Saved preferences do not match the requested values.')
        return actual
      } catch (error) {
        throw Error(`Could not apply all preferences; some may have been saved. ${error.message}`)
      }
    })
    writes = pending.catch(() => {})
    return pending
  }
  return async ({op, value} = {}) => {
    switch (op) {
      case 'show': return show()
      case 'apply': return apply(value)
      case 'exclusions': return exclusions.list()
      case 'exclude':
      case 'include':
        if (!object(value) || Object.keys(value).length !== 3 || !['project', 'workspace', 'session'].includes(value.kind) ||
            typeof value.host !== 'string' || !value.host || typeof value.id !== 'string' || !value.id) throw Error('Invalid exclusion.')
        return exclusions.set({kind:value.kind, host:value.host, id:value.id, excluded:op === 'exclude'})
      case 'profiles': return profiles.list()
      case 'remove-profile': return profiles.remove(value)
      default: throw Error('Invalid configuration operation.')
    }
  }
}
