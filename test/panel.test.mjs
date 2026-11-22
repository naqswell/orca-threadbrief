import test from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

async function exercisePanel(defaults) {
  const $ = s => document.querySelector(s), delay = ms => new Promise(r => setTimeout(r, ms))
  const events = {}, prefs = { ...defaults }
  const summary = title => ({ title, contextKey: title, scope: 'session', outcome: title + ' outcome' })
  const loaded = new Map()
  let inventories = 0, frameReads = 0, waitForLoad
  let checkpointSaves = 0
  let first, view = new Promise(resolve => { first = resolve })
  window.orca = {
    plugin: { on: (k, fn) => { events[k] = fn }, request: async (k, input) => {
      if (k === 'summary.focused') {
        if (!prefs.manualLoad) return view
        if (!input.loadFor) return loaded.get(view.contextKey) ?? { manual: true, scope: 'manual', contextKey: view.contextKey }
        if (input.loadFor !== view.contextKey) throw Error('Wrong manual request')
        if (waitForLoad) await waitForLoad
        const brief = { ...view, manual: true }
        loaded.set(view.contextKey, brief)
        return brief
      }
      if (k === 'frame') { frameReads++; return null }
      if (k === 'workflow.view') return { state: 'none' }
      if (k === 'checkpoint.target') return { key:'approved-turn', title:'On demand', environment:'peer' }
      if (k === 'checkpoint.capture') {
        if (input.key !== 'approved-turn') throw Error('Wrong checkpoint target')
        checkpointSaves++
        view = { ...view, outcome:null, summary:{ goal:'Plan workshop', done:'Room booked', next:'Send invitations', checkpoint:{revision:3, decisions:'Room A', checks:'Capacity verified', open:'Guest count'} } }
        return { revision:3 }
      }
      if (k === 'recap.agents') { inventories++; return [{ id: 'a', name: 'Agent A', preferred: true, catalogKey:'catalog-a' }, { id: 'b', name: 'Agent B', catalogKey:'catalog-b' }] }
      if (k === 'recap.preview') return { token: 'preview-a', title: 'Third', agent: 'a', model: prefs.recapModel, effort: prefs.recapEffort, environment: 'local', prompt: 'Approved for Agent A' }
    } },
    settings: { get: async key => key ? prefs[key] : prefs, set: async (key, value) => { prefs[key] = value; events.settings({ key }) }, onDidChange: fn => { events.settings = fn } },
    storage: { get: async key => JSON.parse(localStorage.getItem(key)), set: async (key, value) => { localStorage.setItem(key, JSON.stringify(value)); events.storage({key}) }, onDidChange: fn => { events.storage = fn } }
  }
  const changed = reason => events['summary.changed']({ reason })
  const check = (ok, message) => { if (!ok) throw Error(message) }
  await import('/panel.mjs')
  await delay(370)
  const initial = $('#loading').getBoundingClientRect()
  const canSave = () => $('#open-handoff').getClientRects().length > 0
  check(!canSave(), 'Save offered before the first brief loaded')
  check(initial.height > 0 && initial.height < 60 && !document.getAnimations().length && $('#loading').textContent.trim() === 'Loading summary…', 'First load was not a static, single-line status')
  first(summary('First'))
  await delay(10)
  check($('main h1')?.textContent === 'First', 'First session did not render')
  let release
  view = new Promise(r => { release = r })
  changed('selection')
  await delay(370)
  check($('main h1')?.textContent === 'First' && !$('main').hidden && $('main').inert, 'Old brief disappeared or stayed actionable during a slow switch')
  check(!canSave(), 'Save targeted a session that was still switching')
  check(!$('#loading').getClientRects().length && !document.getAnimations().length, 'Loader or animation appeared during a slow switch')
  view = { ...summary('Third'), working: true }; changed('selection'); await delay(5)
  check($('main h1')?.textContent === 'Third' && !$('main').inert && !document.getAnimations().length, 'New selection did not replace the old brief directly')
  release(summary('Late second')); await delay(5)
  check($('main h1')?.textContent === 'Third', 'Late result replaced the selected session')
  $('#open-settings').click(); await delay(5)
  const dialog = $('#settings-dialog'), sections = dialog.querySelectorAll(':scope > details')
  check(innerWidth === 340 && dialog.scrollWidth <= dialog.clientWidth && [...sections].every(section => !section.open), 'Narrow settings opened crowded or overflowing')
  check(inventories === 0 && !dialog.innerText.includes('Preview recap request'), 'Closed settings loaded or displayed model controls')
  $('#reading-settings summary').click()
  check(dialog.innerText.includes('Read paired session history') && inventories === 0, 'Opening reading preferences queried agents')
  $('#recap-settings summary').click(); await delay(5)
  check(!$('#reading-settings').open && inventories === 1, 'Recap disclosure did not load on demand')
  check($('[name=\"summaryStrategy\"]').value === 'brief' && !$('#recap-controls').hidden, 'Fresh install did not offer Brief recap')
  check(!$('#recap-agent').disabled && $('#recap-agent').value === 'a' && $('#recap-agent').options.length === 2, 'Could not choose an installed agent during an active turn')
  check($('#preview-recap').disabled, 'A working session allowed a preview')
  view = summary('Third'); changed('session'); await delay(5)
  check(!$('#preview-recap').disabled, 'Open settings did not notice the session finished')
  const choice = $('#model-choice'), model = $('#recap-model'), form = $('#recap-model-form')
  check(choice.value === '' && form.hidden, 'Fresh install required a model identifier')
  const effort = $('#effort-choice')
  check($('#effort-field').hidden, 'Default model offered unconfirmed effort levels')
  await window.orca.storage.set('catalog-a', [{id:'example/quick',name:'Quick',efforts:['low','high']}]); await delay(5)
  check(choice.value === '' && choice.querySelector('optgroup option')?.textContent.includes('Quick'), 'Agent registration did not update the open picker or changed the pin')
  choice.value = 'example/quick'; choice.dispatchEvent(new Event('change')); await delay(5)
  check(prefs.recapModel === 'example/quick', 'Selecting a reported name did not pin the exact ID')
  check(!$('#effort-field').hidden && [...effort.options].map(o => o.value).join(',') === ',low,high', 'Wrong efforts for the pinned model')
  effort.value = 'high'; effort.dispatchEvent(new Event('change')); await delay(5)
  $('#preview-recap').click(); await delay(5)
  check(prefs.recapEffort === 'high' && $('#recap-destination').textContent.includes('Effort: high'), 'Preview lost the selected effort')
  await window.orca.storage.set('catalog-a', []); await delay(5)
  check(choice.value === 'example/quick', 'Catalog replacement silently cleared a pin')
  check($('#preview-recap').disabled && $('#recap-preview').hidden, 'Withdrawn effort left an actionable preview')
  choice.value = ''; choice.dispatchEvent(new Event('change')); await delay(5)
  check(![...choice.options].some(o => o.value === 'example/quick'), 'Withdrawn model was added to manual history')
  check(!prefs.recapEffort && $('#effort-field').hidden, 'Changing model carried a stale effort')
  choice.selectedIndex = choice.options.length - 1; choice.dispatchEvent(new Event('change'))
  model.value = 'provider/version-1'; model.dispatchEvent(new Event('input'))
  check($('#preview-recap').disabled, 'Unsaved model allowed a preview')
  form.requestSubmit(); await delay(5)
  check(form.hidden && choice.value === model.value && prefs.recapModel === model.value, 'Model was not pinned')
  $('#preview-recap').click(); await delay(5)
  check(!$('#recap-preview').hidden, 'Preview did not appear')
  check($('#recap-destination').textContent.includes('a / provider/version-1'), 'Preview omitted the pinned model')
  choice.value = ''; choice.dispatchEvent(new Event('change')); await delay(5)
  check(prefs.recapModel === '' && $('#recap-preview').hidden, 'Clearing the pin left the old preview actionable')
  $('#close-settings').click(); $('#open-settings').click(); await delay(5)
  check([...choice.options].some(o => o.value === model.value), 'Saved model missing on reopening settings')
  choice.value = model.value; choice.dispatchEvent(new Event('change')); await delay(5)
  check(prefs.recapModel === model.value, 'Could not reuse the saved model')
  const agent = $('#recap-agent')
  agent.value = 'b'; agent.dispatchEvent(new Event('change')); await delay(5)
  check(prefs.recapAgent === 'b' && !prefs.recapModel && ![...choice.options].some(o => o.value === model.value), 'Changing agents kept another agent’s model')
  agent.value = 'a'; agent.dispatchEvent(new Event('change')); await delay(5)
  $('#preview-recap').click(); await delay(5)
  prefs.recapAgent = 'b'; events.settings({ key: 'recapAgent' }); await delay(5)
  check($('#recap-agent').value === 'b' && $('#recap-preview').hidden, 'A preview for the previous agent remained actionable')
  $('#close-settings').click(); $('main').focus()
  const text = $('main .prose p').firstChild, range = document.createRange()
  range.selectNodeContents(text); getSelection().removeAllRanges(); getSelection().addRange(range)
  view = { ...summary('Third'), outcome: 'Updated outcome' }; changed('session'); await delay(5)
  const refresh = $('#refresh-brief')
  check(refresh.innerText === 'Update available' && getSelection().toString() === 'Third outcome' && $('main .prose p').firstChild === text, 'Same-session refresh disturbed the reader')
  prefs.pauseWhileReading = false; events.settings({ key: 'pauseWhileReading' }); await delay(5)
  check($('main .prose p').textContent === 'Updated outcome', 'Live mode did not apply the pending update')
  view = { scope: 'excluded', excluded: 'session' }; changed('exclusions')
  check(!$('main').textContent && !document.body.innerText.includes('Updated outcome'), 'Excluded text remained in the panel')
  $('#open-settings').click(); await delay(5)
  $('[name="manualLoad"]').click(); await delay(5)
  $('#close-settings').click()
  view = summary('On demand'); changed('history-setting'); await delay(5)
  const load = $('#manual-load')
  check(prefs.manualLoad && !load.hidden && refresh.hidden && !$('main .prose'), 'Manual mode offered refresh or read a brief before a click')
  check(!canSave(), 'Save was visible before Load brief')
  const heading = $('.manual-welcome h2').getBoundingClientRect(), action = load.getBoundingClientRect()
  check(heading.top > innerHeight / 4 && action.top > heading.bottom && action.bottom < innerHeight, 'On-demand action was not grouped in the tall panel')
  window.frameElement.height = '230'
  check(load.getBoundingClientRect().bottom <= innerHeight && !$('.manual-welcome svg').getClientRects().length, 'Short panel pushed the action below the fold')
  window.frameElement.height = '650'
  view = { ...view, outcome: Array.from({ length: 65 }, (_, i) => `Paragraph ${i + 1}`).join('\n\n') }
  load.click(); await delay(5)
  const paragraph = $('main .prose p')
  check(paragraph?.textContent === 'Paragraph 1' && load.hidden && !refresh.hidden, 'Loading did not replace the initial action with Refresh')
  check(canSave(), 'Loading the session reply did not make Save available')
  check(!$('.manual-welcome') && $('main h1').getBoundingClientRect().top < 60, 'Loaded brief retained the empty layout')
  window.scrollTo(0, 800)
  const bounds = refresh.getBoundingClientRect(), y = window.scrollY
  check(y > 500 && bounds.top >= 0 && bounds.bottom < 60 && refresh.contains(document.elementFromPoint(bounds.x + 8, bounds.y + 8)), 'Refresh scrolled away or was covered')
  view = { ...view, outcome: view.outcome.replace('Paragraph 1', 'Changed on host') }; changed('session'); await delay(5)
  check($('main .prose p') === paragraph && !refresh.hidden, 'Background update disturbed the manual brief or hid Refresh')
  refresh.click(); await delay(5)
  check($('main .prose p').textContent === 'Changed on host' && window.scrollY === y, 'Explicit refresh did not update in place')
  waitForLoad = new Promise(resolve => { release = resolve })
  refresh.click()
  window.scrollTo(0, 300)
  release(); await delay(5)
  check(window.scrollY === 300, 'Slow refresh jumped back after the reader scrolled')
  waitForLoad = undefined
  view = summary('Another session'); changed('selection')
  check(!document.body.innerText.includes('Changed on host'), 'Previous session remained visible')
  await delay(5)
  check(!load.hidden && refresh.hidden && !$('main .prose'), 'Switched session loaded without a click')
  check(!canSave(), 'A new manual session kept the previous Save action')
  view = summary('On demand'); changed('selection'); await delay(5)
  check(load.hidden && !refresh.hidden && $('main .prose p')?.textContent === 'Changed on host', 'Returning to a loaded session showed the welcome instead of its last read')
  check(canSave(), 'Restoring the session reply lost Save')
  view = { ...view, outcome: null, summary: { result: { pairs: [{ title: 'Example pair', before: 'a', after: 'b' }] } } }
  refresh.click(); await delay(5)
  view = summary('Another session'); changed('selection'); await delay(5)
  view = summary('On demand'); changed('selection'); await delay(5)
  const pair = $('main details')
  check(pair && !pair.open && frameReads === 0, 'Restoring a manual report reread its images')
  pair.querySelector('summary').click(); await delay(20)
  check(frameReads === 2, 'Expanding the pair did not fetch its images')
  view = summary('On demand'); refresh.click(); await delay(5)
  $('#open-handoff').click(); await delay(5)
  const handoff = $('#handoff-dialog')
  check(handoff.open && handoff.scrollWidth <= handoff.clientWidth && handoff.innerText.includes('normal tokens') && $('#checkpoint-target').textContent.includes('Paired server') && !checkpointSaves, 'Opening handoff hid costs, the target, or captured without consent')
  $('#save-checkpoint').click(); await delay(5)
  check(checkpointSaves === 1 && $('#checkpoint-status').textContent.includes('3 saved'), 'Explicit capture did not confirm the checkpoint')
  $('#close-handoff').click()
  check($('main').innerText.includes('checkpoint 3') && $('main').innerText.includes('Capacity verified') && $('main').innerText.includes('Copy saved handoff'), 'Saved checkpoint did not replace the manual brief')
}

