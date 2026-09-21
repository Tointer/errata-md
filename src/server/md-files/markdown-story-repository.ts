import type { Fragment, StoryMeta } from '@/server/fragments/schema'
import * as repository from './repository'

export interface MarkdownStoryRepository {
  archiveFragment(dataDir: string, storyId: string, fragmentId: string): Promise<boolean>
  deleteFragment(dataDir: string, storyId: string, fragmentId: string): Promise<void>
  isFragmentArchived(dataDir: string, storyId: string, fragmentId: string): Promise<boolean>
  listArchivedFragments(dataDir: string, storyId: string, type?: string): Promise<Fragment[]>
  listFragments(dataDir: string, storyId: string, type?: string): Promise<Fragment[]>
  loadFragment(dataDir: string, storyId: string, fragmentId: string): Promise<Fragment | null>
  loadStory(dataDir: string, storyId: string): Promise<StoryMeta | null>
  restoreFragment(dataDir: string, storyId: string, fragmentId: string): Promise<boolean>
  syncCompiledStory(dataDir: string, storyId: string): Promise<void>
  syncFragment(dataDir: string, storyId: string, fragment: Fragment): Promise<void>
  syncProseOrder(dataDir: string, storyId: string): Promise<void>
  syncStory(dataDir: string, story: StoryMeta): Promise<void>
}

const defaultMarkdownStoryRepository = {
  archiveFragment: repository.archiveFragmentMarkdown,
  deleteFragment: repository.deleteFragmentMarkdown,
  isFragmentArchived: repository.isMarkdownFragmentArchived,
  listArchivedFragments: repository.listArchivedMarkdownFragments,
  listFragments: repository.listMarkdownFragments,
  loadFragment: repository.loadMarkdownFragmentById,
  loadStory: repository.loadMarkdownStoryMeta,
  restoreFragment: repository.restoreFragmentMarkdown,
  syncCompiledStory: repository.syncCompiledStoryFromCurrentChain,
  syncFragment: repository.syncFragmentMarkdown,
  syncProseOrder: repository.syncProseMarkdownOrder,
  syncStory: repository.syncStoryMarkdownMeta,
} satisfies MarkdownStoryRepository

let markdownStoryRepository: MarkdownStoryRepository = defaultMarkdownStoryRepository

export function getMarkdownStoryRepository(): MarkdownStoryRepository {
  return markdownStoryRepository
}

export function setMarkdownStoryRepository(repository: MarkdownStoryRepository): void {
  markdownStoryRepository = repository
}