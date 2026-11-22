import { constants, watch } from 'node:fs'
import { lstat, mkdir, open, readdir, rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { orcaDataPath } from './session-context.mjs'
import { setTimeout as wait } from 'node:timers/promises'

const ticket = /^\d+-[0-9a-f-]{36}\.json$/u
const maxSize = 1024 * 1024
const remove = path => unlink(path).catch(e => { if (e.code !== 'ENOENT') throw e })
async function readPrivate(path) {
  const entry = await lstat(path)
  if (!entry.isFile()) throw Error('Unsafe inbox file.')
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0))
  try {
    const st = await file.stat()
    if (!st.isFile() || st.dev !== entry.dev || st.ino !== entry.ino || st.size > maxSize || (process.platform !== 'win32' && (st.uid !== process.getuid() || (st.mode & 0o077)))) throw Error('Unsafe inbox file.')
    const buffer = Buffer.allocUnsafe(st.size + 1)
    let size = 0
    while (size < buffer.length) {
      const { bytesRead } = await file.read(buffer, size, buffer.length - size, null)
      if (!bytesRead) break
      size += bytesRead
    }
    if (size !== st.size) throw Error('Inbox file changed while being read.')
    return JSON.parse(buffer.toString('utf8', 0, size))
  } finally { await file.close() }
}
async function writePrivate(path, value) {
  const content = JSON.stringify(value)
  if (Buffer.byteLength(content) > maxSize) throw Error('Inbox file exceeds 1 MiB.')
  await writeFile(path + '.tmp', content, { mode: 0o600, flag: 'wx' })
  try { await rename(path + '.tmp', path) } catch (e) { await remove(path + '.tmp'); throw e }
}
export async function inbox(key, base = orcaDataPath()) {
  if (typeof key !== 'string' || !/^[a-z0-9][a-z0-9-]*\.session-summary$/u.test(key)) throw Error('Expected the installed Threadbrief plugin key, for example local.session-summary.')
  let path = base
  for (const part of ['threadbrief-profile-imports', key]) {
    path = join(path, part)
    try { await mkdir(path, { mode: 0o700 }) } catch (e) { if (e.code !== 'EEXIST') throw e }
    const s = await lstat(path)
    if (!s.isDirectory() || (process.platform !== 'win32' && (s.uid !== process.getuid() || (s.mode & 0o077)))) throw Error('The profile inbox must be a private directory owned by you.')
  }
  return path
}
export async function enqueue(dir, profile, enable) {
  const path = join(dir, `${Date.now()}-${randomUUID()}.json`)
  await writePrivate(path, { profile, enable })
  return path
}
export async function requestConfig(dir, config) {
  const path = join(dir, `${Date.now()}-${randomUUID()}.json`)
  const response = path + '.response'
  await writePrivate(path, { config })
  try {
    for (let i = 0; i < 50; i++) {
      try {
        const receipt = await readPrivate(response)
        if (receipt?.ok === true && Object.hasOwn(receipt, 'value')) return receipt.value
        if (receipt?.ok === false && typeof receipt.error === 'string') throw Error(receipt.error)
        throw Error('Invalid configuration receipt.')
      } catch (e) { if (e.code !== 'ENOENT') throw e }
      await wait(100)
    }
    throw Error('Configuration request timed out. It may already have been applied.')
  } finally {
    await remove(path)
    await remove(response)
  }
}
export async function receive(dir, accept, log, configure) {
  let pending = Promise.resolve(), closed = false
  async function drain() {
    for (const name of (await readdir(dir)).filter(n => ticket.test(n)).sort()) {
      if (closed) return
      const path = join(dir, name)
      try {
        const job = await readPrivate(path)
        if (job && Object.hasOwn(job, 'config')) {
          let receipt
          try {
            if (!configure || Object.keys(job).length !== 1) throw Error('Invalid configuration request.')
            const value = await configure(job.config)
            if (value === undefined) throw Error('Configuration returned no result.')
            receipt = { ok: true, value }
          } catch (error) { receipt = { ok: false, error: String(error?.message || error) } }
          try {
            await lstat(path)
            try { await writePrivate(path + '.response', receipt) }
            catch (e) {
              if (e.message !== 'Inbox file exceeds 1 MiB.') throw e
              await writePrivate(path + '.response', { ok: false, error: 'Configuration response exceeds 1 MiB.' })
            }
            try { await lstat(path) } catch (e) { if (e.code !== 'ENOENT') throw e; await remove(path + '.response') }
          } catch (e) { if (e.code !== 'ENOENT') throw e }
          await remove(path)
        } else {
          if (typeof job.enable !== 'boolean') throw Error('Invalid enable flag.')
          const result = await accept(job.profile, job.enable)
          if (result?.commandsOff) await rename(path, path + '.saved')
          else await unlink(path)
        }
      } catch (error) {
        try { await rename(path, path + '.failed') } catch (e) { if (e.code === 'ENOENT') continue; throw e }
        log(`Profile import ${name} failed: ${error.message}`)
      }
    }
  }
  const schedule = () => { pending = pending.then(drain).catch(e => log(e.message)) }
  const watcher = watch(dir, { persistent: false }, (_, name) => { if (!name || ticket.test(name)) schedule() })
  watcher.on('error', e => log(e.message))
  schedule()
  return () => { closed = true; watcher.close() }
}
