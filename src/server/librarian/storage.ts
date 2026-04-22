import { generateConversationId } from '@/lib/fragment-ids'
import {
  getLibrarianAnalysesDir,
  getLibrarianAnalysisFile,
  getLibrarianAnalysisIndexFile,
  getLibrarianChatHistoryFile,
  getLibrarianConversationHistoryFile,
  getLibrarianConversationsIndexFile,
  getLibrarianDir,
  getLibrarianStateFile,
} from '../storage/paths'
import { getStorageBackend } from '../storage/runtime'

// --- Types ---

export interface LibrarianAnalysis {
  id: string
  createdAt: string
  fragmentId: string
  /** The summary text the librarian intended to record (intent). */
  summaryUpdate: string
  /**
   * ID of the summary fragment this analysis contributed to (artifact).
   * Set when the deferred-summary application creates or appends to a
   * chapter summary fragment. Undefined for legacy analyses written before
   * summary fragments existed.
   */
  summaryFragmentId?: string
  structuredSummary?: {
    events: string[]
    stateChanges: string[]
    openThreads: string[]
  }
  mentionedCharacters: string[]
  mentions?: Array<{ characterId: string; text: string }>
  contradictions: Array<{
    description: string
    fragmentIds: string[]
  }>
  fragmentSuggestions: Array<{
    type: 'character' | 'knowledge'
    targetFragmentId?: string
    name: string
    description: string
    content: string
    sourceFragmentId?: string
    accepted?: boolean
    autoApplied?: boolean
    createdFragmentId?: string
    dismissed?: boolean
  }>
  /** @deprecated Use fragmentSuggestions. Kept for backward compat with stored JSON. */
  knowledgeSuggestions?: Array<{
    type: 'character' | 'knowledge'
    targetFragmentId?: string
    name: string
    description: string
    content: string
    sourceFragmentId?: string
    accepted?: boolean
    autoApplied?: boolean
    createdFragmentId?: string
  }>
  timelineEvents: Array<{
    event: string
    position: 'before' | 'during' | 'after'
  }>
  directions?: Array<{
    title: string
    description: string
    instruction: string
  }>
  trace?: Array<{
    type: string
    [key: string]: unknown
  }>
}

export function selectLatestAnalysesByFragment(
  summaries: LibrarianAnalysisSummary[],
): Map<string, LibrarianAnalysisSummary> {
  const latest = new Map<string, LibrarianAnalysisSummary>()

  for (const summary of summaries) {
    const prev = latest.get(summary.fragmentId)
    if (!prev) {
      latest.set(summary.fragmentId, summary)
      continue
    }

    if (
      summary.createdAt > prev.createdAt
      || (summary.createdAt === prev.createdAt && summary.id > prev.id)
    ) {
      latest.set(summary.fragmentId, summary)
    }
  }

  return latest
}

export interface LibrarianAnalysisSummary {
  id: string
  createdAt: string
  fragmentId: string
  contradictionCount: number
  suggestionCount: number
  pendingSuggestionCount: number
  timelineEventCount: number
  directionsCount: number
  hasTrace?: boolean
}

export interface LibrarianState {
  lastAnalyzedFragmentId: string | null
  /** Fragment ID up to which summaries have been applied to the story summary */
  summarizedUpTo: string | null
  recentMentions: Record<string, string[]>
  timeline: Array<{ event: string; fragmentId: string }>
}

export interface LibrarianAnalysisIndexEntry {
  analysisId: string
  createdAt: string
}

export interface LibrarianAnalysisIndex {
  version: 1
  updatedAt: string
  latestByFragmentId: Record<string, LibrarianAnalysisIndexEntry>
  appliedSummarySequence?: string[]
}

// --- Path helpers ---

async function librarianDir(dataDir: string, storyId: string): Promise<string> {
  return getLibrarianDir(dataDir, storyId)
}

async function analysesDir(dataDir: string, storyId: string): Promise<string> {
  return getLibrarianAnalysesDir(dataDir, storyId)
}

async function analysisPath(dataDir: string, storyId: string, analysisId: string): Promise<string> {
  return getLibrarianAnalysisFile(dataDir, storyId, analysisId)
}

async function statePath(dataDir: string, storyId: string): Promise<string> {
  return getLibrarianStateFile(dataDir, storyId)
}

async function analysisIndexPath(dataDir: string, storyId: string): Promise<string> {
  return getLibrarianAnalysisIndexFile(dataDir, storyId)
}

