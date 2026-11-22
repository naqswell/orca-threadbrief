import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, open, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { crc32, inflateSync } from 'node:zlib'
import { safeEnvironment, sessionId } from './session-context.mjs'

export const directory = join(homedir(), '.session-summary')
export const legacyDirectory = join(homedir(), '.crabby-task-summaries')
export const maxBytes = 16384
const maxFrame = 700 * 1024
const digest = value => createHash('sha256').update(value).digest('hex')
export function filename(identity) {
  if (typeof identity !== 'string' || !/^identity:wt2:[^:\s]+:[^:\s]+$/u.test(identity) || identity.length > 1024) throw Error('Invalid worktree identity.')
  return digest(identity) + '.json'
}
export function sessionFilename(value) {
  const id = sessionId(value)
  if (!id) throw Error('Invalid session ID.')
  return digest(`orca_session_id:${id}`) + '.json'
}
export function sessionDirectory(root, environment) {
  if (!safeEnvironment(environment)) throw Error('Invalid environment ID.')
  return join(root, 'sessions', environment)
}
function secure(stat, directory) {
  if (directory ? !stat.isDirectory() : !stat.isFile()) throw Error('Unsafe summary file.')
  if (process.platform !== 'win32' && (stat.uid !== process.getuid() || (stat.mode & 0o077))) throw Error('Summary files must be private.')
}
async function privatePath(root, parts) {
  let path = root
  secure(await lstat(path), true)
  for (const part of parts) { path = join(path, part); secure(await lstat(path), true) }
  return path
}
const text = value => typeof value === 'string' && value.trim() && value.length <= 480 && !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value) ? value : null
function linkMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid links.')
  const out = {}
  for (const [name, href] of Object.entries(value)) {
    if (!text(name) || typeof href !== 'string' || href.length > 1200 || /[\s\\\p{Cc}]/u.test(href)) throw Error('Invalid link.')
    const url = new URL(href)
    if (url.protocol !== 'https:' || url.username || url.password) throw Error('Invalid link.')
    out[name] = href
  }
  return out
}
export function summary(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid summary.')
  const goal = text(value.goal), done = text(value.done), next = text(value.next)
  if (!goal || !done || !next) throw Error('Invalid summary text.')
  const out = { goal, done, next, links: linkMap(value.links ?? {}) }
  if (value.checkpoint !== undefined) {
    const { revision, decisions, checks, open } = value.checkpoint ?? {}
    if (!Number.isSafeInteger(revision) || revision < 1 || !text(decisions) || !text(checks) || !text(open)) throw Error('Invalid session checkpoint.')
    out.checkpoint = { revision, decisions, checks, open }
    const formatted = value.checkpoint.formatted
    if (formatted !== undefined) {
      if (typeof formatted !== 'string' || !formatted.trim() || formatted.length > 2400 || /[\u0000-\u0008\u000b-\u001f\u007f]/u.test(formatted) || /^(?:…|\.\.\.)$/u.test(formatted.trim())) throw Error('Invalid formatted report.')
      out.checkpoint.formatted = formatted
    }
  }
  if (typeof value.dispatch === 'string' && /^[\w-]{1,128}$/u.test(value.dispatch)) out.dispatch = value.dispatch
  if (value.result !== undefined) {
    const r = value.result
    if (!r || typeof r !== 'object' || Array.isArray(r) || !['completed', 'partial', 'blocked'].includes(r.status) || !text(r.changes) || !text(r.checks) || (r.limits !== undefined && !text(r.limits)) || (r.status !== 'completed' && !text(r.limits))) throw Error('Invalid result.')
    const result = { status: r.status, changes: r.changes, checks: r.checks }
    if (r.limits !== undefined) result.limits = r.limits
    if (r.links !== undefined) result.links = linkMap(r.links)
    if (r.questions !== undefined) {
      if (!Array.isArray(r.questions) || r.questions.length > 6 || r.questions.some(q => !q || !text(q.question) || !text(q.owner) || !text(q.impact))) throw Error('Invalid questions.')
      result.questions = r.questions.map(({ question, owner, impact }) => ({ question, owner, impact }))
    }
    if (r.noPair !== undefined) { if (!text(r.noPair)) throw Error('Invalid image description.'); result.noPair = r.noPair }
    if (r.pairs !== undefined) {
      if (r.noPair || !Array.isArray(r.pairs) || !r.pairs.length || r.pairs.length > 3 || r.pairs.some(p => !p || !text(p.title) || ![p.before, p.after].every(h => typeof h === 'string' && /^[0-9a-f]{64}$/u.test(h)))) throw Error('Invalid image pairs.')
      result.pairs = r.pairs.map(({ title, before, after }) => ({ title, before, after }))
    }
    out.result = result
  }
  return out
}
function png(bytes) {
  const invalid = () => { throw Error('Invalid PNG.') }
  const signature = Buffer.from('89504e470d0a1a0a', 'hex')
  if (bytes.length > maxFrame || !bytes.subarray(0, 8).equals(signature)) invalid()
  const chunks = [signature], pixels = []
  let width, height, stride, end = false
  for (let pos = 8; pos < bytes.length;) {
    if (pos + 12 > bytes.length) invalid()
    const n = bytes.readUInt32BE(pos), next = pos + 12 + n
    if (next > bytes.length || crc32(bytes.subarray(pos + 4, next - 4)) !== bytes.readUInt32BE(next - 4)) invalid()
    const type = bytes.toString('latin1', pos + 4, pos + 8), data = bytes.subarray(pos + 8, next - 4)
    if (type === 'IHDR') {
      if (pos !== 8 || n !== 13) invalid()
      width = data.readUInt32BE(0); height = data.readUInt32BE(4)
      if (!width || !height || width > 4096 || height > 4096 || width * height > 8_000_000 || data[8] !== 8 || ![2, 6].includes(data[9]) || data[10] || data[11] || data[12]) invalid()
      stride = 1 + width * (data[9] === 6 ? 4 : 3)
    } else if (!width) invalid()
    else if (type === 'IDAT') pixels.push(data)
    else if (type === 'IEND') { if (n || next !== bytes.length || !pixels.length) invalid(); end = true }
    else if (type === 'tRNS' || type === 'acTL' || !/^[a-z][A-Za-z]{3}$/u.test(type)) invalid()
    if (['IHDR', 'IDAT', 'IEND'].includes(type)) chunks.push(bytes.subarray(pos, next))
    pos = next
  }
  if (!end) invalid()
  const raw = inflateSync(Buffer.concat(pixels), { maxOutputLength: stride * height })
  if (raw.length !== stride * height) invalid()
  for (let pos = 0; pos < raw.length; pos += stride) if (raw[pos] > 4) invalid()
  return Buffer.concat(chunks)
}
export async function readSnapshot(root, parts, name, hash, includePrivate = false) {
  try {
    const path = await privatePath(root, parts)
    const filePath = join(path, name)
    const before = await lstat(filePath)
    secure(before, false)
    const file = await open(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0))
    try {
      const stat = await file.stat()
      secure(stat, false)
      if (stat.ino !== before.ino || stat.dev !== before.dev || stat.size > maxBytes + 6 * Math.ceil(maxFrame / 3) * 4 + 512) throw Error('Unsafe summary file.')
      const data = JSON.parse(await file.readFile('utf8'))
      const meta = summary(data)
      if (includePrivate) {
        const publication = data.result?.publication
        if (!publication || typeof publication !== 'object' || Array.isArray(publication)) return { meta }
        const short = value => typeof value === 'string' && value.length <= 4096 && !/[\0\r\n]/u.test(value) ? value : undefined
        const mr = publication.mr && typeof publication.mr === 'object' && !Array.isArray(publication.mr) ? publication.mr : {}
        const description = typeof mr.description === 'string' && mr.description.length <= 8192 && !mr.description.includes('\0') ? mr.description : undefined
        return { meta, legacyPublication: { cwd: short(publication.cwd), branch: short(publication.branch), repo: short(publication.repo), mr: { title: short(mr.title), description, base: short(mr.base) } } }
      }
      if (hash === undefined) return meta
      if (!meta.result?.pairs?.some(p => p.before === hash || p.after === hash)) throw Error('Image is not in the current summary.')
      const frame = data.frames?.[hash]
      if (typeof frame !== 'string' || frame.length > Math.ceil(maxFrame / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(frame)) throw Error('Image is unavailable.')
      const clean = png(Buffer.from(frame, 'base64'))
      if (digest(clean) !== hash) throw Error('Image does not match its ID.')
      return clean.toString('base64')
    } finally { await file.close() }
  } catch (error) { if (error.code === 'ENOENT') return null; throw error }
}

export async function saveSession(root, environment, id, value, shouldReplace) {
  if (!safeEnvironment(environment)) throw Error('Invalid environment ID.')
  const name = sessionFilename(id)
  const record = summary(value)
  const serialized = JSON.stringify(record) + '\n'
  if (Buffer.byteLength(serialized) > maxBytes) throw Error('Summary exceeds 16 KiB.')
  let path = root
  for (const part of ['', 'sessions', environment]) {
    if (part) path = join(path, part)
    try { await mkdir(path, { mode: 0o700 }) } catch (error) { if (error.code !== 'EEXIST') throw error }
    secure(await lstat(path), true)
  }
  const target = join(path, name), lockPath = target + '.lock', temporary = join(path, '.' + randomUUID())
  const lock = await open(lockPath, 'wx', 0o600)
  try {
    await writeFile(temporary, serialized, { flag: 'wx', mode: 0o600 })
    if (shouldReplace && !await shouldReplace()) return target
    await rename(temporary, target)
  } finally {
    await lock.close()
    await rm(lockPath, { force: true })
    await rm(temporary, { force: true })
  }
  return target
}
