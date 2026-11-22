import { renderMarkdown } from './summary-markdown.mjs'

const api = window.orca
const main = document.querySelector('main')
const status = document.querySelector('#status')
const dialog = document.querySelector('#settings-dialog')
const preferenceGroups = dialog.querySelectorAll('.preference-group')
const guide = dialog.querySelector('#summary-guide')
const workflows = dialog.querySelector('#workflow-profiles')
const settingsStatus = document.querySelector('#settings-status')
const form = document.querySelector('#profile-form')
const profileStatus = document.querySelector('#profile-status')
const steps = document.querySelector('#profile-steps')
const preview = document.querySelector('#project-preview')
const drafts = new Map()
const dirtyDrafts = new Set()
let profileId, imported = false, previewedPrefix, generation = 0, listening = false, rendered

function node(tag, text, parent, className) {
  const element = document.createElement(tag)
  if (text !== undefined && text !== null) element.textContent = String(text)
  if (className) element.className = className
  parent.append(element)
  return element
}
function button(parent, text, action) {
  const element = node('button', text, parent)
  element.type = 'button'
  element.addEventListener('click', action)
  return element
}
function message(error, fallback) { return error instanceof Error && error.message ? `${fallback} ${error.message}` : fallback }
async function request(name, input = {}) { return api.plugin.request(name, input) }
async function openExternal(url) {
  const result = await api.shell.openExternal(url)
  if (result?.opened === false) throw Error('Opening the link was cancelled.')
}
async function run(control, action, success, failure, output = status) {
  control.disabled = true
  try { await action(); output.textContent = success }
  catch (error) { output.textContent = message(error, failure) }
  finally { control.disabled = false }
}
async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return }
  } catch {}
  const previous = document.activeElement
  const input = document.createElement('textarea')
  input.value = text
  input.setAttribute('aria-label', 'Text to copy')
  input.style.position = 'fixed'
  input.style.left = '-9999px'
  const container = dialog.open ? dialog : document.body
  container.append(input)
  input.select()
  try {
    if (!document.execCommand('copy')) throw Error('Select the text and copy it instead.')
  } finally {
    input.remove()
    previous?.focus()
  }
}
function openProseLink(control, url) {
  return run(control, () => openExternal(url), 'Link opened.', 'Could not open link.')
}
function fields(parent, rows) {
  const populated = rows.filter(([, value]) => value !== undefined && value !== null && value !== '')
  if (!populated.length) return
  const dl = node('dl', undefined, parent)
  for (const [label, value] of populated) {
    node('dt', label, dl)
    renderMarkdown(node('dd', undefined, dl), Array.isArray(value) ? value.join('\n') : value, openProseLink, true)
  }
}
function links(parent, items, skipReview = false) {
  if (!items || typeof items !== 'object') return
  const entries = Object.entries(items).filter(([label, url]) => typeof url === 'string' && (!skipReview || !['MR', 'PR'].includes(label)))
  if (!entries.length) return
  const nav = node('nav', undefined, parent)
  nav.setAttribute('aria-label', 'Links')
  for (const [label, url] of entries) {
    button(nav, label, event => run(event.currentTarget, () => openExternal(url), 'Link opened.', 'Could not open link.'))
  }
}
async function showFrame(parent, label, title, id, hash) {
  const figure = node('figure', undefined, parent)
  node('figcaption', label, figure)
  const box = node('div', 'Loading image...', figure, 'frame')
  try {
    const data = await request('frame', { id, hash })
    if (!box.isConnected) return
    if (typeof data !== 'string') throw Error('Invalid image')
    box.replaceChildren()
    const toggle = button(box, undefined, () => toggle.setAttribute('aria-pressed', String(box.classList.toggle('zoom'))))
    toggle.setAttribute('aria-label', `${title}, ${label}. Toggle full size`)
    toggle.setAttribute('aria-pressed', 'false')
    const image = node('img', undefined, toggle)
    image.alt = `${title}, ${label}`
    image.onerror = () => { box.textContent = 'Could not display image.' }
    image.src = `data:image/png;base64,${data}`
  } catch { if (box.isConnected) box.textContent = 'Image unavailable.' }
}
function drawSummary(view, workflow) {
  if (view.scope === 'manual') {
    if (manualKey) main.append(document.querySelector('#manual-welcome').content.cloneNode(true))
    else node('p', 'Select a session in Orca to load its brief.', main, 'empty-hint')
    return
  }
  if (view.scope === 'excluded') {
    node('h2', 'Summaries are off', main)
    node('p', view.excluded === 'unverified' ? 'Orca could not confirm whether this selection is excluded. Its reports and history were not read.' : `This ${view.excluded} is excluded. Its reports and history were not read.`, main)
    button(main, 'Manage exclusions', () => { exclusionsPanel.open = true; openSettings() }).className = 'guide-link'
    return
  }
  const header = node('header', undefined, main)
  if (view.title) node('h1', view.title, header)
  if (view.outcome) {
    const section = node('section', undefined, main, 'history')
    node('h2', 'From session history', section)
    renderMarkdown(node('div', undefined, section), view.outcome, openProseLink)
    return
  }
  const summary = view.summary
  if (!summary) {
    const hints = {
      waiting: view.manual ? 'No completed reply yet. Refresh after this turn finishes.' : 'No completed reply yet. The first one will appear here when this turn finishes.',
      historyOff: 'No saved session report. Turn on “Use the agent’s last reply” to read its history.',
      pairedOff: 'Paired history is off. Enable it in Settings or save a session report.',
      unavailable: 'Could not verify this session on its paired server. Check the connection or use a saved report.',
      noReply: 'No reply is available from this session’s history yet. Ask the agent for a short recap.'
    }
    node('p', hints[view.emptyReason] || 'Select an agent tab in Orca to see its summary.', main, 'empty-hint')
    button(main, 'How summaries work', () => openSettings(true)).className = 'guide-link'
    return
  }
  node('p', view.scope === 'worktree' ? 'Shared with this worktree' : 'Saved for this session', header, 'muted')
  fields(header, [['Goal', summary.goal], ['Done', summary.done], ['Next', summary.next]])
  const result = summary.result
  if (result) {
    const section = node('section', undefined, main, `result ${result.status === 'blocked' ? 'blocked' : ''}`)
    const heading = node('div', undefined, section, 'result-head')
    node('h2', 'Result', heading)
    if (result.status) node('span', ({ completed: 'Completed', partial: 'Partial', blocked: 'Blocked' })[result.status] || result.status, heading)
    fields(section, [['Changes', result.changes], ['Checks', result.checks], ['Limits', result.limits]])
    links(section, result.links, workflow?.state === 'review')
    if (result.questions?.length) {
      const questions = node('section', undefined, main, 'attention')
      node('h2', 'Open questions', questions)
      for (const question of result.questions) {
        const item = node('div', undefined, questions, 'question')
        renderMarkdown(node('h3', undefined, item), question.question, openProseLink, true)
        fields(item, [['Owner', question.owner], ['Impact', question.impact]])
      }
    }
    if (result.noPair || result.pairs?.length) {
      const gallery = node('section', undefined, main)
      node('h2', 'Before and after', gallery)
      if (result.noPair) renderMarkdown(node('p', undefined, gallery), result.noPair, openProseLink, true)
      for (const pair of result.pairs || []) {
        const details = node('details', undefined, gallery)
        details.open = true
        node('summary', pair.title, details)
        node('small', 'Select an image to toggle full size.', details)
        void showFrame(details, 'Before', pair.title, view.workspaceId, pair.before)
        void showFrame(details, 'After', pair.title, view.workspaceId, pair.after)
      }
    }
  }
  if (summary.links && Object.keys(summary.links).length) {
    const footer = node('footer', undefined, main)
    node('h2', 'Links', footer)
    links(footer, summary.links)
  }
}
function drawWorkflow(workflow, draftKey) {
  if (!workflow || workflow.state === 'none') return
  const section = node('section', undefined, main)
  if (workflow.state === 'conflict') {
    node('h2', 'Profile conflict', section)
    node('p', 'More than one enabled profile matches this project. Change the profiles to choose one.', section)
    return
  }
  if (workflow.state === 'review' && workflow.review) {
    node('h2', 'Review', section)
    const review = workflow.review
    button(section, review.label || 'Open review', event => run(event.currentTarget,
      () => review.custom ? request('workflow.openReview', { key: workflow.key }) : openExternal(review.url),
      review.custom ? 'Review opener request accepted.' : 'Review opened.', 'Could not open review.'))
    return
  }
  if (workflow.state !== 'actions') return
  node('h2', 'Next action', section)
  if (workflow.destination) node('p', workflow.destination, section, 'muted')
  const addTerminal = () => button(section, 'Open terminal', event => run(event.currentTarget,
    () => request('workflow.terminal', { key: workflow.key }), 'Terminal opened. Paste the command to run it.', 'Could not open terminal.'))
  if (workflow.actions?.length && workflow.preferred === 'terminal') addTerminal()
  const copyButtons = []
  for (const action of workflow.actions || []) {
    const box = node('div', undefined, section, 'command')
    node('strong', action.label, box)
    node('pre', action.command, box)
    const copy = button(box, 'Copy command', event => run(event.currentTarget, () => copyText(action.command), 'Copied.', 'Could not copy command.'))
    copy.disabled = dirtyDrafts.has(draftKey)
    copyButtons.push(copy)
  }
  if (workflow.actions?.length && workflow.preferred !== 'terminal') addTerminal()
  if (workflow.draft) {
    const details = node('details', undefined, section)
    details.dataset.draftKey = draftKey
    node('summary', 'Edit draft', details)
    const draft = drafts.get(draftKey) || { ...workflow.draft }
    const warning = node('p', dirtyDrafts.has(draftKey) ? 'Update commands before copying.' : '', details)
    warning.setAttribute('role', 'status')
    drafts.set(draftKey, draft)
    const titleLabel = node('label', 'Title', details)
    const title = node('input', undefined, titleLabel)
    title.dataset.draftField = 'title'
    title.value = draft.title || ''
    const baseLabel = node('label', 'Base branch', details)
    const base = node('input', undefined, baseLabel)
    base.dataset.draftField = 'base'
    base.value = draft.base || ''
    const descriptionLabel = node('label', 'Description', details)
    const description = node('textarea', undefined, descriptionLabel)
    description.dataset.draftField = 'description'
    description.rows = 6
    description.value = draft.description || ''
    const changed = () => {
      generation++
      dirtyDrafts.add(draftKey)
      for (const copy of copyButtons) copy.disabled = true
      warning.textContent = 'Update commands before copying.'
    }
    title.addEventListener('input', () => { draft.title = title.value; changed() })
    base.addEventListener('input', () => { draft.base = base.value; changed() })
    description.addEventListener('input', () => { draft.description = description.value; changed() })
    button(details, 'Update commands', () => { dirtyDrafts.delete(draftKey); rendered = undefined; void refresh(false, true, manualKey) })
    button(details, 'Clear description', () => { description.value = ''; draft.description = ''; changed(); description.focus() })
  }
}
const loading = document.querySelector('#loading')
let draftFocus
function showLoading(leaving = false) {
  if (main.getAttribute('aria-busy') !== 'true') {
    const field = document.activeElement
    const editor = field?.closest('details[data-draft-key]')
    draftFocus = field?.dataset.draftField && editor
      ? { key: editor.dataset.draftKey, name: field.dataset.draftField, start: field.selectionStart, end: field.selectionEnd } : null
    main.setAttribute('aria-busy', 'true')
    status.textContent = ''
  }
  if (leaving) main.inert = true
}
const activity = document.querySelector('#agent-working'), refreshBrief = document.querySelector('#refresh-brief')
const manualLoad = document.querySelector('#manual-load')
let manualKey
manualLoad.addEventListener('click', () => { if (manualKey) void refresh(false, true, manualKey) })
let displayedContext, hasBrief = false, pointerReading = false
let pauseWhileReading = true
main.addEventListener('wheel', () => { pointerReading = true }, { passive: true })
main.addEventListener('pointerdown', () => { pointerReading = true })
main.addEventListener('pointerleave', () => { pointerReading = false })
const reading = () => document.hasFocus() || pointerReading || !window.getSelection()?.isCollapsed
const holdUpdate = () => pauseWhileReading && hasBrief && (reading() || !refreshBrief.hidden)
function resetReader() {
  manualKey = undefined
  manualLoad.hidden = true
  displayedContext = undefined
  hasBrief = pointerReading = false
  activity.hidden = refreshBrief.hidden = true
}
refreshBrief.addEventListener('click', async () => {
  const before = window.scrollY, context = displayedContext
  await refresh(false, true)
  if (context === displayedContext && refreshBrief.hidden) {
    main.focus({ preventScroll: true })
    window.scrollTo(0, before)
  }
})
async function refresh(leaving = false, apply = true, loadFor) {
  if (document.hidden) return
  const ticket = ++generation
  showLoading(leaving)
  if (loadFor) manualLoad.disabled = true
  listening = true
  const input = loadFor ? { loadFor } : {}
  try {
    const [result, workflowResult] = await Promise.all([
      request('summary.focused', { listen: true, ...input }),
      request('workflow.view', input).then(value => ({ value }), error => ({ error }))
    ])
    const original = workflowResult.value
    let workflow = original
    if (original?.key && drafts.has(original.key) && original.draft && !dirtyDrafts.has(original.key)) {
      try { workflow = await request('workflow.view', { ...input, draft: drafts.get(original.key), key: original.key }) }
      catch (error) { workflowResult.error = error; workflow = null }
    }
    if (ticket !== generation || document.hidden) return
    const { working, contextKey, ...view } = result
    manualKey = view.manual ? contextKey : undefined
    manualLoad.hidden = !manualKey
    if (view.scope === 'manual' && manualKey === displayedContext && rendered !== undefined) return
    manualLoad.textContent = view.scope === 'manual' ? 'Load brief' : 'Refresh brief'
    activity.hidden = !working || view.manual
    sourceHint = working && !view.manual ? 'Choose an agent now. Preview is available when this turn finishes.' :
      view.scope === 'excluded' ? 'Summaries are off for this selection.' :
      view.emptyReason === 'pairedOff' ? 'Turn on paired session history to preview a recap.' :
      view.scope === 'none' ? 'Select a finished agent conversation to preview a recap.' : ''
    updatePreviewControl()
    const key = JSON.stringify([view, workflow, workflowResult.error?.message, original?.key && dirtyDrafts.has(original.key)])
    if (key === rendered && contextKey === displayedContext) { refreshBrief.hidden = true; return }
    if (!apply && !leaving && displayedContext === contextKey && view.scope !== 'excluded' && holdUpdate()) {
      refreshBrief.hidden = false
      return
    }
    refreshBrief.hidden = true
    displayedContext = contextKey
    hasBrief = Boolean(view.summary || view.outcome)
    const editor = main.querySelector('details[data-draft-key]')
    const openKey = editor?.open ? editor.dataset.draftKey : null
    rendered = key
    main.replaceChildren()
    drawSummary(view, workflow)
    drawWorkflow(workflow, original?.key)
    if (workflowResult.error) node('p', message(workflowResult.error, 'Could not load workflow actions.'), main)
    const nextEditor = main.querySelector('details[data-draft-key]')
    if (nextEditor?.dataset.draftKey === openKey) nextEditor.open = true
  } catch (error) {
    if (ticket !== generation || document.hidden) return
    if (!leaving && !apply && holdUpdate()) { refreshBrief.hidden = false; return }
    rendered = undefined
    main.replaceChildren()
    node('p', message(error, 'Could not load summary.'), main)
  } finally {
    if (ticket === generation && !document.hidden) {
      manualLoad.disabled = false
      loading.hidden = true
      main.inert = false
      main.setAttribute('aria-busy', 'false')
      main.hidden = false
      if (draftFocus && document.activeElement === document.body) {
        const editor = main.querySelector('details[data-draft-key]')
        if (editor?.dataset.draftKey === draftFocus.key) {
          const field = editor.querySelector(`[data-draft-field="${draftFocus.name}"]`)
          editor.open = true
          field?.focus()
          field?.setSelectionRange(draftFocus.start, draftFocus.end)
        }
      }
      draftFocus = null
    }
  }
}
function pause() {
  generation++
  main.inert = true
  main.hidden = true
  resetReader()
  main.setAttribute('aria-busy', 'true')
  if (listening) { listening = false; void request('summary.closed').catch(() => {}) }
}
api.plugin.on('summary.changed', ({ reason } = {}) => {
  const privateChange = reason === 'exclusions' || reason === 'history-setting'
  const leaving = reason === 'workspace' || reason === 'selection' || privateChange
  if (privateChange || (leaving && manualKey)) { main.replaceChildren(); main.hidden = true; rendered = undefined }
  if (leaving) resetReader()
  if (leaving || reason === 'session' || reason === 'settings') clearRecap()
  void refresh(leaving, false)
  if (dialog.open && leaving) void loadPreferences()
  if (dialog.open && exclusionsPanel.open && (leaving || reason === 'session')) void loadExclusions()
})
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); else void refresh() })
window.addEventListener('pagehide', pause, { once: true })

