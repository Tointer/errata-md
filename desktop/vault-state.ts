import { app } from 'electron'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'

const STATE_FILE = 'vault-state.json'
const MAX_RECENT_VAULTS = 8

export interface VaultSummary {
  path: string
  name: string
  isActive: boolean
}

interface VaultStateFile {
  activeVaultPath?: string
  recentVaultPaths?: string[]
}

export function globalDataDir(): string {
  return join(app.getPath('userData'), 'data')
}

export function defaultVaultPath(): string {
  return globalDataDir()
}

function statePath(): string {
  return join(globalDataDir(), STATE_FILE)
}

export function normalizeVaultPath(path: string): string {
  return resolve(path)
}

function normalizeRecent(paths: string[], active: string): string[] {
  return [...new Set([active, ...paths].map(normalizeVaultPath))].slice(0, MAX_RECENT_VAULTS)
}

export async function readVaultState(): Promise<{ activeVaultPath: string; recentVaultPaths: string[] }> {
  const fallback = normalizeVaultPath(defaultVaultPath())
  try {
    const parsed = JSON.parse(await readFile(statePath(), 'utf-8')) as VaultStateFile
    const activeVaultPath = normalizeVaultPath(parsed.activeVaultPath || fallback)
    return {
      activeVaultPath,
      recentVaultPaths: normalizeRecent(parsed.recentVaultPaths ?? [], activeVaultPath),
    }
  } catch {
    return { activeVaultPath: fallback, recentVaultPaths: [fallback] }
  }
}

export async function saveActiveVault(path: string): Promise<void> {
  const previous = await readVaultState()
  const activeVaultPath = normalizeVaultPath(path)
  await mkdir(join(activeVaultPath, 'stories'), { recursive: true })
  await mkdir(globalDataDir(), { recursive: true })
  await writeFile(statePath(), JSON.stringify({
    activeVaultPath,
    recentVaultPaths: normalizeRecent(previous.recentVaultPaths, activeVaultPath),
  }, null, 2))
}

export async function forgetVault(path: string): Promise<void> {
  const state = await readVaultState()
  const target = normalizeVaultPath(path)
  if (target === state.activeVaultPath) return
  await writeFile(statePath(), JSON.stringify({
    ...state,
    recentVaultPaths: state.recentVaultPaths.filter((entry) => entry !== target),
  }, null, 2))
}

export function summarizeVaults(activeVaultPath: string, recentVaultPaths: string[]): VaultSummary[] {
  return normalizeRecent(recentVaultPaths, activeVaultPath).map((path) => ({
    path,
    name: basename(path) || path,
    isActive: path === activeVaultPath,
  }))
}