function shouldReplaceIndexEntry(
  previous: LibrarianAnalysisIndexEntry | undefined,
  incoming: { createdAt: string; analysisId: string },
): boolean {
  if (!previous) return true
  if (incoming.createdAt > previous.createdAt) return true
  if (incoming.createdAt < previous.createdAt) return false
  return incoming.analysisId > previous.analysisId
}

function defaultAnalysisIndex(): LibrarianAnalysisIndex {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    latestByFragmentId: {},
  }
}

async function saveAnalysisIndex(
  dataDir: string,
  storyId: string,
  index: LibrarianAnalysisIndex,
): Promise<void> {
  const storage = getStorageBackend()
  const dir = await librarianDir(dataDir, storyId)
  await storage.ensureDir(dir)
  await storage.writeJson(await analysisIndexPath(dataDir, storyId), index)
}

export async function getAnalysisIndex(
  dataDir: string,
  storyId: string,
): Promise<LibrarianAnalysisIndex | null> {
  const storage = getStorageBackend()
  const path = await analysisIndexPath(dataDir, storyId)
  if (!(await storage.exists(path))) return null
  const parsed = await storage.readJson<Partial<LibrarianAnalysisIndex>>(path)
  return {
    version: 1,
    updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
    latestByFragmentId: parsed.latestByFragmentId ?? {},
    appliedSummarySequence: Array.isArray(parsed.appliedSummarySequence) ? parsed.appliedSummarySequence : undefined,
  }
}

function analysisSummaryToIndexEntry(summary: LibrarianAnalysisSummary): LibrarianAnalysisIndexEntry {
  return {
    analysisId: summary.id,
    createdAt: summary.createdAt,
  }
}

export async function rebuildAnalysisIndex(
  dataDir: string,
  storyId: string,
): Promise<LibrarianAnalysisIndex> {
  const summaries = await listAnalyses(dataDir, storyId)
  const latest = selectLatestAnalysesByFragment(summaries)
  const rebuilt: LibrarianAnalysisIndex = defaultAnalysisIndex()
  for (const [fragmentId, summary] of latest.entries()) {
    rebuilt.latestByFragmentId[fragmentId] = analysisSummaryToIndexEntry(summary)
  }
  rebuilt.updatedAt = new Date().toISOString()
  await saveAnalysisIndex(dataDir, storyId, rebuilt)
  return rebuilt
}

export async function clearAnalysisIndexEntry(
  dataDir: string,
  storyId: string,
  fragmentId: string,
): Promise<void> {
  const index = await getAnalysisIndex(dataDir, storyId)
  if (!index) return
  if (!(fragmentId in index.latestByFragmentId)) return
  delete index.latestByFragmentId[fragmentId]
  index.updatedAt = new Date().toISOString()
  await saveAnalysisIndex(dataDir, storyId, index)
}

export async function getLatestAnalysisIdsByFragment(
  dataDir: string,
  storyId: string,
): Promise<Map<string, string>> {
  const index = await getAnalysisIndex(dataDir, storyId) ?? await rebuildAnalysisIndex(dataDir, storyId)
  return new Map(
    Object.entries(index.latestByFragmentId)
      .map(([fragmentId, entry]) => [fragmentId, entry.analysisId]),
  )
}

// --- Storage functions ---

export async function saveAnalysis(
  dataDir: string,
  storyId: string,
  analysis: LibrarianAnalysis,
): Promise<void> {
  const storage = getStorageBackend()
  const dir = await analysesDir(dataDir, storyId)
  await storage.ensureDir(dir)
  await storage.writeJson(await analysisPath(dataDir, storyId, analysis.id), analysis)

  const currentIndex = await getAnalysisIndex(dataDir, storyId) ?? defaultAnalysisIndex()
  const previous = currentIndex.latestByFragmentId[analysis.fragmentId]
  if (shouldReplaceIndexEntry(previous, { createdAt: analysis.createdAt, analysisId: analysis.id })) {
    currentIndex.latestByFragmentId[analysis.fragmentId] = {
      analysisId: analysis.id,
      createdAt: analysis.createdAt,
    }
  }
  currentIndex.updatedAt = new Date().toISOString()
  await saveAnalysisIndex(dataDir, storyId, currentIndex)
}

export async function getAnalysis(
  dataDir: string,
  storyId: string,
  analysisId: string,
): Promise<LibrarianAnalysis | null> {
  const storage = getStorageBackend()
  const path = await analysisPath(dataDir, storyId, analysisId)
  if (!(await storage.exists(path))) return null
  return normalizeAnalysis(await storage.readJson<Record<string, unknown>>(path))
}