function argumentsOf(value) { return value.split(/\r?\n/).filter(line => line.trim()) }
function addStep(step = {}) {
  const box = node('div', undefined, steps, 'step')
  const label = node('label', 'Action label', box)
  const name = node('input', undefined, label)
  name.value = step.label || ''
  name.required = true
  const kindLabel = node('label', 'Action kind', box)
  const kind = node('select', undefined, kindLabel)
  for (const value of ['push', 'review']) { const option = node('option', value === 'push' ? 'Push' : 'Prepare review', kind); option.value = value }
  kind.value = step.kind || 'push'
  const argvLabel = node('label', 'Arguments, one per line', box)
  const argv = node('textarea', undefined, argvLabel)
  argv.rows = 4
  argv.required = true
  argv.value = (step.argv || []).join('\n')
  button(box, 'Remove action', () => box.remove())
}
function editProfile(profile, isImported = false) {
  form.reset()
  profileId = profile.id || crypto.randomUUID()
  imported = isImported
  previewedPrefix = undefined
  preview.replaceChildren()
  steps.replaceChildren()
  form.elements.name.value = profile.name || ''
  form.elements.enabled.checked = isImported ? false : !!profile.enabled
  form.elements.enabled.disabled = isImported
  form.elements.projectPrefix.value = profile.projectPrefix || ''
  form.elements.excludeBranchPrefix.value = profile.excludeBranchPrefix || ''
  form.elements.reviewHost.value = profile.reviewHost || 'github.com'
  form.elements.shell.value = profile.shell || 'posix'
  form.elements.openReview.value = (profile.openReview || []).join('\n')
  form.elements.trustOpener.checked = false
  document.querySelector('#opener-trust').hidden = isImported
  document.querySelector('#import-trust-note').hidden = !isImported
  document.querySelector('#profile-form-title').textContent = isImported ? 'Import profile' : profile.name ? 'Edit profile' : 'New profile'
  for (const step of profile.steps || []) addStep(step)
  document.querySelector('#advanced-profile').open = false
  void previewProjects()
  form.hidden = false
  form.elements.name.focus()
}
async function listProfiles() {
  const list = document.querySelector('#profile-list')
  try {
    const result = await request('profiles.list')
    list.replaceChildren()
    const available = document.querySelector('#available-projects')
    available.replaceChildren(new Option('Choose a project…', ''), ...(result.projects || []).map(p => new Option(p.name, p.id)))
    available.value = form.elements.projectPrefix.value
    for (const profile of result.profiles) {
      const entry = node('div', undefined, list, 'profile-entry')
      node('strong', profile.name, entry)
      node('span', profile.enabled ? ' (enabled)' : ' (disabled)', entry)
      const controls = node('div', undefined, entry, 'row')
      button(controls, 'Edit', () => editProfile(profile))
      button(controls, 'Remove', async event => {
        if (!window.confirm(`Remove profile "${profile.name}"?`)) return
        await run(event.currentTarget, async () => { await request('profiles.delete', { id: profile.id }); if (profileId === profile.id) form.hidden = true; await listProfiles(); rendered = undefined; void refresh() }, 'Profile removed.', 'Could not remove profile.', profileStatus)
      })
    }
    if (result.truncated) node('p', 'The project list is incomplete.', list, 'muted')
  } catch (error) { profileStatus.textContent = message(error, 'Could not load profiles.') }
}
let settingsRevision = 0
async function loadPreferences() {
  const revision = ++settingsRevision
  try {
    const values = await api.settings.get()
    if (revision !== settingsRevision) return
    const resume = pauseWhileReading && values.pauseWhileReading === false && !refreshBrief.hidden
    pauseWhileReading = values.pauseWhileReading !== false
    if (resume) void refresh(false, true)
    document.querySelector('#panel-icon').hidden = values.showPanelIcon === false
    for (const group of preferenceGroups) {
      for (const field of group.elements) {
        if (field.type === 'checkbox') field.checked = values[field.name] === true
        else field.value = values[field.name] ?? (field.name === 'summaryStrategy' ? 'brief' : '')
      }
      group.disabled = false
    }
    for (const key of ['autoOpen', 'pauseWhileReading']) dialog.querySelector(`[name="${key}"]`).disabled = values.manualLoad === true
    document.querySelector('#load-mode-hint').textContent = values.manualLoad ? 'On: use Load brief or Refresh brief in the panel.' : 'Off: the brief follows your selected session.'
    await showStrategy(values, revision)
    document.querySelector('#command-order').hidden = values.profileActions !== true
  } catch (error) {
    if (revision === settingsRevision) settingsStatus.textContent = message(error, 'Could not read settings.')
  }
}
const recapSettings = document.querySelector('#recap-settings')
const recapAgent = document.querySelector('#recap-agent'), recapStatus = document.querySelector('#recap-status')
const previewRecap = document.querySelector('#preview-recap'), startRecap = document.querySelector('#start-recap')
let recapRevision = 0, recapToken, previousMode
const agentHint = document.querySelector('#agent-hint')
const modelInput = document.querySelector('#recap-model'), modelForm = document.querySelector('#recap-model-form')
const saveModel = modelForm.querySelector('button')
const modelChoice = document.querySelector('#model-choice'), addModel = ' add '
const historyKey = agent => `recap-models-${agent}`
let savingChoice = false, currentCatalogKey
let sourceHint = '', listHint = '', historyEnabled = true, recapPending = false
function updatePreviewControl() {
  agentHint.textContent = listHint || (!historyEnabled ? 'Turn on session history to preview a recap.' : sourceHint)
  const editing = !modelForm.hidden
  saveModel.disabled = !modelInput.value.trim() || savingChoice
  modelChoice.disabled = savingChoice || recapAgent.disabled || !recapAgent.value
  previewRecap.disabled = editing || savingChoice || recapPending || recapAgent.disabled || !recapAgent.value || Boolean(agentHint.textContent)
}
function clearRecap() {
  ++recapRevision
  recapToken = undefined
  document.querySelector('#recap-preview').hidden = true
  document.querySelector('#recap-text').textContent = recapStatus.textContent = ''
}
async function showStrategy(values, revision) {
  const mode = values.summaryStrategy ?? 'brief'
  if (mode !== previousMode) { clearRecap(); previousMode = mode }
  const instant = mode === 'instant'
  document.querySelector('#recap-mode-label').textContent = instant ? 'Instant' : mode === 'brief' ? 'Brief' : 'Detailed'
  document.querySelector('#strategy-hint').textContent = instant ? 'Shows existing text. No extra tokens or agent session.' :
    `${mode === 'brief' ? 'Up to 12 recent entries and 3,000 characters; asks for a 90-word recap.' : 'Up to 48 recent entries and 12,000 characters; asks for a 400-word handoff.'} Your agent’s usual usage limits and pricing apply.`
  document.querySelector('#recap-controls').hidden = instant
  if (instant || !dialog.open || !recapSettings.open) return
  const storedModel = (values.recapModel ?? '').trim()
  historyEnabled = values.historyOutcome !== false
  recapAgent.disabled = true
  currentCatalogKey = undefined
  modelForm.hidden = true
  recapAgent.replaceChildren(new Option('Loading agents…', ''))
  listHint = ''
  updatePreviewControl()
  let agents
  try { agents = await request('recap.agents') }
  catch (error) {
    if (revision === settingsRevision && dialog.open) {
      clearRecap()
      recapAgent.replaceChildren(new Option('Agents unavailable', ''))
      listHint = message(error, 'Could not list agents for this workspace.')
      updatePreviewControl()
    }
    return
  }
  if (revision !== settingsRevision || !dialog.open) return
  const chosen = values.recapAgent
  const available = agents.some(a => a.id === chosen)
  recapAgent.replaceChildren(...agents.map(a => new Option(a.name, a.id)))
  if (!agents.length || (chosen && !available)) recapAgent.prepend(new Option(agents.length ? 'Choose an installed agent…' : 'No agents installed', ''))
  recapAgent.value = chosen ? available ? chosen : '' : agents.find(a => a.preferred)?.id ?? agents[0]?.id ?? ''
  recapAgent.disabled = !agents.length
  listHint = !agents.length ? 'Enable an agent in Orca Settings → Agents on this host.' : !recapAgent.value ? 'Your preferred agent is unavailable in this workspace.' : ''
  const agent = recapAgent.value
  const key = agents.find(a => a.id === agent)?.catalogKey
  const [saved, catalog] = await Promise.all([
    agent ? api.storage.get(historyKey(agent)) : null,
    key ? api.storage.get(key) : null
  ])
  if (revision !== settingsRevision || !dialog.open) return
  currentCatalogKey = key
  const reported = Array.isArray(catalog) ? catalog : []
  const ids = new Set(reported.map(m => m.id))
  const choices = new Set([storedModel, ...(Array.isArray(saved) ? saved : [])].filter(m => typeof m === 'string' && m && !ids.has(m)))
  const group = document.createElement('optgroup')
  group.label = 'Reported by ' + (recapAgent.selectedOptions[0]?.textContent ?? agent)
  for (const { id, name } of reported) {
    const option = new Option(name && name !== id ? `${name} · ${id}` : id, id)
    group.append(option)
  }
  modelChoice.replaceChildren(new Option('Use agent’s default', ''), ...(group.children.length ? [group] : []), ...Array.from(choices, m => new Option(m, m)), new Option('Add a model…', addModel))
  modelChoice.value = storedModel
  modelForm.hidden = true
  document.querySelector('#model-help').textContent = `Copy the exact identifier from ${recapAgent.selectedOptions[0]?.textContent || 'the agent'}’s model picker or settings. Threadbrief remembers it here.`
  updatePreviewControl()
}
dialog.addEventListener('close', clearRecap)
modelInput.addEventListener('input', updatePreviewControl)
async function saveChoice(agent, model, remember = false) {
  if (savingChoice) return
  clearRecap()
  savingChoice = recapAgent.disabled = true
  updatePreviewControl()
  try {
    if (!agent) throw Error('Choose an installed Orca agent first.')
    if (remember) {
      const key = historyKey(agent), saved = await api.storage.get(key)
      await api.storage.set(key, [model, ...(Array.isArray(saved) ? saved.filter(m => m !== model) : [])].slice(0, 16))
    }
    if (agent !== await api.settings.get('recapAgent')) {
      await api.settings.set('recapModel', '')
      await api.settings.set('recapAgent', agent)
    }
    await api.settings.set('recapModel', model)
  } catch (error) { recapStatus.textContent = message(error, 'Could not save your selection.') }
  finally { savingChoice = false; await loadPreferences() }
}
modelChoice.addEventListener('change', () => {
  clearRecap()
  modelForm.hidden = modelChoice.value !== addModel
  if (modelForm.hidden) { void saveChoice(recapAgent.value, modelChoice.value); return }
  modelInput.value = ''
  modelInput.focus()
  updatePreviewControl()
})
modelForm.addEventListener('submit', event => {
  event.preventDefault()
  const model = modelInput.value.trim()
  if (!model || /^-/u.test(model) || /\s|[\u0000-\u001f\u007f]/u.test(model)) { recapStatus.textContent = 'Paste the identifier, not the display name. It cannot contain spaces.'; return }
  void saveChoice(recapAgent.value, model, true)
})
recapAgent.addEventListener('change', () => { void saveChoice(recapAgent.value, '') })
previewRecap.addEventListener('click', async () => {
  clearRecap()
  const revision = recapRevision
  recapPending = true
  updatePreviewControl()
  try {
    const p = await request('recap.preview', { agent: recapAgent.value })
    if (revision !== recapRevision) return
    recapToken = p.token
    document.querySelector('#recap-destination').textContent = `${p.title} → ${p.agent} / ${p.model || 'Agent default'} on ${p.environment} · ${p.prompt.length.toLocaleString()} characters including instructions`
    document.querySelector('#recap-text').textContent = p.prompt
    document.querySelector('#recap-preview').hidden = false
  } catch (error) { if (revision === recapRevision) recapStatus.textContent = message(error, 'Could not preview recap.') }
  finally { recapPending = false; updatePreviewControl() }
})
startRecap.addEventListener('click', async () => {
  const token = recapToken
  if (!token) return
  clearRecap()
  startRecap.disabled = recapPending = true
  updatePreviewControl()
  try {
    const { focused } = await request('recap.start', { token })
    if (focused && dialog.open) dialog.close()
    else recapStatus.textContent = 'Recap session started. Select the new agent terminal to read its reply.'
  } catch (error) { recapStatus.textContent = message(error, 'Check Orca for a new agent session before trying again.') }
  finally { startRecap.disabled = recapPending = false; updatePreviewControl() }
})
dialog.addEventListener('change', async ({ target }) => {
  if (!target.closest('.preference-group')) return
  for (const group of preferenceGroups) group.disabled = true
  ++settingsRevision
  try {
    await api.settings.set(target.name, target.type === 'checkbox' ? target.checked : target.value)
    settingsStatus.textContent = 'Saved.'
  } catch (error) {
    settingsStatus.textContent = message(error, 'Could not save setting.')
  } finally {
    await loadPreferences()
  }
})
api.settings.onDidChange(({ key }) => {
  if (key === 'recapAgent' || key === 'recapModel') clearRecap()
  if (dialog.open || key === 'showPanelIcon' || key === 'pauseWhileReading') void loadPreferences()
})
api.storage.onDidChange(({ key }) => {
  if (key === currentCatalogKey && dialog.open && recapSettings.open && modelForm.hidden) void loadPreferences()
})
const exclusionsPanel = document.querySelector('#exclusions')
const exclusionStatus = document.querySelector('#exclusion-status')
let rulesRevision = 0
async function loadExclusions() {
  const revision = ++rulesRevision
  const choices = document.querySelector('#exclusion-choices'), saved = document.querySelector('#exclusion-list')
  try {
    const result = await request('exclusions.list')
    if (revision !== rulesRevision) return
    choices.replaceChildren()
    saved.replaceChildren()
    const row = (parent, rule, excluded, exists = false) => {
      const item = node('div', undefined, parent, 'rule')
      const label = node('span', undefined, item)
      node('small', rule.kind[0].toUpperCase() + rule.kind.slice(1), label)
      node('span', rule.label, label).title = `${rule.host}: ${rule.id}`
      const control = button(item, exists ? 'Excluded' : excluded ? 'Exclude' : 'Remove', event => run(event.currentTarget, async () => {
        await request('exclusions.set', { kind: rule.kind, id: rule.id, host: rule.host, excluded })
        await loadExclusions()
      }, excluded ? 'Exclusion saved.' : 'Exclusion removed.', 'Could not change exclusion.', exclusionStatus))
      control.disabled = exists
      control.setAttribute('aria-label', `${control.textContent}: ${rule.kind} ${rule.label}`)
    }
    for (const r of result.choices) row(choices, r, true, result.rules.some(s => s.kind === r.kind && s.host === r.host && s.id === r.id))
    if (!result.choices.length) node('p', 'No confirmed selection to exclude.', choices, 'muted')
    for (const r of result.rules) row(saved, r, false)
    if (!result.rules.length) node('p', 'No exclusions.', saved, 'muted')
  } catch (error) {
    if (revision !== rulesRevision) return
    choices.replaceChildren()
    saved.replaceChildren()
    exclusionStatus.textContent = message(error, 'Could not load exclusions.')
  }
}
exclusionsPanel.addEventListener('toggle', () => { if (exclusionsPanel.open && dialog.open) void loadExclusions() })
function openSettings(showGuide = false) {
  profileStatus.textContent = settingsStatus.textContent = document.querySelector('#copy-status').textContent = ''
  for (const group of preferenceGroups) group.disabled = true
  if (showGuide) guide.open = true
  dialog.showModal()
  if (showGuide) guide.querySelector('summary').focus()
  void loadPreferences()
  if (exclusionsPanel.open) void loadExclusions()
  if (workflows.open) void listProfiles()
}
document.querySelector('#open-settings').addEventListener('click', () => openSettings())
recapSettings.addEventListener('toggle', () => {
  if (recapSettings.open && dialog.open) void loadPreferences()
  else clearRecap()
})
workflows.addEventListener('toggle', () => { if (workflows.open && dialog.open) void listProfiles() })
document.querySelector('#copy-prompt').addEventListener('click', event => run(event.currentTarget,
  () => copyText(document.querySelector('#recap-prompt').textContent), 'Copied. Paste it into your agent conversation.', 'Could not copy the prompt.', document.querySelector('#copy-status')))
