import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import { bindProfiles } from '../profiles.mjs'

const profile = {
  id:'team', name:'Team', enabled:true, projectPrefix:'git:example/', reviewHost:'git.example.org', shell:'posix',
  steps:[
    {label:'Push', kind:'push', argv:['git', 'push', 'origin', '{branch}']},
    {label:'Review', kind:'review', argv:['review-tool', 'create', '{repo}', '{base}', '{title}', '{description}']}
  ]
}

function setup() {
  const handlers = new Map(), data = new Map(), calls = []
  const workspace = {id:'workspace', kind:'worktree', hostId:'local', projectId:'git:example/books', path:tmpdir(), branch:'feature', name:'Books'}
  const project = {id:workspace.projectId, hostId:'local', kind:'git', path:'/projects/books', name:'Books'}
  let selection = {scope:'worktree', workspaceId:workspace.id, summary:null}
  let settings = {profileActions:true, commandAction:'copy'}
  const orca = {
    panels:{handle:(name, handler) => handlers.set(name, handler), post:() => {}},
    storage:{get:async key => data.get(key) ?? null, set:async (key, value) => data.set(key, structuredClone(value))},
    host:{call:async (method, args) => {
      calls.push([method, args])
      if (method === 'workspace.readContext') return {workspaceId:workspace.id, branch:workspace.branch, terminals:[]}
      if (method === 'workspace.list') return {workspaces:[workspace], truncated:false}
      if (method === 'project.list') return {projects:[project], truncated:false}
      if (method === 'terminal.create') return {terminalId:'new-terminal'}
      if (method === 'terminal.focus') return {focused:true}
      if (method === 'settings.set') { settings[args.key] = args.value; return {ok:true} }
      throw Error(`Unexpected host call ${method}`)
    }}
  }
  const accept = bindProfiles(orca, {settings:async () => settings, focused:async () => selection})
  return {workspace, project, calls, data, accept, request:(name, args = {}) => handlers.get(name)(args),
    select:value => {selection = value}, configure:value => {settings = value}}
}

test('external import replaces by ID, only enables on request and never inherits opener trust', async () => {
  const s = setup(), p = {...profile, openReview:['/bin/echo', '{url}']}
  await s.request('profiles.save', {profile:p, trustOpener:true})
  await s.accept(p, false)
  assert.deepEqual((await s.request('profiles.list')).profiles, [{...p, enabled:false}])
  assert.deepEqual(Object.keys(s.data.get('trustedWorkflowOpeners')), [])
  s.configure({profileActions:false})
  await s.accept({...p, name:'Renamed'}, true)
  assert.equal((await s.request('workflow.view')).state, 'actions')
  assert.deepEqual((await s.request('profiles.list')).profiles.map(item => item.name), ['Renamed'])
})

const snapshot = () => ({cwd:tmpdir(), branch:'feature', repo:'books', mr:{base:'main', title:'Original', description:'First\nSecond'}})

test('preview, matching, conflict and unrelated projects', async () => {
  const s = setup()
  await s.request('profiles.save', {profile})
  assert.deepEqual((await s.request('profiles.preview', {projectPrefix:'git:example/'})).projects, [{id:s.project.id, name:'Books'}])
  assert.equal((await s.request('workflow.view')).state, 'actions')
  s.workspace.projectId = 'git:other/books'
  assert.equal((await s.request('workflow.view')).state, 'none')
  s.workspace.projectId = s.project.id
  await s.request('profiles.save', {profile:{...profile, id:'second'}})
  assert.equal((await s.request('workflow.view')).state, 'conflict')
  await s.request('profiles.delete', {id:'second'})
  s.workspace.branch = 'wip/feature'
  await s.request('profiles.save', {profile:{...profile, excludeBranchPrefix:'wip/'}})
  assert.equal((await s.request('workflow.view')).state, 'none')
})

