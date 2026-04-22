import { join } from 'node:path'
import { getInternalStoryPath, getInternalStoryRoot } from '../md-files/paths'

export function getStoriesDir(dataDir: string): string {
  return join(dataDir, 'stories')
}

export function getStoryDir(dataDir: string, storyId: string): string {
  return join(getStoriesDir(dataDir), storyId)
}

export function resolveGlobalDataDir(dataDir: string): string {
  return process.env.GLOBAL_DATA_DIR?.trim() || dataDir
}

export function getGlobalStoragePath(dataDir: string, ...segments: string[]): string {
  return join(resolveGlobalDataDir(dataDir), ...segments)
}

export function getAppLogsDir(dataDir: string): string {
  return getGlobalStoragePath(dataDir, 'logs')
}

export function getAppLogFilePath(dataDir: string, index: number): string {
  return getGlobalStoragePath(dataDir, 'logs', `app-${index}.jsonl`)
}

export function getStoryInternalDir(dataDir: string, storyId: string, ...segments: string[]): string {
  return getInternalStoryPath(dataDir, storyId, ...segments)
}

export function getStoryInternalFile(dataDir: string, storyId: string, ...segments: string[]): string {
  return getInternalStoryPath(dataDir, storyId, ...segments)
}

export function getLegacyStoryMetaJsonFile(dataDir: string, storyId: string): string {
  return join(getStoryDir(dataDir, storyId), 'meta.json')
}

export function getLegacyInternalFragmentsDir(dataDir: string, storyId: string): string {
  return join(getInternalStoryRoot(dataDir, storyId), 'fragments')
}

export function getLegacyInternalFragmentFile(dataDir: string, storyId: string, fragmentId: string): string {
  return join(getLegacyInternalFragmentsDir(dataDir, storyId), `${fragmentId}.json`)
}

export function getCharacterChatDir(dataDir: string, storyId: string): string {
  return getInternalStoryPath(dataDir, storyId, 'character-chat')
}

export function getCharacterChatConversationsDir(dataDir: string, storyId: string): string {
  return getInternalStoryPath(dataDir, storyId, 'character-chat', 'conversations')
}

export function getCharacterChatConversationFile(dataDir: string, storyId: string, conversationId: string): string {
  return getInternalStoryPath(dataDir, storyId, 'character-chat', 'conversations', `${conversationId}.json`)
}

export function getProseChainFile(dataDir: string, storyId: string): string {
  return getInternalStoryPath(dataDir, storyId, 'prose-chain.json')
}

export function getAssociationsFile(dataDir: string, storyId: string): string {
  return getInternalStoryPath(dataDir, storyId, 'associations.json')
}

export function getLibrarianDir(dataDir: string, storyId: string): string {
  return getInternalStoryPath(dataDir, storyId, 'librarian')
}

export function getLibrarianAnalysesDir(dataDir: string, storyId: string): string {
  return getInternalStoryPath(dataDir, storyId, 'librarian', 'analyses')
}

export function getLibrarianAnalysisFile(dataDir: string, storyId: string, analysisId: string): string {
  return getInternalStoryPath(dataDir, storyId, 'librarian', 'analyses', `${analysisId}.json`)
}

export function getLibrarianStateFile(dataDir: string, storyId: string): string {
  return getInternalStoryPath(dataDir, storyId, 'librarian', 'state.json')
}

export function getLibrarianAnalysisIndexFile(dataDir: string, storyId: string): string {
  return getInternalStoryPath(dataDir, storyId, 'librarian', 'index.json')
}

export function getLibrarianChatHistoryFile(dataDir: string, storyId: string): string {
  return getInternalStoryPath(dataDir, storyId, 'librarian', 'chat-history.json')
}

export function getLibrarianConversationsIndexFile(dataDir: string, storyId: string): string {
  return getInternalStoryPath(dataDir, storyId, 'librarian', 'conversations.json')
}

export function getLibrarianConversationHistoryFile(dataDir: string, storyId: string, conversationId: string): string {
  return getInternalStoryPath(dataDir, storyId, 'librarian', `chat-${conversationId}.json`)
}