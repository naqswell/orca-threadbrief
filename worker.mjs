import { basename, dirname } from 'node:path'
import { realpath } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { bindSources } from './sources.mjs'
import { orcaJson } from './session-context.mjs'
import { bindProfiles } from './profiles.mjs'

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
  bindProfiles(orca, { settings, focused: sources.workflowFocused })
  const subscription = orca.settings.onDidChange(({ key }) => {
    if (key === 'historyOutcome' || key === 'profileActions' || key === 'commandAction') orca.panels.post('summary.changed', { reason: 'settings' })
  })
  // A status contribution keeps Orca's worker alive while it observes the active summary.
  void orca.host.call('statusBar.update', { id: 'summary-observer', visible: false }).catch(error => orca.log(error.message))
  release = () => { subscription?.dispose?.(); sources.stop() }
}

export function deactivate() { release?.(); release = undefined }
