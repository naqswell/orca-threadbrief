const api = window.orca
const main = document.querySelector('main')
const status = document.querySelector('#status')
const dialog = document.querySelector('#settings-dialog')
const preferences = document.querySelector('#preferences')
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
  input.setAttribute('aria-label', 'Command to copy')
  input.style.position = 'fixed'
  input.style.left = '-9999px'
  document.body.append(input)
  input.select()
  try {
    if (!document.execCommand('copy')) throw Error('Select and copy the command instead.')
  } finally {
    input.remove()
    previous?.focus()
  }
}
function fields(parent, rows) {
  const populated = rows.filter(([, value]) => value !== undefined && value !== null && value !== '')
  if (!populated.length) return
  const dl = node('dl', undefined, parent)
  for (const [label, value] of populated) { node('dt', label, dl); node('dd', Array.isArray(value) ? value.join('\n') : value, dl) }
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
  const header = node('header', undefined, main)
  if (view.title) node('h1', view.title, header)
  if (view.outcome) {
    const section = node('section', undefined, main)
    node('h2', 'From session history', section)
    node('p', view.outcome, section, 'history-outcome')
    return
  }
  const summary = view.summary
  if (!summary) { node('p', 'No summary is available.', main); return }
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
        node('h3', question.question, item)
        fields(item, [['Owner', question.owner], ['Impact', question.impact]])
      }
    }
    if (result.noPair || result.pairs?.length) {
      const gallery = node('section', undefined, main)
      node('h2', 'Before and after', gallery)
      if (result.noPair) node('p', result.noPair, gallery)
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
    button(details, 'Update commands', () => { dirtyDrafts.delete(draftKey); rendered = undefined; void refresh() })
    button(details, 'Clear description', () => { description.value = ''; draft.description = ''; changed(); description.focus() })
  }
}
async function refresh() {
  if (document.hidden) return
  const ticket = ++generation
  listening = true
  try {
    const [view, workflowResult] = await Promise.all([
      request('summary.focused', { listen: true }),
      request('workflow.view').then(value => ({ value }), error => ({ error }))
    ])
    const original = workflowResult.value
    let workflow = original
    if (original?.key && drafts.has(original.key) && original.draft && !dirtyDrafts.has(original.key)) {
      try { workflow = await request('workflow.view', { draft: drafts.get(original.key), key: original.key }) }
      catch (error) { workflowResult.error = error; workflow = null }
    }
    if (ticket !== generation || document.hidden) return
    const key = JSON.stringify([view, workflow, workflowResult.error?.message, original?.key && dirtyDrafts.has(original.key)])
    if (key === rendered) return
    rendered = key
    const editor = main.querySelector('details[data-draft-key]')
    const active = document.activeElement
    const selection = active?.dataset?.draftField && editor?.contains(active)
      ? { key: editor.dataset.draftKey, field: active.dataset.draftField, start: active.selectionStart, end: active.selectionEnd } : null
    const openKey = editor?.open ? editor.dataset.draftKey : null
    main.replaceChildren()
    drawSummary(view, workflow)
    drawWorkflow(workflow, original?.key)
    if (workflowResult.error) node('p', message(workflowResult.error, 'Could not load workflow actions.'), main)
    const nextEditor = main.querySelector('details[data-draft-key]')
    if (nextEditor?.dataset.draftKey === openKey) nextEditor.open = true
    if (selection && nextEditor?.dataset.draftKey === selection.key) {
      const field = nextEditor.querySelector(`[data-draft-field="${selection.field}"]`)
      nextEditor.open = true
      field?.focus()
      field?.setSelectionRange(selection.start, selection.end)
    }
  } catch (error) {
    if (ticket !== generation || document.hidden) return
    rendered = undefined
    main.replaceChildren()
    node('p', message(error, 'Could not load summary.'), main)
  }
}
function pause() {
  generation++
  if (listening) { listening = false; void request('summary.closed').catch(() => {}) }
}
api.plugin.on('summary.changed', () => void refresh())
api.on('workspace.changed', () => void refresh())
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
  form.elements.reviewHost.value = profile.reviewHost || ''
  form.elements.shell.value = profile.shell || 'posix'
  form.elements.openReview.value = (profile.openReview || []).join('\n')
  form.elements.trustOpener.checked = false
  document.querySelector('#opener-trust').hidden = isImported
  document.querySelector('#import-trust-note').hidden = !isImported
  document.querySelector('#profile-form-title').textContent = isImported ? 'Import profile' : profile.name ? 'Edit profile' : 'New profile'
  for (const step of profile.steps || []) addStep(step)
  form.hidden = false
  form.elements.name.focus()
}
async function listProfiles() {
  const list = document.querySelector('#profile-list')
  try {
    const result = await request('profiles.list')
    list.replaceChildren()
    const available = document.querySelector('#available-projects')
    available.replaceChildren()
    if (result.projects?.length) {
      const list = node('ul', undefined, available)
      for (const project of result.projects) {
        const item = node('li', undefined, list)
        button(item, `${project.name} (${project.id})`, () => {
          form.elements.projectPrefix.value = project.id
          form.elements.projectPrefix.dispatchEvent(new Event('input'))
          form.elements.projectPrefix.focus()
        })
      }
    }
    if (!result.profiles.length) node('p', 'No profiles saved.', list)
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
    document.querySelector('#panel-icon').hidden = values.showPanelIcon === false
    for (const field of preferences.elements) {
      if (field.type === 'checkbox') field.checked = values[field.name] === true
      else field.value = values[field.name]
    }
    preferences.disabled = false
  } catch (error) {
    if (revision === settingsRevision) settingsStatus.textContent = message(error, 'Could not read settings.')
  }
}
preferences.addEventListener('change', async ({ target }) => {
  preferences.disabled = true
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
api.settings.onDidChange(({ key }) => { if (dialog.open || key === 'showPanelIcon') void loadPreferences() })
document.querySelector('#open-settings').addEventListener('click', () => {
  profileStatus.textContent = settingsStatus.textContent = ''
  preferences.disabled = true
  dialog.showModal()
  void loadPreferences()
  void listProfiles()
})
document.querySelector('#close-settings').addEventListener('click', () => dialog.close())
document.querySelector('#new-profile').addEventListener('click', () => editProfile({}))
document.querySelector('#cancel-profile').addEventListener('click', () => { form.hidden = true })
document.querySelector('#add-step').addEventListener('click', () => addStep())
form.elements.projectPrefix.addEventListener('input', () => { previewedPrefix = undefined; preview.replaceChildren() })
for (const name of ['projectPrefix', 'reviewHost', 'openReview']) {
  form.elements[name].addEventListener('input', () => { form.elements.trustOpener.checked = false })
}
document.querySelector('#preview-projects').addEventListener('click', async event => {
  const prefix = form.elements.projectPrefix.value
  await run(event.currentTarget, async () => {
    const result = await request('profiles.preview', { projectPrefix: prefix })
    if (prefix !== form.elements.projectPrefix.value) return
    preview.replaceChildren()
    if (result.projects.length) {
      node('p', 'Matching projects:', preview)
      const list = node('ul', undefined, preview)
      for (const project of result.projects) node('li', `${project.name} (${project.id})`, list)
    } else node('p', 'No projects match.', preview)
    if (result.truncated) node('p', 'The project list is incomplete.', preview)
    previewedPrefix = prefix
  }, 'Project preview updated.', 'Could not preview projects.', profileStatus)
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
  if (previewedPrefix !== prefix) { profileStatus.textContent = 'Preview matching projects before saving.'; return }
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
