import { join } from 'node:path'

export const STORY_META_FILE = '_story.md'
export const STORY_OUTPUT_FILE = 'story.md'
export const INTERNAL_DIR = '.errata'
export const FRAGMENT_INTERNAL_INDEX_FILE = 'fragment-internals.json'

export function getStoriesDir(dataDir: string): string {
  return join(dataDir, 'stories')
}

export function getStoryDir(dataDir: string, storyId: string): string {
  return join(getStoriesDir(dataDir), storyId)
}

export function getStoryInternalDir(dataDir: string, storyId: string): string {
  return join(getStoryDir(dataDir, storyId), INTERNAL_DIR)
}

export function getStoryInternalPath(dataDir: string, storyId: string, ...segments: string[]): string {
  return join(getStoryInternalDir(dataDir, storyId), ...segments)
}

export function getStoryMetaPath(dataDir: string, storyId: string): string {
  return getStoryInternalPath(dataDir, storyId, STORY_META_FILE)
}

export function getCompiledStoryPath(dataDir: string, storyId: string): string {
  return join(getStoryDir(dataDir, storyId), STORY_OUTPUT_FILE)
}

export function getFragmentInternalIndexPath(dataDir: string, storyId: string): string {
  return getStoryInternalPath(dataDir, storyId, FRAGMENT_INTERNAL_INDEX_FILE)
}