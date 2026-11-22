import { basename, dirname } from 'node:path'
import { realpath } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { bindSources } from './sources.mjs'
import { orcaJson } from './session-context.mjs'
import { bindProfiles } from './profiles.mjs'
import { bindRecaps } from './recaps.mjs'
import { bindCheckpoints } from './session-checkpoint.mjs'
import { inbox, receive } from './profile-imports.mjs'
import { createConfig } from './settings-config.mjs'

async function reveal() {
  const root = await realpath(dirname(fileURLToPath(import.meta.url)))
  const { plugins } = await orcaJson(['plugin', 'list', '--environment', 'local'])
  for (const { pluginKey, source, isDev } of plugins) {
    const installed = basename(dirname(root)) === pluginKey && basename(root) === source?.contentHash
    const devRoot = isDev && source?.reference && await realpath(source.reference).catch(() => null)
    if (installed || devRoot === root) {
      await orcaJson(['plugin', 'open', pluginKey, '--panel', 'summary', '--environment', 'local'])
      return
    }
  }
  throw new Error('Could not identify this plugin installation.')
}

let release
export default function activate(orca) {
  const settings = async () => (await orca.host.call('settings.get')).settings
  const sources = bindSources(orca, { settings, reveal })
  orca.panels.handle('summary.focused', sources.focused)
  orca.panels.handle('summary.closed', sources.close)
  orca.panels.handle('frame', sources.frame)
  orca.panels.handle('exclusions.list', sources.exclusions.list)
  orca.panels.handle('exclusions.set', sources.exclusions.set)
  const base = bindCheckpoints(orca, { source: sources.recapSource, command: orcaJson, settings })
  const revokeRecap = bindRecaps(orca, { settings, target: sources.recapTarget, source: sources.recapSource, command: orcaJson, base })
  const profiles = bindProfiles(orca, { settings, focused: sources.workflowFocused })
  const configure = createConfig(orca, sources.exclusions, profiles)
  const pluginDir = dirname(dirname(fileURLToPath(import.meta.url)))
  const key = basename(pluginDir), plugins = dirname(pluginDir)
  let stopImports, released = false
  if (basename(plugins) === 'plugins' && key.endsWith('.session-summary')) void inbox(key, dirname(plugins)).then(dir => receive(dir, profiles.accept, text => orca.log(text), configure)).then(stop => {
    if (released) stop(); else stopImports = stop
  }).catch(error => orca.log(error.message))
  const subscription = orca.settings.onDidChange(({ key }) => {
    if (['historyOutcome', 'pairedHistory', 'summaryStrategy', 'recapAgent', 'recapModel', 'recapEffort', 'reportFormat'].includes(key)) revokeRecap()
    if (key === 'historyOutcome' || key === 'pairedHistory' || key === 'manualLoad') sources.historyChanged()
    else if (key === 'profileActions' || key === 'commandAction') orca.panels.post('summary.changed', { reason: 'settings' })
  })
  // A status contribution keeps Orca's worker alive while it observes the active summary.
  void orca.host.call('statusBar.update', { id: 'summary-observer', visible: false }).catch(error => orca.log(error.message))
  release = () => { released = true; stopImports?.(); subscription?.dispose?.(); sources.stop() }
}

export function deactivate() { release?.(); release = undefined }
