import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createConfig, validateConfig } from '../settings-config.mjs'
import { bindProfiles } from '../profiles.mjs'
import { createExclusions } from '../exclusions.mjs'

const manifest = JSON.parse(readFileSync(new URL('../orca-plugin.json', import.meta.url), 'utf8'))
const defaults = Object.fromEntries(manifest.contributes.settings.map(s => [s.key, s.default]))

function setup() {
  const prefs = {...defaults, unrelated:'preserved'}, data = new Map(), handlers = new Map(), calls = []
  const state = {fail:null, ignore:null}
  const orca = {
    panels:{handle:(name, handler) => handlers.set(name, handler), post:() => {}},
    storage:{get:async key => data.get(key) ?? null, set:async (key, value) => data.set(key, structuredClone(value))},
    host:{call:async (method, args) => {
      calls.push([method, args])
      if (method === 'settings.get') return {settings:{...prefs}}
      if (method === 'settings.set') {
        if (state.fail === args.key) throw Error('write failed')
        if (state.ignore !== args.key) prefs[args.key] = args.value
        return {ok:true}
      }
      if (method === 'workspace.list') return {workspaces:[{id:'w', projectId:'p', hostId:'local', name:'Work'}]}
      throw Error(`Unexpected host call ${method}`)
    }}
  }
  const profiles = bindProfiles(orca, {settings:async () => prefs, focused:async () => null})
  const exclusions = createExclusions(orca, async () => ({active:{workspaceId:'w'}}), () => {})
  return {config:createConfig(orca, exclusions, profiles), prefs, calls, state, data, profiles, handlers}
}

test('validates manifest keys, types, enums and model IDs before any writes', async () => {
  const {config, calls} = setup()
  assert.deepEqual(validateConfig({manualLoad:true, summaryStrategy:'instant', recapModel:'provider/model:1'}), {manualLoad:true, summaryStrategy:'instant', recapModel:'provider/model:1'})
  for (const patch of [null, [], 'x', {unknown:true}, {manualLoad:'true'}, {summaryStrategy:'other'}, {recapModel:'-bad'}, {recapModel:'a b'}, {recapModel:'a\nb'}, {recapModel:'x'.repeat(257)}, {recapAgent:3}, {manualLoad:true, autoOpen:1}, JSON.parse('{"__proto__":true}')]) {
    assert.throws(() => validateConfig(patch))
    await assert.rejects(config({op:'apply', value:patch}))
  }
  assert.deepEqual(calls, [])
})

test('shows actual preferences and applies a patch without disturbing others', async () => {
  const {config, prefs} = setup()
  assert.deepEqual(await config({op:'show'}), prefs)
  assert.deepEqual(await config({op:'apply', value:{manualLoad:true, recapModel:'vendor/model'}}), {...defaults, unrelated:'preserved', manualLoad:true, recapModel:'vendor/model'})
})

test('reports partial writes and detects settings not actually saved', async () => {
  const {config, prefs, state} = setup()
  state.fail = 'historyOutcome'
  await assert.rejects(config({op:'apply', value:{manualLoad:true, historyOutcome:false}}), /some may have been saved/)
  assert.equal(prefs.manualLoad, true)
  assert.equal(prefs.historyOutcome, true)
  state.fail = null
  state.ignore = 'autoOpen'
  await assert.rejects(config({op:'apply', value:{autoOpen:true}}), /do not match/)
  state.ignore = null
  assert.equal((await config({op:'apply', value:{autoOpen:true}})).autoOpen, true)
})

test('exclusions use current selection and existing removal rules', async () => {
  const {config} = setup()
  assert.deepEqual((await config({op:'exclusions'})).choices.map(x => x.kind), ['workspace', 'project'])
  await config({op:'exclude', value:{kind:'project', host:'local', id:'p'}})
  assert.equal((await config({op:'exclusions'})).rules[0].id, 'p')
  await assert.rejects(config({op:'exclude', value:{kind:'project', host:'local', id:'other'}}), /selection changed/i)
  await assert.rejects(config({op:'include', value:{kind:'project', host:'local', id:'p', excluded:true}}), /Invalid exclusion/)
  await config({op:'include', value:{kind:'project', host:'local', id:'p'}})
  assert.deepEqual((await config({op:'exclusions'})).rules, [])
})

test('profiles list without project discovery and removal revokes opener approval', async () => {
  const {config, profiles, data, calls} = setup()
  const profile = {id:'p', name:'P', enabled:true, projectPrefix:'git:', reviewHost:'example.com', shell:'posix', steps:[], openReview:['/bin/echo', '{url}']}
  await profiles.accept(profile, false)
  data.set('trustedWorkflowOpeners', {p:'approval'})
  assert.equal((await config({op:'profiles'})).profiles[0].id, 'p')
  assert.equal(calls.some(([method]) => method === 'project.list'), false)
  await assert.rejects(config({op:'remove-profile', value:'__proto__!'}), /Invalid profile ID/)
  await config({op:'remove-profile', value:'p'})
  assert.deepEqual(await config({op:'profiles'}), {profiles:[]})
  assert.deepEqual(data.get('trustedWorkflowOpeners'), {})
  await assert.rejects(config({op:'missing'}), /Invalid configuration operation/)
})
