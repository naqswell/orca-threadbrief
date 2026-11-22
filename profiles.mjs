import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { realpath } from 'node:fs/promises'
import { basename, isAbsolute } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)
const storageKey = 'workflowProfiles'
const trustKey = 'trustedWorkflowOpeners'
const substitutions = new Set(['{repo}', '{branch}', '{base}', '{title}', '{description}', '{url}'])
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const branchName = value => typeof value === 'string' ? value.replace(/^refs\/heads\//, '') : ''
const plain = (value, max = 4096) => typeof value === 'string' && value.length <= max && !/[\u0000-\u0008\u000b-\u001f\u007f]/u.test(value)
const line = (value, max = 512) => plain(value, max) && !/[\r\n]/u.test(value) && Boolean(value.trim())
const ref = value => line(value, 512) && /^[A-Za-z0-9_][A-Za-z0-9._/-]*$/u.test(value) && !value.includes('..') && !value.includes('//') && !/[./]$/u.test(value)
const quote = (value, shell) => shell === 'powershell' ? `'${value.replaceAll("'", "''")}'` : `'${value.replaceAll("'", "'\\''")}'`

function argvValid(argv, opener = false) {
  return Array.isArray(argv) && argv.length > 0 && argv.length <= 32 && argv.every((arg, i) =>
    line(arg, 2048) && (!/[{}]/u.test(arg) || substitutions.has(arg)) && (i !== 0 || !substitutions.has(arg))) &&
    !/^(?:sh|bash|zsh|fish|dash|ksh|cmd|powershell|pwsh|node|python\d*|perl|ruby|php|osascript)(?:\.exe)?$/iu.test(basename(argv[0])) &&
    (!opener || (isAbsolute(argv[0]) && !/\.(?:bat|cmd|ps1|js|mjs|cjs|py|sh)$/iu.test(argv[0]) &&
      argv.filter(arg => arg === '{url}').length === 1 && argv.every(arg => !substitutions.has(arg) || arg === '{url}')))
}

export function validate(profile) {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile) ||
      !/^[A-Za-z0-9_-]{1,128}$/u.test(profile.id ?? '') || !line(profile.name, 200) ||
      typeof profile.enabled !== 'boolean' || !line(profile.projectPrefix, 1024) ||
      !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(profile.reviewHost ?? '') ||
      !['posix', 'powershell'].includes(profile.shell) || !Array.isArray(profile.steps) || profile.steps.length > 20 ||
      !profile.steps.every(step => step && line(step.label, 200) && ['push', 'review'].includes(step.kind) && argvValid(step.argv) && !step.argv.includes('{url}')) ||
      (profile.openReview !== undefined && !argvValid(profile.openReview, true)) ||
      (profile.excludeBranchPrefix !== undefined && !line(profile.excludeBranchPrefix, 512))) throw Error('Invalid workflow profile.')
  return { id:profile.id, name:profile.name, enabled:profile.enabled, projectPrefix:profile.projectPrefix,
    reviewHost:profile.reviewHost, shell:profile.shell, steps:profile.steps.map(({label, kind, argv}) => ({label, kind, argv:[...argv]})),
    ...(profile.openReview ? {openReview:[...profile.openReview]} : {}),
    ...(profile.excludeBranchPrefix ? {excludeBranchPrefix:profile.excludeBranchPrefix} : {}) }
}

function reviewLink(value, host) {
  if (!line(value, 1200)) return null
  let url
  try { url = new URL(value) } catch { return null }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash ||
      url.hostname !== host || url.href !== value || !/^\/(?:[A-Za-z0-9_.-]+\/)+(?:pull|(?:-\/)?merge_requests)\/[1-9][0-9]*$/u.test(url.pathname) ||
      url.pathname.split('/').some(part => part === '.' || part === '..')) return null
  return value
}

function knownReview(summary, profile) {
  const links = {...summary?.links, ...summary?.result?.links}
  for (const [label, value] of [['PR', links.PR], ['MR', links.MR]]) {
    if (reviewLink(value, 'github.com') || reviewLink(value, 'gitlab.com') || (profile && reviewLink(value, profile.reviewHost))) return { url:value, label:`Open ${label}` }
  }
  return null
}

const approval = profile => digest([profile.id, profile.projectPrefix, profile.reviewHost, profile.openReview])

