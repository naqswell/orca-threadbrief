import { constants, watch } from 'node:fs'
import { lstat, mkdir, open, readdir, rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { orcaDataPath } from './session-context.mjs'

const ticket = /^\d+-[0-9a-f-]{36}\.json$/u
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
  await writeFile(path + '.tmp', JSON.stringify({ profile, enable }), { mode: 0o600, flag: 'wx' })
  await rename(path + '.tmp', path)
  return path
}
export async function receive(dir, accept, log) {
  let pending = Promise.resolve(), closed = false
  async function drain() {
    for (const name of (await readdir(dir)).filter(n => ticket.test(n)).sort()) {
      if (closed) return
      const path = join(dir, name)
      try {
        const flags = constants.O_RDONLY | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0)
        const file = await open(path, flags)
        let job
        try {
          const st = await file.stat()
          if (!st.isFile() || st.size > 1024 * 1024 || (process.platform !== 'win32' && (st.uid !== process.getuid() || (st.mode & 0o077)))) throw Error('Unsafe profile file.')
          job = JSON.parse(await file.readFile('utf8'))
        } finally { await file.close() }
        if (typeof job.enable !== 'boolean') throw Error('Invalid enable flag.')
        const result = await accept(job.profile, job.enable)
        if (result?.commandsOff) await rename(path, path + '.saved')
        else await unlink(path)
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