/** Migrate old knowledgeSuggestions → fragmentSuggestions on read */
function normalizeAnalysis(data: Record<string, unknown>): LibrarianAnalysis {
  const analysis = data as unknown as LibrarianAnalysis
  if (!analysis.fragmentSuggestions && analysis.knowledgeSuggestions) {
    analysis.fragmentSuggestions = analysis.knowledgeSuggestions
  }
  if (!analysis.fragmentSuggestions) {
    analysis.fragmentSuggestions = []
  }
  return analysis
}

export async function deleteAnalysis(
  dataDir: string,
  storyId: string,
  analysisId: string,
): Promise<boolean> {
  const storage = getStorageBackend()
  const path = await analysisPath(dataDir, storyId, analysisId)
  if (!(await storage.exists(path))) return false

  // Read the analysis to get fragmentId for index cleanup
  const analysis = normalizeAnalysis(await storage.readJson<Record<string, unknown>>(path))

  await storage.delete(path)

  // Clean up index entry if it points to this analysis
  const index = await getAnalysisIndex(dataDir, storyId)
  if (index) {
    const entry = index.latestByFragmentId[analysis.fragmentId]
    if (entry && entry.analysisId === analysisId) {
      delete index.latestByFragmentId[analysis.fragmentId]
      index.updatedAt = new Date().toISOString()
      await saveAnalysisIndex(dataDir, storyId, index)
    }
  }

  return true
}

export async function listAnalyses(
  dataDir: string,
  storyId: string,
): Promise<LibrarianAnalysisSummary[]> {
  const storage = getStorageBackend()
  const dir = await analysesDir(dataDir, storyId)
  if (!(await storage.exists(dir))) return []

  const entries = await storage.listDir(dir)
  const summaries: LibrarianAnalysisSummary[] = []

  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue
    const analysis = normalizeAnalysis(await storage.readJson<Record<string, unknown>>(await analysisPath(dataDir, storyId, entry.replace(/\.json$/, ''))))
    summaries.push({
      id: analysis.id,
      createdAt: analysis.createdAt,
      fragmentId: analysis.fragmentId,
      contradictionCount: analysis.contradictions.length,
      suggestionCount: analysis.fragmentSuggestions.length,
      pendingSuggestionCount: analysis.fragmentSuggestions.filter((s) => !s.accepted && !s.dismissed).length,
      timelineEventCount: analysis.timelineEvents.length,
      directionsCount: analysis.directions?.length ?? 0,
      hasTrace: !!analysis.trace?.length,
    })
  }

  // Sort newest first
  summaries.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return summaries
}

export async function getState(
  dataDir: string,
  storyId: string,
): Promise<LibrarianState> {
  const storage = getStorageBackend()
  const path = await statePath(dataDir, storyId)
  if (!(await storage.exists(path))) {
    return {
      lastAnalyzedFragmentId: null,
      summarizedUpTo: null,
      recentMentions: {},
      timeline: [],
    }
  }
  return storage.readJson(path)
}

export async function saveState(
  dataDir: string,
  storyId: string,
  state: LibrarianState,
): Promise<void> {
  const storage = getStorageBackend()
  const dir = await librarianDir(dataDir, storyId)
  await storage.ensureDir(dir)
  await storage.writeJson(await statePath(dataDir, storyId), state)
}

// --- Chat history ---

export interface ChatHistoryMessage {
  role: 'user' | 'assistant'
  content: string
  reasoning?: string
}

export interface ChatHistory {
  messages: ChatHistoryMessage[]
  updatedAt: string
}

async function chatHistoryPath(dataDir: string, storyId: string): Promise<string> {
  return getLibrarianChatHistoryFile(dataDir, storyId)
}

export async function getChatHistory(
  dataDir: string,
  storyId: string,
): Promise<ChatHistory> {
  const storage = getStorageBackend()
  const path = await chatHistoryPath(dataDir, storyId)
  if (!(await storage.exists(path))) {
    return { messages: [], updatedAt: new Date().toISOString() }
  }
  return storage.readJson(path)
}

export async function saveChatHistory(
  dataDir: string,
  storyId: string,
  messages: ChatHistoryMessage[],
): Promise<void> {
  const storage = getStorageBackend()
  const dir = await librarianDir(dataDir, storyId)
  await storage.ensureDir(dir)
  const history: ChatHistory = {
    messages,
    updatedAt: new Date().toISOString(),
  }
  await storage.writeJson(await chatHistoryPath(dataDir, storyId), history)
}