const chrome = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium', process.env.ProgramFiles && join(process.env.ProgramFiles, 'Google/Chrome/Application/chrome.exe')].find(p => p && existsSync(p))
test('Chromium: direct session switches, reader focus, exclusions and recap destination', { skip: !chrome && 'Set CHROME_PATH to a Chromium executable' }, async t => {
  const manifest = JSON.parse(await readFile(new URL('../orca-plugin.json', import.meta.url), 'utf8'))
  const defaults = Object.fromEntries(manifest.contributes.settings.map(s => [s.key, s.default]))
  const html = (await readFile(new URL('../panel.html', import.meta.url), 'utf8')).replace('<script type="module" src="./panel.mjs"></script>', `<script type="module">(${exercisePanel})(${JSON.stringify(defaults)}).then(() => parent.document.body.dataset.test = 'passed', error => parent.document.body.dataset.error = error.message)</script>`)
  const files = new Set(['/panel.mjs', '/panel.css', '/summary-markdown.mjs', '/vendor/marked.mjs', '/assets/session-summary.png'])
  const server = createServer(async (req, res) => {
    if (req.url === '/') { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><body><iframe width="340" height="650" src="/panel.html"></iframe>'); return }
    if (req.url === '/panel.html') { res.setHeader('content-type', 'text/html'); res.end(html); return }
    if (!files.has(req.url)) { res.writeHead(404).end(); return }
    res.setHeader('content-type', req.url.endsWith('.mjs') ? 'text/javascript' : req.url.endsWith('.css') ? 'text/css' : 'image/png')
    res.end(await readFile(new URL('..' + req.url, import.meta.url)))
  })
  await new Promise(r => server.listen(0, '127.0.0.1', r)); t.after(() => server.close())
  const profile = await mkdtemp(join(tmpdir(), 'threadbrief-chromium-'))
  t.after(() => rm(profile, { recursive: true, force: true, maxRetries: 3 }))
  const { stdout } = await promisify(execFile)(chrome, ['--headless', '--disable-gpu', '--no-first-run', '--disable-background-networking', `--user-data-dir=${profile}`, '--virtual-time-budget=5000', '--dump-dom', `http://127.0.0.1:${server.address().port}/`], { timeout: 30000, maxBuffer: 2 ** 20 })
  assert.match(stdout.match(/<body[^>]*>/)?.[0] || '', /data-test="passed"/)
})
