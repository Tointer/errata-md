export interface WriteOptions {
  ensureDir?: boolean
}

export interface DeleteOptions {
  recursive?: boolean
}

export interface StorageBackend {
  delete(path: string, options?: DeleteOptions): Promise<void>
  exists(path: string): Promise<boolean>
  ensureDir(path: string): Promise<void>
  listDir(path: string): Promise<string[]>
  readJson<T>(path: string): Promise<T>
  readText(path: string): Promise<string>
  writeJson(path: string, value: unknown, options?: WriteOptions): Promise<void>
  writeText(path: string, content: string, options?: WriteOptions): Promise<void>
}