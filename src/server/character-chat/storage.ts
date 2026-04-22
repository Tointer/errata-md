import { getCharacterChatConversationFile, getCharacterChatConversationsDir } from '../storage/paths'
import { getStorageBackend } from '../storage/runtime'

// --- Types ---

export type PersonaMode =
  | { type: 'character'; characterId: string }
  | { type: 'stranger' }
  | { type: 'custom'; prompt: string }

export interface CharacterChatMessage {
  role: 'user' | 'assistant'
  content: string
  reasoning?: string
  createdAt: string
}

export interface CharacterChatConversation {
  id: string
  characterId: string
  persona: PersonaMode
  storyPointFragmentId: string | null
  title: string
  messages: CharacterChatMessage[]
  createdAt: string
  updatedAt: string
}

export interface CharacterChatConversationSummary {
  id: string
  characterId: string
  persona: PersonaMode
  storyPointFragmentId: string | null
  title: string
  messageCount: number
  createdAt: string
  updatedAt: string
}

// --- ID generation ---

export function generateConversationId(): string {
  const ts = Date.now().toString(36)
  const rand = Math.random().toString(36).slice(2, 8)
  return `cc-${ts}-${rand}`
}

// --- CRUD ---

export async function saveConversation(
  dataDir: string,
  storyId: string,
  conversation: CharacterChatConversation,
): Promise<void> {
  const storage = getStorageBackend()
  await storage.writeJson(getCharacterChatConversationFile(dataDir, storyId, conversation.id), conversation)
}

export async function getConversation(
  dataDir: string,
  storyId: string,
  conversationId: string,
): Promise<CharacterChatConversation | null> {
  const storage = getStorageBackend()
  return storage.readJsonIfExists(getCharacterChatConversationFile(dataDir, storyId, conversationId))
}

export async function listConversations(
  dataDir: string,
  storyId: string,
  characterId?: string,
): Promise<CharacterChatConversationSummary[]> {
  const storage = getStorageBackend()
  const entries = await storage.listDir(getCharacterChatConversationsDir(dataDir, storyId))
  const summaries: CharacterChatConversationSummary[] = []

  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue
    const conv = await storage.readJson<CharacterChatConversation>(
      getCharacterChatConversationFile(dataDir, storyId, entry.replace(/\.json$/, '')),
    )

    if (characterId && conv.characterId !== characterId) continue

    summaries.push({
      id: conv.id,
      characterId: conv.characterId,
      persona: conv.persona,
      storyPointFragmentId: conv.storyPointFragmentId,
      title: conv.title,
      messageCount: conv.messages.length,
      createdAt: conv.createdAt,
      updatedAt: conv.updatedAt,
    })
  }

  // Sort newest first
  summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  return summaries
}

export async function deleteConversation(
  dataDir: string,
  storyId: string,
  conversationId: string,
): Promise<boolean> {
  const storage = getStorageBackend()
  const path = getCharacterChatConversationFile(dataDir, storyId, conversationId)
  if (!(await storage.exists(path))) return false
  await storage.delete(path)
  return true
}