export async function clearChatHistory(
  dataDir: string,
  storyId: string,
): Promise<void> {
  const storage = getStorageBackend()
  const path = await chatHistoryPath(dataDir, storyId)
  if (await storage.exists(path)) {
    await storage.delete(path)
  }
}

// --- Conversations ---

export interface ConversationMeta {
  id: string
  title: string
  createdAt: string
  updatedAt: string
}

interface ConversationsIndex {
  conversations: ConversationMeta[]
}

async function conversationsIndexPath(dataDir: string, storyId: string): Promise<string> {
  return getLibrarianConversationsIndexFile(dataDir, storyId)
}

function conversationHistoryPath(dataDir: string, storyId: string, conversationId: string): string {
  return getLibrarianConversationHistoryFile(dataDir, storyId, conversationId)
}

async function readConversationsIndex(dataDir: string, storyId: string): Promise<ConversationsIndex> {
  const storage = getStorageBackend()
  const path = await conversationsIndexPath(dataDir, storyId)
  if (!(await storage.exists(path))) return { conversations: [] }
  const parsed = await storage.readJson<Partial<ConversationsIndex>>(path)
  return { conversations: parsed.conversations ?? [] }
}

async function writeConversationsIndex(dataDir: string, storyId: string, index: ConversationsIndex): Promise<void> {
  const storage = getStorageBackend()
  const dir = await librarianDir(dataDir, storyId)
  await storage.ensureDir(dir)
  await storage.writeJson(await conversationsIndexPath(dataDir, storyId), index)
}

export async function listConversations(dataDir: string, storyId: string): Promise<ConversationMeta[]> {
  const index = await readConversationsIndex(dataDir, storyId)
  // Most recently updated first
  return index.conversations.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export async function createConversation(dataDir: string, storyId: string, title: string): Promise<ConversationMeta> {
  const index = await readConversationsIndex(dataDir, storyId)
  const now = new Date().toISOString()
  const conversation: ConversationMeta = {
    id: generateConversationId(),
    title,
    createdAt: now,
    updatedAt: now,
  }
  index.conversations.push(conversation)
  await writeConversationsIndex(dataDir, storyId, index)
  return conversation
}

export async function updateConversationTitle(
  dataDir: string,
  storyId: string,
  conversationId: string,
  title: string,
): Promise<ConversationMeta | null> {
  const index = await readConversationsIndex(dataDir, storyId)
  const conv = index.conversations.find(c => c.id === conversationId)
  if (!conv) return null
  conv.title = title
  conv.updatedAt = new Date().toISOString()
  await writeConversationsIndex(dataDir, storyId, index)
  return conv
}

export async function deleteConversation(dataDir: string, storyId: string, conversationId: string): Promise<boolean> {
  const storage = getStorageBackend()
  const index = await readConversationsIndex(dataDir, storyId)
  const idx = index.conversations.findIndex(c => c.id === conversationId)
  if (idx === -1) return false
  index.conversations.splice(idx, 1)
  await writeConversationsIndex(dataDir, storyId, index)
  // Delete history file
  const historyFile = conversationHistoryPath(dataDir, storyId, conversationId)
  if (await storage.exists(historyFile)) await storage.delete(historyFile)
  return true
}

export async function getConversationHistory(
  dataDir: string,
  storyId: string,
  conversationId: string,
): Promise<ChatHistory> {
  const storage = getStorageBackend()
  const path = conversationHistoryPath(dataDir, storyId, conversationId)
  if (!(await storage.exists(path))) return { messages: [], updatedAt: new Date().toISOString() }
  return storage.readJson(path)
}

export async function saveConversationHistory(
  dataDir: string,
  storyId: string,
  conversationId: string,
  messages: ChatHistoryMessage[],
): Promise<void> {
  const storage = getStorageBackend()
  const dir = await librarianDir(dataDir, storyId)
  await storage.ensureDir(dir)
  const history: ChatHistory = { messages, updatedAt: new Date().toISOString() }
  await storage.writeJson(conversationHistoryPath(dataDir, storyId, conversationId), history)
  // Update conversation timestamp
  const index = await readConversationsIndex(dataDir, storyId)
  const conv = index.conversations.find(c => c.id === conversationId)
  if (conv) {
    conv.updatedAt = history.updatedAt
    // Auto-title from first user message if still default
    if (conv.title === 'New chat' && messages.length > 0) {
      const firstUser = messages.find(m => m.role === 'user')
      if (firstUser) conv.title = firstUser.content.slice(0, 60).trim() || 'New chat'
    }
    await writeConversationsIndex(dataDir, storyId, index)
  }
}
