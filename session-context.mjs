import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { homedir, platform } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const exec = promisify(execFile)
export const sessionId = value => typeof value === 'string' && /^(?:orca_session_id:)?[\w-]{1,255}$/u.test(value) ? value.replace(/^orca_session_id:/u, '') : null
export const safeEnvironment = value => typeof value === 'string' && /^[\w-]{1,255}$/u.test(value)
export function orcaDataPath(env = process.env, os = platform(), home = homedir()) {
  if (env.ORCA_USER_DATA_PATH) return env.ORCA_USER_DATA_PATH
  if (os === 'win32') return join(env.APPDATA || join(home, 'AppData', 'Roaming'), 'orca')
  if (os === 'darwin') return join(home, 'Library', 'Application Support', 'orca')
  return join(env.XDG_CONFIG_HOME || join(home, '.config'), 'orca')
}
export async function orcaJson(args) {
  let stdout
  const executable = process.env.ORCA_CLI_COMMAND || (process.env.ORCA_DEV_REPO_ROOT ? 'orca-dev' : platform() === 'linux' ? 'orca-ide' : platform() === 'win32' ? 'orca.exe' : 'orca')
  try { ({ stdout } = await exec(executable, [...args, '--json'], { timeout: args[0] === 'agent' && args[1] === 'launch' ? 28000 : 8000, maxBuffer: 4 * 1024 * 1024 })) }
  catch (error) {
    if (error.code !== 1 || !error.stdout) throw Error('Orca CLI did not confirm the request. Check Orca before trying again.')
    stdout = error.stdout
  }
  let response
  try { response = JSON.parse(stdout) } catch { throw Error('Orca CLI returned an unreadable response.') }
  if (response.ok) return response.result
  if (response.error?.code === 'selector_not_found') return null
  throw Error('Orca could not confirm the request.')
}
export async function profileDatabase(dataPath = orcaDataPath()) {
  const { activeProfileId } = JSON.parse(await readFile(join(dataPath, 'orca-profile-index.json'), 'utf8'))
  return safeEnvironment(activeProfileId) ? join(dataPath, 'profiles', activeProfileId, 'profile-state.db') : null
}
const focusQuery = `
WITH parts AS (SELECT part_key, payload FROM profile_state_document_parts WHERE domain = 'workspaceSession'),
focus AS (SELECT
 (SELECT json_extract(payload, '$') FROM parts WHERE part_key = '["activeWorktreeId"]') AS workspace,
 (SELECT json_extract(payload, '$') FROM parts WHERE part_key = '["activeTabId"]') AS tab,
 (SELECT json_extract(payload, '$') FROM parts WHERE part_key = '["activeWorkspaceExecutionHostId"]') AS host),
selected AS (SELECT focus.*,
 (SELECT value FROM json_each(COALESCE(
  (SELECT payload FROM profile_state_document_parts WHERE domain = 'workspaceSessionsByHostId' AND part_key = json_array(focus.host, 'unifiedTabs', focus.workspace)),
  (SELECT payload FROM parts WHERE part_key = json_array('unifiedTabs', focus.workspace)))) WHERE json_extract(value, '$.id') = focus.tab) AS tabData,
 COALESCE((SELECT json_extract(payload, '$.activeLeafId') FROM profile_state_document_parts WHERE domain = 'workspaceSessionsByHostId' AND part_key = json_array(focus.host, 'terminalLayoutsByTabId', focus.tab)),
 (SELECT json_extract(payload, '$.activeLeafId') FROM parts WHERE part_key = json_array('terminalLayoutsByTabId', focus.tab))) AS leaf FROM focus),
agent AS (SELECT selected.*,
 (SELECT value FROM profile_state_document_parts, json_each(payload, '$.tabs') WHERE domain = 'remoteLayoutSnapshots'
 AND part_key = json_array(substr(selected.host, length('runtime:') + 1), 'workspaces', selected.workspace)
 AND selected.tab LIKE 'web-terminal-%' AND json_extract(value, '$.parentTabId') = substr(selected.tab, length('web-terminal-') + 1)
 AND json_extract(value, '$.leafId') = selected.leaf) AS remotePane FROM selected)
SELECT workspace, host, tab, leaf, json_extract(tabData, '$.contentType') AS kind,
 json_extract(tabData, '$.entityId') AS entity, json_extract(remotePane, '$.agentStatus.orcaSessionId') AS sessionId,
 COALESCE(json_extract(remotePane, '$.customTitle'), json_extract(remotePane, '$.title')) AS title FROM agent`
