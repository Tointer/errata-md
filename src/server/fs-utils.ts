import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

const MAX_FILE_OPERATION_ATTEMPTS = 3
const RETRYABLE_FILE_ERROR_CODES = new Set(['EACCES', 'EBUSY', 'ENOTEMPTY', 'EPERM'])

function isRetryableFileError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error
    && 'code' in error
    && RETRYABLE_FILE_ERROR_CODES.has(String(error.code))
}

async function withFileOperationRetries<T>(operation: () => Promise<T>): Promise<T> {
  let lastError: unknown

  for (let attempt = 1; attempt <= MAX_FILE_OPERATION_ATTEMPTS; attempt += 1) {
    try {
      return await operation()
    } catch (error) {
      lastError = error
      if (!isRetryableFileError(error) || attempt === MAX_FILE_OPERATION_ATTEMPTS) throw error
      await new Promise((resolve) => setTimeout(resolve, attempt * 50))
    }
  }

  throw lastError
}

export async function readTextIfExists(path: string): Promise<string | null> {
  try {
    return await withFileOperationRetries(() => readFile(path, 'utf-8'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

export async function writeTextAtomic(path: string, value: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const tmpPath = `${path}.tmp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  await withFileOperationRetries(() => writeFile(tmpPath, value, 'utf-8'))
  await withFileOperationRetries(() => rename(tmpPath, path))
}

export async function moveFileWithRetry(from: string, to: string): Promise<void> {
  await mkdir(dirname(to), { recursive: true })
  await withFileOperationRetries(() => rename(from, to))
}

export async function removeFileWithRetry(path: string): Promise<void> {
  await withFileOperationRetries(() => rm(path, { force: true }))
}

export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await writeTextAtomic(path, JSON.stringify(value, null, 2))
}
