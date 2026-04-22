import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { DeleteOptions, DirectoryEntry, FileMetadata, StorageBackend } from './backend'

const MAX_FILE_OPERATION_ATTEMPTS = 3
const RETRYABLE_FILE_ERROR_CODES = new Set(['EACCES', 'EBUSY', 'ENOTEMPTY', 'EPERM'])

function isRetryableFileError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && RETRYABLE_FILE_ERROR_CODES.has(String(error.code))
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function withFileOpRetries<T>(operation: () => Promise<T>): Promise<T> {
  let lastError: unknown

  for (let attempt = 1; attempt <= MAX_FILE_OPERATION_ATTEMPTS; attempt++) {
    try {
      return await operation()
    } catch (error) {
      lastError = error
      if (!isRetryableFileError(error) || attempt === MAX_FILE_OPERATION_ATTEMPTS) {
        throw error
      }

      await delay(attempt * 50)
    }
  }

  throw lastError instanceof Error ? lastError : new Error('File operation failed after retries')
}

function mkdirWithRetries(path: string, options?: Parameters<typeof mkdir>[1]): Promise<string | undefined> {
  return withFileOpRetries(() => mkdir(path, options))
}

function readFileWithRetries(path: string, encoding: BufferEncoding): Promise<string>
function readFileWithRetries(path: string): Promise<Buffer>
function readFileWithRetries(path: string, encoding?: BufferEncoding): Promise<string | Buffer> {
  if (encoding) {
    return withFileOpRetries(() => readFile(path, encoding))
  }

  return withFileOpRetries(() => readFile(path))
}

function renameWithRetries(oldPath: string, newPath: string): Promise<void> {
  return withFileOpRetries(() => rename(oldPath, newPath))
}

function rmWithRetries(path: string, options?: Parameters<typeof rm>[1]): Promise<void> {
  return withFileOpRetries(() => rm(path, options))
}

function writeFileWithRetries(
  path: string,
  data: string | NodeJS.ArrayBufferView,
  options?: Parameters<typeof writeFile>[2],
): Promise<void> {
  return withFileOpRetries(() => writeFile(path, data, options))
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  const tmpPath = `${path}.tmp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  await writeFileWithRetries(tmpPath, JSON.stringify(value, null, 2), 'utf-8')
  await renameWithRetries(tmpPath, path)
}

async function ensureParentDir(path: string): Promise<void> {
  await mkdirWithRetries(dirname(path), { recursive: true })
}

async function readMetadata(path: string): Promise<FileMetadata | null> {
  if (!existsSync(path)) return null

  const fileStats = await stat(path)
  return {
    createdAt: fileStats.birthtime.toISOString(),
    updatedAt: fileStats.mtime.toISOString(),
    isDirectory: fileStats.isDirectory(),
  }
}

async function readDirectoryEntries(path: string): Promise<DirectoryEntry[]> {
  if (!existsSync(path)) return []

  const entries = await readdir(path, { withFileTypes: true })
  return Promise.all(entries.map(async (entry) => {
    const fullPath = join(path, entry.name)
    const metadata = await readMetadata(fullPath)

    return {
      name: entry.name,
      createdAt: metadata?.createdAt ?? new Date(0).toISOString(),
      updatedAt: metadata?.updatedAt ?? new Date(0).toISOString(),
      isDirectory: entry.isDirectory(),
    }
  }))
}

async function readTreeEntries(path: string, prefix = ''): Promise<Record<string, Uint8Array>> {
  if (!existsSync(path)) return {}

  const entries = await readdir(path, { withFileTypes: true })
  const files: Record<string, Uint8Array> = {}

  for (const entry of entries) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name
    const fullPath = join(path, entry.name)
    if (entry.isDirectory()) {
      Object.assign(files, await readTreeEntries(fullPath, relativePath))
      continue
    }

    files[relativePath] = new Uint8Array(await readFileWithRetries(fullPath))
  }

  return files
}

export function createFileSystemStorageBackend(): StorageBackend {
  return {
    async delete(path: string, options?: DeleteOptions): Promise<void> {
      await rmWithRetries(path, options?.recursive ? { force: true, recursive: true } : { force: true })
    },

    async deleteIfExists(path: string, options?: DeleteOptions): Promise<void> {
      if (!existsSync(path)) return
      await rmWithRetries(path, options?.recursive ? { force: true, recursive: true } : { force: true })
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

    async listDirDetailed(path: string): Promise<DirectoryEntry[]> {
      return readDirectoryEntries(path)
    },

    async readTree(path: string): Promise<Record<string, Uint8Array>> {
      return readTreeEntries(path)
    },

    async move(fromPath: string, toPath: string): Promise<void> {
      await ensureParentDir(toPath)
      await renameWithRetries(fromPath, toPath)
    },

    async readBytes(path: string): Promise<Uint8Array> {
      return new Uint8Array(await readFileWithRetries(path))
    },

    async readJson<T>(path: string): Promise<T> {
      return JSON.parse(await readFileWithRetries(path, 'utf-8')) as T
    },

    async readJsonOrDefault<T>(path: string, fallback: T): Promise<T> {
      if (!existsSync(path)) return fallback
      return JSON.parse(await readFileWithRetries(path, 'utf-8')) as T
    },

    async readJsonIfExists<T>(path: string): Promise<T | null> {
      if (!existsSync(path)) return null
      return JSON.parse(await readFileWithRetries(path, 'utf-8')) as T
    },

    async readText(path: string): Promise<string> {
      return readFileWithRetries(path, 'utf-8')
    },

    async readTextIfExists(path: string): Promise<string | null> {
      if (!existsSync(path)) return null
      return readFileWithRetries(path, 'utf-8')
    },

    async writeBytes(path: string, content: Uint8Array): Promise<void> {
      await ensureParentDir(path)
      await writeFileWithRetries(path, content)
    },

    async writeJson(path: string, value: unknown): Promise<void> {
      await ensureParentDir(path)
      await writeJsonAtomic(path, value)
    },

    async writeText(path: string, content: string): Promise<void> {
      await ensureParentDir(path)
      await writeFileWithRetries(path, content, 'utf-8')
    },
  }
}