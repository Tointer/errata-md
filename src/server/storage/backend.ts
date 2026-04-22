export interface DeleteOptions {
  recursive?: boolean
}

export interface FileMetadata {
  createdAt: string
  updatedAt: string
  isDirectory: boolean
}

export interface DirectoryEntry extends FileMetadata {
  name: string
}

export interface StorageBackend {
  delete(path: string, options?: DeleteOptions): Promise<void>
  deleteIfExists(path: string, options?: DeleteOptions): Promise<void>
  exists(path: string): Promise<boolean>
  ensureDir(path: string): Promise<void>
  listDir(path: string): Promise<string[]>
  listDirDetailed(path: string): Promise<DirectoryEntry[]>
  readTree(path: string): Promise<Record<string, Uint8Array>>
  move(fromPath: string, toPath: string): Promise<void>
  readBytes(path: string): Promise<Uint8Array>
  readJson<T>(path: string): Promise<T>
  readJsonOrDefault<T>(path: string, fallback: T): Promise<T>
  readJsonIfExists<T>(path: string): Promise<T | null>
  readText(path: string): Promise<string>
  readTextIfExists(path: string): Promise<string | null>
  writeBytes(path: string, content: Uint8Array): Promise<void>
  writeJson(path: string, value: unknown): Promise<void>
  writeText(path: string, content: string): Promise<void>
}