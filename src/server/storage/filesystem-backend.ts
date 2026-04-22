import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { DeleteOptions, StorageBackend, WriteOptions } from './backend'
import { mkdirWithRetries, readFileWithRetries, rmWithRetries, writeFileWithRetries, writeJsonAtomic } from '../fs-utils'

async function ensureParentDir(path: string, options?: WriteOptions): Promise<void> {
  if (!options?.ensureDir) return
  await mkdirWithRetries(dirname(path), { recursive: true })
}

export function createFileSystemStorageBackend(): StorageBackend {
  return {
    async delete(path: string, options?: DeleteOptions): Promise<void> {
      await rmWithRetries(path, { force: true, recursive: options?.recursive })
    },

    async exists(path: string): Promise<boolean> {
      return existsSync(path)
    },

    async ensureDir(path: string): Promise<void> {
      await mkdirWithRetries(path, { recursive: true })
    },

    async listDir(path: string): Promise<string[]> {
      if (!existsSync(path)) return []
      return readdir(path)
    },

    async readJson<T>(path: string): Promise<T> {
      return JSON.parse(await readFileWithRetries(path, 'utf-8')) as T
    },

    async readText(path: string): Promise<string> {
      return readFileWithRetries(path, 'utf-8')
    },

    async writeJson(path: string, value: unknown, options?: WriteOptions): Promise<void> {
      await ensureParentDir(path, options)
      await writeJsonAtomic(path, value)
    },

    async writeText(path: string, content: string, options?: WriteOptions): Promise<void> {
      await ensureParentDir(path, options)
      await writeFileWithRetries(path, content, 'utf-8')
    },
  }
}