export function bindProfiles(orca, { settings, focused }) {
  const host = orca.host
  const issued = new Map()
  let updates = Promise.resolve()
  const trustedOpener = async profile => Boolean(profile?.openReview && (await orca.storage.get(trustKey))?.[profile.id] === approval(profile))
  const getProfiles = async () => {
    const saved = await orca.storage.get(storageKey)
    if (saved == null) return []
    if (!Array.isArray(saved)) throw Error('Stored profiles are invalid.')
    return saved.map(validate)
  }
  const update = operation => {
    const next = updates.then(async () => {
      const profiles = await getProfiles()
      const saved = await orca.storage.get(trustKey)
      const trust = Object.assign(Object.create(null), saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {})
      const result = operation(profiles, trust)
      await orca.storage.set(trustKey, trust)
      await orca.storage.set(storageKey, profiles)
      issued.clear()
      orca.panels.post('summary.changed', {reason:'profiles'})
      return result
    })
    updates = next.catch(() => {})
    return next
  }
  const projects = async prefix => {
    const list = await host.call('project.list', {})
    return { projects:(list.projects ?? []).filter(p => !prefix || p.id.startsWith(prefix)).map(({id, name}) => ({id, name})), truncated:Boolean(list.truncated) }
  }
  orca.panels.handle('profiles.list', async () => ({profiles:await getProfiles(), ...await projects('')}))
  orca.panels.handle('profiles.preview', async ({projectPrefix} = {}) => {
    if (!line(projectPrefix, 1024)) throw Error('Enter a project prefix.')
    return projects(projectPrefix)
  })
  const save = async ({profile, trustOpener = false} = {}) => {
    const checked = validate(profile)
    if (typeof trustOpener !== 'boolean' || (trustOpener && !checked.openReview)) throw Error('Invalid opener approval.')
    return update((profiles, trust) => {
      const index = profiles.findIndex(p => p.id === checked.id)
      delete trust[checked.id]
      if (trustOpener) trust[checked.id] = approval(checked)
      if (index < 0) profiles.push(checked); else profiles[index] = checked
      return {profile:checked}
    })
  }
  orca.panels.handle('profiles.save', save)
  orca.panels.handle('profiles.delete', async ({id} = {}) => update((profiles, trust) => {
    delete trust[id]
    const index = profiles.findIndex(p => p.id === id)
    if (index >= 0) profiles.splice(index, 1)
    return {}
  }))

  async function view(draft) {
    const context = await host.call('workspace.readContext')
    const selection = await focused()
    if (selection?.scope === 'excluded') return {state:'none'}
    const summary = selection?.summary
    const bareReview = knownReview(summary)
    const none = bareReview ? {state:'review', review:{...bareReview, custom:false}} : {state:'none'}
    if (!context?.workspaceId || (selection?.workspaceId && selection.workspaceId !== context.workspaceId)) return none
    const currentSettings = await settings()
    if (!currentSettings?.profileActions) return none
    const list = await host.call('workspace.list', {})
    const matches = (list.workspaces ?? []).filter(w => w.id === context.workspaceId)
    if (list.truncated || matches.length !== 1) return none
    const ws = matches[0]
    if (ws.kind !== 'worktree' || ws.hostId !== 'local' || !ws.projectId || !isAbsolute(ws.path ?? '') || !ws.branch || branchName(ws.branch) !== branchName(context.branch)) return none
    const profiles = (await getProfiles()).filter(p => p.enabled && ws.projectId.startsWith(p.projectPrefix))
    if (profiles.length > 1) return {state:'conflict'}
    if (!profiles.length) return none
    const profile = profiles[0]
    const publication = selection?.legacyPublication
    if (publication) {
      const snapshotPath = publication.cwd && await realpath(publication.cwd).catch(() => null)
      const workspacePath = await realpath(ws.path).catch(() => null)
      if (selection?.scope !== 'worktree' || !snapshotPath || !workspacePath || snapshotPath !== workspacePath ||
          branchName(publication.branch) !== branchName(ws.branch)) return none
    }
    const review = knownReview(summary, profile)
    const projectList = await host.call('project.list', {})
    const projectMatches = (projectList.projects ?? []).filter(p => p.id === ws.projectId && p.hostId === 'local' && p.kind === 'git')
    if (projectList.truncated || projectMatches.length !== 1) return none
    const repo = basename(projectMatches[0].path)
    if (!ref(repo) || !ref(branchName(ws.branch)) || (publication?.repo && publication.repo !== repo)) return none
    const proposed = publication?.mr
    const hasReviewStep = profile.steps.some(step => step.kind === 'review')
    const originalDraft = proposed && line(proposed.title, 1000) && plain(proposed.description, 16000) && ref(proposed.base)
      ? {title:proposed.title, description:proposed.description, base:proposed.base} : {title:'', description:'', base:''}
    if (draft !== undefined && (!hasReviewStep || !draft || !plain(draft.title, 1000) || /[\r\n]/u.test(draft.title) ||
      !plain(draft.description, 16000) || !(draft.base === '' || ref(draft.base)))) throw Error('Invalid review draft.')
    const selectedDraft = draft ?? originalDraft
    const values = {'{repo}':repo, '{branch}':branchName(ws.branch), '{base}':selectedDraft.base, '{title}':selectedDraft.title, '{description}':selectedDraft.description}
    const actions = profile.steps.filter(step => step.kind !== 'review' || (line(selectedDraft.title, 1000) && ref(selectedDraft.base))).filter(step => step.argv.every(arg => !substitutions.has(arg) || typeof values[arg] === 'string' && (arg !== '{base}' || ref(values[arg])) && (arg !== '{title}' || line(values[arg], 1000)))).map(step => {
      const args = step.argv.map(arg => substitutions.has(arg) ? values[arg] : arg)
      const command = profile.shell === 'powershell'
        ? `Set-Location -LiteralPath ${quote(ws.path, profile.shell)} -ErrorAction Stop; & ${args.map(arg => quote(arg, profile.shell)).join(' ')}`
        : `cd ${quote(ws.path, profile.shell)} && ${args.map(arg => quote(arg, profile.shell)).join(' ')}`
      return {label:step.label, command}
    })
    const custom = Boolean(review && reviewLink(review.url, profile.reviewHost) && await trustedOpener(profile))
    const latest = await focused()
    const active = await host.call('workspace.readContext')
    if (JSON.stringify(latest) !== JSON.stringify(selection) || active?.workspaceId !== context.workspaceId || active.branch !== context.branch) throw Error('The active workspace changed. Refresh the panel.')
    const key = digest([context.workspaceId, context.branch, selection, ws, profile, selectedDraft, review, custom])
    const common = {key, preferred:currentSettings.commandAction === 'terminal' ? 'terminal' : 'copy', destination:`${profile.name} · ${projectMatches[0].name} · ${branchName(ws.branch)}`}
    if (review) return {state:'review', ...common, review:{...review, custom}}
    if (profile.excludeBranchPrefix && branchName(ws.branch).startsWith(profile.excludeBranchPrefix)) return {state:'none'}
    if (!actions.length && !hasReviewStep) return {state:'none'}
    return {state:'actions', ...common, actions, ...(hasReviewStep ? {draft:selectedDraft} : {})}
  }
  orca.panels.handle('workflow.view', async ({draft, key} = {}) => {
    if (draft !== undefined) await fresh(key, 'actions')
    const result = await view(draft)
    if (draft !== undefined) await fresh(key, 'actions')
    if (result.key) { issued.clear(); issued.set(result.key, draft) }
    return result
  })
  async function fresh(key, state) {
    if (typeof key !== 'string' || !issued.has(key)) throw Error('The workflow changed. Refresh the panel.')
    const result = await view(issued.get(key))
    if (result.key !== key || result.state !== state) throw Error('The workflow changed. Refresh the panel.')
    return result
  }
  orca.panels.handle('workflow.terminal', async ({key} = {}) => {
    await fresh(key, 'actions')
    const context = await host.call('workspace.readContext')
    await fresh(key, 'actions')
    const result = await host.call('terminal.create', {workspaceId:context.workspaceId, title:'Workflow'})
    if (!result?.terminalId) throw Error('Orca did not open a terminal.')
    await fresh(key, 'actions')
    const focusedTerminal = await host.call('terminal.focus', {terminalId:result.terminalId})
    if (!focusedTerminal?.focused) throw Error('Orca did not focus the terminal.')
    return {message:'Terminal opened. Copy and paste a command to run it.'}
  })
  orca.panels.handle('workflow.openReview', async ({key} = {}) => {
    const result = await fresh(key, 'review')
    if (!result.review.custom) throw Error('This opener is not trusted.')
    const context = await host.call('workspace.readContext')
    const list = await host.call('workspace.list', {})
    const ws = list.workspaces?.find(w => w.id === context?.workspaceId)
    const profile = (await getProfiles()).find(p => p.enabled && ws?.projectId?.startsWith(p.projectPrefix))
    if (!profile || !await trustedOpener(profile)) throw Error('This opener is not trusted.')
    await fresh(key, 'review')
    const argv = profile.openReview.map(arg => arg === '{url}' ? result.review.url : arg)
    await run(argv[0], argv.slice(1), {timeout:15000, maxBuffer:16384, windowsHide:true})
    return {message:'Review opener started.'}
  })
  return async (profile, enable) => {
    await save({profile: {...profile, enabled: enable}})
    if (enable) {
      try { await host.call('settings.set', { key: 'profileActions', value: true }) }
      catch { return { commandsOff: true } }
    }
  }
}