export async function readFocus(dataPath = orcaDataPath()) {
  const path = await profileDatabase(dataPath)
  if (!path) return null
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(path, { readOnly: true })
  try { return db.prepare(focusQuery).get() ?? null } finally { db.close() }
}
function tabLeaf(value, id) {
  if (!value || typeof value !== 'object') return null
  if (value.tabId === id && typeof value.activeLeafId === 'string') return value.activeLeafId
  for (const child of Object.values(value)) { const leaf = tabLeaf(child, id); if (leaf) return leaf }
  return null
}
export async function focusedSession(contextId, focus, command = orcaJson) {
  if (!focus?.workspace || !contextId) return null
  const paired = focus.host?.startsWith('runtime:')
  const environment = paired ? focus.host.slice(8) : 'local'
  const stable = contextId.startsWith('identity:wt2:')
  if ((focus.host && focus.host !== 'local' && !paired) || !safeEnvironment(environment) || (paired && environment === 'local') || ((paired || !stable) && focus.workspace !== contextId)) return null
  if (focus.kind && !['agent-session', 'terminal'].includes(focus.kind)) return null
  if (stable && !paired && focus.workspace !== contextId) {
    const found = await command(['worktree', 'show', '--environment', 'local', '--worktree', contextId])
    if (found?.worktree?.id !== focus.workspace || found.worktree.address?.worktree !== contextId || found.worktree.address?.environment !== 'local') return null
  }
  const terminalTab = focus.tab?.replace(/^web-terminal-/u, '')
  const persistedId = sessionId(focus.sessionId)
  if (paired && persistedId && terminalTab && focus.leaf) return { id: persistedId, environment, title: focus.title, paneKey: `${terminalTab}:${focus.leaf}` }
  const workspace = stable && !paired ? contextId : focus.workspace.startsWith('folder:') ? focus.workspace : `id:${focus.workspace}`
  const scope = ['--environment', environment, '--worktree', workspace]
  const found = await command(['agent', 'list', ...scope])
  if (!found || found.truncated || !Array.isArray(found.agents)) return null
  let matches
  if (focus.kind === 'agent-session' || focus.tab?.startsWith('web-agent-session-') || focus.tab?.startsWith('agent-session:')) {
    const tab = focus.tab?.replace(/^web-agent-session-/u, '')
    const entity = focus.entity ?? tab?.replace(/^agent-session:/u, '')
    const tabs = new Set([tab, entity, `agent-session:${entity}`, `structured-agent-session-${entity}`])
    matches = found.agents.filter(agent => agent.kind === 'chat' && (tabs.has(agent.paneKey?.split(':').slice(0, -1).join(':')) || (sessionId(entity) && sessionId(entity) === sessionId(agent.orcaSessionId))))
  } else if (focus.tab) {
    const leaf = focus.leaf ?? tabLeaf((await command(['terminal', 'list', ...scope, '--include-visual-layouts']))?.visualLayouts, terminalTab)
    matches = leaf ? found.agents.filter(agent => agent.kind === 'terminal' && agent.paneKey === `${terminalTab}:${leaf}`) : []
  } else return null
  const id = matches.length === 1 ? sessionId(matches[0].orcaSessionId) : null
  return id ? { id, environment, title: matches[0].title, paneKey: matches[0].paneKey, state: matches[0].state, updatedAt: matches[0].updatedAt, lastAssistantMessage: matches[0].lastAssistantMessage } : null
}
