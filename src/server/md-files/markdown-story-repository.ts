import type { Fragment, StoryMeta } from '@/server/fragments/schema'
import {
  archiveFragmentMarkdown,
  deleteFragmentMarkdown,
  isMarkdownFragmentArchived,
  listArchivedMarkdownFragments,
  listMarkdownFragments,
  loadMarkdownFragmentById,
  loadMarkdownStoryMeta,
  restoreFragmentMarkdown,
  syncCompiledStoryFromCurrentChain,
  syncFragmentMarkdown,
  syncProseMarkdownOrder,
  syncStoryMarkdownMeta,
} from './repository'

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

const defaultMarkdownStoryRepository: MarkdownStoryRepository = {
  archiveFragment: archiveFragmentMarkdown,
  deleteFragment: deleteFragmentMarkdown,
  isFragmentArchived: isMarkdownFragmentArchived,
  listArchivedFragments: listArchivedMarkdownFragments,
  listFragments: listMarkdownFragments,
  loadFragment: loadMarkdownFragmentById,
  loadStory: loadMarkdownStoryMeta,
  restoreFragment: restoreFragmentMarkdown,
  syncCompiledStory: syncCompiledStoryFromCurrentChain,
  syncFragment: syncFragmentMarkdown,
  syncProseOrder: syncProseMarkdownOrder,
  syncStory: syncStoryMarkdownMeta,
}

let markdownStoryRepository: MarkdownStoryRepository = defaultMarkdownStoryRepository

export function getMarkdownStoryRepository(): MarkdownStoryRepository {
  return markdownStoryRepository
}

export function setMarkdownStoryRepository(repository: MarkdownStoryRepository): void {
  markdownStoryRepository = repository
}