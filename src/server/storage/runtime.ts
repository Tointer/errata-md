import type { StorageBackend } from './backend'
import { createFileSystemStorageBackend } from './filesystem-backend'

let storageBackend: StorageBackend = createFileSystemStorageBackend()

export function getStorageBackend(): StorageBackend {
  return storageBackend
}

export function setStorageBackend(nextBackend: StorageBackend): void {
  storageBackend = nextBackend
}