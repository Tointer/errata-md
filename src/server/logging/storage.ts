import { readdir } from 'node:fs/promises'
import type { LogEntry, LogSummary } from './types'
import { getAppLogFilePath, getAppLogsDir } from '../storage/paths'
import { getStorageBackend } from '../storage/runtime'

const MAX_LOGS_PER_FILE = 1000
const MAX_LOG_FILES = 5

function logsDir(dataDir: string): string {
  return getAppLogsDir(dataDir)
}

function logFilePath(dataDir: string, index: number): string {
  return getAppLogFilePath(dataDir, index)
}

/**
 * Save a log entry to the application log file.
 * Uses rotating log files to prevent unbounded growth.
 */
export async function saveLogEntry(dataDir: string, entry: LogEntry): Promise<void> {
  const storage = getStorageBackend()
  const dir = logsDir(dataDir)
  await storage.ensureDir(dir)

  // Find the current log file
  let currentIndex = 0
  for (let i = 0; i < MAX_LOG_FILES; i++) {
    const path = logFilePath(dataDir, i)
    if (!(await storage.exists(path))) {
      currentIndex = i
      break
    }
    const stats = await storage.readText(path)
    const lines = stats.split('\n').filter(line => line.trim())
    if (lines.length < MAX_LOGS_PER_FILE) {
      currentIndex = i
      break
    }
    currentIndex = i + 1
  }

  // Rotate if needed
  if (currentIndex >= MAX_LOG_FILES) {
    // Remove oldest file and shift others
    for (let i = 0; i < MAX_LOG_FILES - 1; i++) {
      const oldPath = logFilePath(dataDir, i + 1)
      const newPath = logFilePath(dataDir, i)
      if (await storage.exists(oldPath)) {
        const content = await storage.readText(oldPath)
        await storage.writeText(newPath, content, { ensureDir: true })
      }
    }
    currentIndex = MAX_LOG_FILES - 1
  }

  const path = logFilePath(dataDir, currentIndex)
  const line = JSON.stringify(entry) + '\n'
  
  // Append to file
  const existing = await storage.exists(path) ? await storage.readText(path) : ''
  await storage.writeText(path, existing + line, { ensureDir: true })
}

/**
 * List recent log entries with optional filtering.
 */
export async function listLogs(
  dataDir: string,
  options: {
    level?: 'debug' | 'info' | 'warn' | 'error'
    component?: string
    storyId?: string
    limit?: number
  } = {}
): Promise<LogSummary[]> {
  const storage = getStorageBackend()
  const { level, component, storyId, limit = 100 } = options
  const entries: LogSummary[] = []

  // Read from all log files, newest first
  for (let i = MAX_LOG_FILES - 1; i >= 0; i--) {
    const path = logFilePath(dataDir, i)
    if (!(await storage.exists(path))) continue

    const content = await storage.readText(path)
    const lines = content.split('\n').filter(line => line.trim())

    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as LogEntry
        if (level && entry.level !== level) continue
        if (component && entry.component !== component) continue
        if (storyId && entry.storyId !== storyId) continue
        
        entries.push({
          id: entry.id,
          timestamp: entry.timestamp,
          level: entry.level,
          component: entry.component,
          message: entry.message,
          storyId: entry.storyId,
        })
      } catch {
        // Skip invalid lines
      }
    }
  }

  // Sort newest first and limit
  entries.sort((a, b) => b.timestamp.localeCompare(a.timestamp))
  return entries.slice(0, limit)
}

/**
 * Get a specific log entry by ID.
 */
export async function getLogEntry(dataDir: string, logId: string): Promise<LogEntry | null> {
  const storage = getStorageBackend()
  for (let i = 0; i < MAX_LOG_FILES; i++) {
    const path = logFilePath(dataDir, i)
    if (!(await storage.exists(path))) continue

    const content = await storage.readText(path)
    const lines = content.split('\n').filter(line => line.trim())

    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as LogEntry
        if (entry.id === logId) return entry
      } catch {
        // Skip invalid lines
      }
    }
  }
  return null
}

/**
 * Clear all application logs.
 */
export async function clearLogs(dataDir: string): Promise<void> {
  const storage = getStorageBackend()
  const dir = logsDir(dataDir)
  if (!(await storage.exists(dir))) return

  const entries = await readdir(dir)
  for (const entry of entries) {
    if (entry.startsWith('app-') && entry.endsWith('.jsonl')) {
      await storage.writeText(logFilePath(dataDir, Number.parseInt(entry.slice(4, -6), 10)), '', { ensureDir: true })
    }
  }
}
