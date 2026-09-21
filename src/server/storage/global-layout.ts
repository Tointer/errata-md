import { join } from 'node:path'

export function resolveGlobalDataDir(dataDir: string): string {
  return process.env.GLOBAL_DATA_DIR?.trim() || dataDir
}

export function getGlobalStoragePath(dataDir: string, ...segments: string[]): string {
  return join(resolveGlobalDataDir(dataDir), ...segments)
}