document.querySelector('#choose-profile').addEventListener('click', () => document.querySelector('#import-profile').click())
document.querySelector('#close-settings').addEventListener('click', () => dialog.close())
document.querySelector('#new-profile').addEventListener('click', () => editProfile({}))
document.querySelector('#cancel-profile').addEventListener('click', () => { form.hidden = true })
document.querySelector('#add-step').addEventListener('click', () => addStep())
form.elements.projectPrefix.addEventListener('input', () => { previewedPrefix = undefined; preview.replaceChildren() })
for (const name of ['projectPrefix', 'reviewHost', 'openReview']) {
  form.elements[name].addEventListener('input', () => { form.elements.trustOpener.checked = false })
}
async function previewProjects() {
  const prefix = form.elements.projectPrefix.value
  if (!prefix.trim()) return
  try {
    const result = await request('profiles.preview', { projectPrefix: prefix })
    if (prefix !== form.elements.projectPrefix.value) return
    preview.textContent = result.projects.length ? `Matches: ${result.projects.map(p => p.name).join(', ')}${result.truncated ? ' (partial list)' : ''}` : 'No matching project on this host yet.'
    previewedPrefix = prefix
  } catch (error) { if (prefix === form.elements.projectPrefix.value) profileStatus.textContent = message(error, 'Could not check projects.') }
}
form.elements.projectPrefix.addEventListener('change', previewProjects)
document.querySelector('#available-projects').addEventListener('change', ({ target }) => {
  form.elements.projectPrefix.value = target.value
  form.elements.projectPrefix.dispatchEvent(new Event('input'))
  void previewProjects()
})
document.querySelector('#import-profile').addEventListener('change', async event => {
  const input = event.currentTarget
  const file = input.files?.[0]
  if (!file) return
  try {
    if (file.size > 1024 * 1024) throw Error('Profile files must be no larger than 1 MiB.')
    const profile = JSON.parse(await file.text())
    if (!profile || typeof profile !== 'object' || Array.isArray(profile) || !Array.isArray(profile.steps) || (profile.openReview !== undefined && !Array.isArray(profile.openReview)) || profile.steps.some(step => !step || !Array.isArray(step.argv))) throw Error('Expected a profile object with action argument arrays.')
    editProfile({ ...profile, id: crypto.randomUUID(), enabled: false }, true)
    profileStatus.textContent = 'Review the imported fields and matching projects before saving. The profile starts disabled.'
  } catch (error) { profileStatus.textContent = message(error, 'Could not import profile.') }
  finally { input.value = '' }
})
form.addEventListener('submit', async event => {
  event.preventDefault()
  const prefix = form.elements.projectPrefix.value
  if (previewedPrefix !== prefix) await previewProjects()
  if (previewedPrefix !== prefix || form.elements.projectPrefix.value !== prefix) return
  const opener = argumentsOf(form.elements.openReview.value)
  const profile = {
    id: profileId, name: form.elements.name.value, enabled: imported ? false : form.elements.enabled.checked,
    projectPrefix: prefix, reviewHost: form.elements.reviewHost.value, shell: form.elements.shell.value,
    steps: [...steps.querySelectorAll('.step')].map(box => ({ label: box.querySelector('input').value, kind: box.querySelector('select').value, argv: argumentsOf(box.querySelector('textarea').value) }))
  }
  if (form.elements.excludeBranchPrefix.value) profile.excludeBranchPrefix = form.elements.excludeBranchPrefix.value
  if (opener.length) profile.openReview = opener
  const save = form.querySelector('[type=submit]')
  await run(save, async () => {
    const input = { profile }
    if (!imported && opener.length && form.elements.trustOpener.checked) input.trustOpener = true
    await request('profiles.save', input)
    form.hidden = true
    await listProfiles()
    rendered = undefined
    void refresh()
  }, 'Profile saved.', 'Could not save profile.', profileStatus)
})
void loadPreferences()
void refresh()
