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
  let inventories = 0
  let first, view = new Promise(resolve => { first = resolve })
  window.orca = {
    plugin: { on: (k, fn) => { events[k] = fn }, request: async (k, input) => {
      if (k === 'summary.focused') {
        if (!prefs.manualLoad) return view
        if (!input.loadFor) return { manual: true, scope: 'manual', contextKey: view.contextKey }
        if (input.loadFor !== view.contextKey) throw Error('Wrong manual request')
        return { ...view, manual: true }
      }
      if (k === 'workflow.view') return { state: 'none' }
      if (k === 'recap.agents') { inventories++; return [{ id: 'a', name: 'Agent A', preferred: true }, { id: 'b', name: 'Agent B' }] }
      if (k === 'recap.preview') return { token: 'preview-a', title: 'Third', agent: 'a', model: prefs.recapModel, environment: 'local', prompt: 'Approved for Agent A' }
    } },
    settings: { get: async key => key ? prefs[key] : prefs, set: async (key, value) => { prefs[key] = value; events.settings({ key }) }, onDidChange: fn => { events.settings = fn } },
    storage: { get: async key => JSON.parse(localStorage.getItem(key)), set: async (key, value) => localStorage.setItem(key, JSON.stringify(value)) }
  }
  const changed = reason => events['summary.changed']({ reason })
  const check = (ok, message) => { if (!ok) throw Error(message) }
  await import('/panel.mjs')
  await delay(370)
  const initial = $('#loading').getBoundingClientRect()
  check(initial.height > 0 && initial.height < 60 && !document.getAnimations().length && $('#loading').textContent.trim() === 'Loading summary…', 'First load was not a static, single-line status')
  first(summary('First'))
  await delay(10)
  check($('main h1')?.textContent === 'First', 'First session did not render')
  let release
  view = new Promise(r => { release = r })
  changed('selection')
  await delay(370)
  check($('main h1')?.textContent === 'First' && !$('main').hidden && $('main').inert, 'Old brief disappeared or stayed actionable during a slow switch')
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
  check(!$('#refresh-brief').hidden && getSelection().toString() === 'Third outcome' && $('main .prose p').firstChild === text, 'Same-session refresh disturbed the reader')
  prefs.pauseWhileReading = false; events.settings({ key: 'pauseWhileReading' }); await delay(5)
  check($('main .prose p').textContent === 'Updated outcome', 'Live mode did not apply the pending update')
  view = { scope: 'excluded', excluded: 'session' }; changed('exclusions')
  check(!$('main').textContent && !document.body.innerText.includes('Updated outcome'), 'Excluded text remained in the panel')
  $('#open-settings').click(); await delay(5)
  $('[name="manualLoad"]').click(); await delay(5)
  $('#close-settings').click()
  view = summary('On demand'); changed('history-setting'); await delay(5)
  const load = $('#manual-load')
  check(prefs.manualLoad && !load.hidden && load.textContent === 'Load brief' && !$('main .prose'), 'Manual mode read a brief before a click')
  load.click(); await delay(5)
  const paragraph = $('main .prose p')
  check(paragraph?.textContent === view.outcome && load.textContent === 'Refresh brief', 'Click did not load the selected brief')
  view = { ...view, outcome: 'Changed on host' }; changed('session'); await delay(5)
  check($('main .prose p') === paragraph && paragraph.textContent !== view.outcome, 'Background update replaced a manual brief')
  load.click(); await delay(5)
  check($('main .prose p').textContent === view.outcome, 'Explicit refresh did not fetch the latest reply')
  view = summary('Another session'); changed('selection')
  check(!document.body.innerText.includes('Changed on host'), 'Previous session remained visible')
  await delay(5)
  check(load.textContent === 'Load brief' && !$('main .prose'), 'Switched session loaded without a click')
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
