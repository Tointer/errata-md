import { join } from 'node:path'
import { getStoryInternalDir } from '../storage/paths'
import { getStorageBackend } from '../storage/runtime'

export interface ToolCallLog {
  toolName: string
  args: Record<string, unknown>
  result: unknown
}

export interface TokenUsage {
  inputTokens: number
  outputTokens: number
}

export interface GenerationLog {
  id: string
  createdAt: string
  input: string
  messages: Array<{ role: string; content: string }>
  toolCalls: ToolCallLog[]
  generatedText: string
  fragmentId: string | null
  model: string
  durationMs: number
  stepCount: number
  finishReason: string
  stepsExceeded: boolean
  totalUsage?: TokenUsage
  reasoning?: string
  prewriterBrief?: string
  prewriterReasoning?: string
  prewriterMessages?: Array<{ role: string; content: string }>
  prewriterDurationMs?: number
  prewriterModel?: string
  prewriterUsage?: TokenUsage
  prewriterDirections?: Array<{ pacing: string; title: string; description: string; instruction: string }>
}

export interface GenerationLogSummary {
  id: string
  createdAt: string
  input: string
  fragmentId: string | null
  model: string
  durationMs: number
  toolCallCount: number
  stepCount: number
  stepsExceeded: boolean
}

async function logsDir(dataDir: string, storyId: string): Promise<string> {
  return getStoryInternalDir(dataDir, storyId, 'generation-logs')
}

async function logPath(dataDir: string, storyId: string, logId: string): Promise<string> {
  const dir = await logsDir(dataDir, storyId)
  return join(dir, `${logId}.json`)
}

export async function saveGenerationLog(
  dataDir: string,
  storyId: string,
  log: GenerationLog,
): Promise<void> {
  const storage = getStorageBackend()
  const dir = await logsDir(dataDir, storyId)
  await storage.ensureDir(dir)
  await storage.writeJson(await logPath(dataDir, storyId, log.id), log)
}

export async function getGenerationLog(
  dataDir: string,
  storyId: string,
  logId: string,
): Promise<GenerationLog | null> {
  const storage = getStorageBackend()
  const path = await logPath(dataDir, storyId, logId)
  if (!(await storage.exists(path))) return null
  return storage.readJson(path)
}

export async function listGenerationLogs(
  dataDir: string,
  storyId: string,
): Promise<GenerationLogSummary[]> {
  const storage = getStorageBackend()
  const dir = await logsDir(dataDir, storyId)
  const entries = await storage.listDir(dir)
  const summaries: GenerationLogSummary[] = []

  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue
    const log = await storage.readJson<GenerationLog>(join(dir, entry))
    summaries.push({
      id: log.id,
      createdAt: log.createdAt,
      input: log.input,
      fragmentId: log.fragmentId,
      model: log.model,
      durationMs: log.durationMs,
      toolCallCount: log.toolCalls.length,
      stepCount: log.stepCount ?? 1,
      stepsExceeded: log.stepsExceeded ?? false,
    })
  }

  // Sort newest first
  summaries.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return summaries
}