test('draft changes commands safely, and stale keys cannot open a terminal', async () => {
  const s = setup()
  s.select({scope:'worktree', workspaceId:'workspace', legacyPublication:snapshot()})
  await s.request('profiles.save', {profile})
  const first = await s.request('workflow.view')
  assert.deepEqual(first.draft, {title:'Original', description:'First\nSecond', base:'main'})
  const edited = await s.request('workflow.view', {key:first.key, draft:{title:"It's ready", description:'line one\n$(no execution)', base:'main'}})
  assert.notEqual(edited.key, first.key)
  assert.match(edited.actions[1].command, /It'\\''s ready/)
  assert.match(edited.actions[1].command, /\$\(no execution\)/)
  await assert.rejects(s.request('workflow.terminal', {key:first.key}), /changed/)
  await s.request('workflow.terminal', {key:edited.key})
  assert.equal(s.calls.some(([method]) => method === 'terminal.sendText'), false)
  assert.deepEqual(s.calls.filter(([method]) => method === 'terminal.create')[0][1], {workspaceId:'workspace', title:'Workflow'})
  s.workspace.branch = 'different'
  await assert.rejects(s.request('workflow.terminal', {key:edited.key}), /changed/)
})

test('snapshot path and branch must match the local worktree', async () => {
  const s = setup()
  await s.request('profiles.save', {profile})
  const publication = snapshot()
  publication.cwd = '/path/that/does/not/exist'
  s.select({scope:'worktree', workspaceId:'workspace', legacyPublication:publication})
  assert.equal((await s.request('workflow.view')).state, 'none')
  publication.cwd = tmpdir()
  publication.branch = 'other'
  assert.equal((await s.request('workflow.view')).state, 'none')
  s.workspace.hostId = 'ssh:other'
  assert.equal((await s.request('workflow.view')).state, 'none')
})

test('review opener requires explicit exact approval and canonical URL', async () => {
  const s = setup()
  const withOpener = {...profile, openReview:['/bin/echo', '{url}']}
  s.select({scope:'worktree', workspaceId:'workspace', summary:{result:{links:{MR:'https://git.example.org/team/books/-/merge_requests/12'}}}})
  await s.request('profiles.save', {profile:withOpener})
  let view = await s.request('workflow.view')
  assert.equal(view.review.custom, false)
  await assert.rejects(s.request('workflow.openReview', {key:view.key}), /not trusted/)
  await s.request('profiles.save', {profile:withOpener, trustOpener:true})
  view = await s.request('workflow.view')
  assert.equal(view.review.custom, true)
  await s.request('profiles.save', {profile:{...withOpener, projectPrefix:'git:'}})
  view = await s.request('workflow.view')
  assert.equal(view.review.custom, false)
  await assert.rejects(s.request('profiles.save', {profile:{...withOpener, openReview:['/bin/sh', '-c', '{url}']}, trustOpener:true}), /Invalid/)
  s.select({scope:'worktree', workspaceId:'workspace', summary:{result:{links:{MR:'https://git.example.org/team/books/-/merge_requests/12?token=x'}}}})
  assert.equal((await s.request('workflow.view')).state, 'actions')
})

test('standard review works without a profile and PowerShell arguments are quoted', async () => {
  const s = setup()
  s.configure({profileActions:false, commandAction:'copy'})
  s.select({scope:'session', summary:{result:{links:{PR:'https://github.com/example/books/pull/7'}}}})
  assert.deepEqual((await s.request('workflow.view')).review, {url:'https://github.com/example/books/pull/7', label:'Open PR', custom:false})
  s.configure({profileActions:true, commandAction:'terminal'})
  s.select({scope:'worktree', workspaceId:'workspace', legacyPublication:snapshot()})
  await s.request('profiles.save', {profile:{...profile, shell:'powershell'}})
  const first = await s.request('workflow.view')
  const view = await s.request('workflow.view', {key:first.key, draft:{title:"Don't expand $x", description:'Text', base:'main'}})
  assert.equal(view.preferred, 'terminal')
  assert.match(view.actions[1].command, /'Don''t expand \$x'/)
  assert.match(view.actions[1].command, /-ErrorAction Stop/)
})

test('review draft is editable without a legacy producer', async () => {
  const s = setup()
  await s.request('profiles.save', {profile})
  const initial = await s.request('workflow.view')
  assert.deepEqual(initial.draft, {title:'', description:'', base:''})
  assert.equal(initial.actions.length, 1)
  const edited = await s.request('workflow.view', {key:initial.key, draft:{title:'A change', description:'', base:'main'}})
  assert.equal(edited.actions.length, 2)
  await assert.rejects(s.request('workflow.view', {key:initial.key, draft:{title:'Old', description:'', base:'main'}}), /changed/)
})
