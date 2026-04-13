import { join } from 'node:path'
import type { Fragment } from '@/server/fragments/schema'

export const STORY_META_FILE = '_story.md'
export const STORY_OUTPUT_FILE = 'story.md'
export const INTERNAL_DIR = '.errata'
export const PROSE_FRAGMENT_INDEX_FILE = 'prose-fragments.json'

const FOLDER_BY_TYPE: Record<string, string> = {
  prose: 'Prose',
  character: 'Characters',
  guideline: 'Guidelines',
  knowledge: 'Lorebook',
  marker: 'Markers',
  image: 'Images',
  icon: 'Icons',
}

export const STORY_DIRS = [
  'Guidelines',
  'Characters',
  'Lorebook',
  'Prose',
  'Markers',
  'Images',
  'Icons',
  'Fragments',
] as const

function storiesDir(dataDir: string): string {
  return join(dataDir, 'stories')
}

export function getMarkdownStoryRoot(dataDir: string, storyId: string): string {
  return join(storiesDir(dataDir), storyId)
}

export function getStoryMetaPath(dataDir: string, storyId: string): string {
  return join(getMarkdownStoryRoot(dataDir, storyId), STORY_META_FILE)
}

export function getCompiledStoryPath(dataDir: string, storyId: string): string {
  return join(getMarkdownStoryRoot(dataDir, storyId), STORY_OUTPUT_FILE)
}

export function getInternalStoryRoot(dataDir: string, storyId: string): string {
  return join(getMarkdownStoryRoot(dataDir, storyId), INTERNAL_DIR)
}

export function getProseFragmentIndexPath(dataDir: string, storyId: string): string {
  return join(getInternalStoryRoot(dataDir, storyId), PROSE_FRAGMENT_INDEX_FILE)
}

export function getFragmentFolder(type: string): string {
  return FOLDER_BY_TYPE[type] ?? 'Fragments'
}

function getNumericPrefix(index: number): string {
  return `${String(Math.max(0, index)).padStart(4, '0')}-`
}

export function getFragmentFileName(fragment: Fragment, sectionIndex?: number): string {
  if (fragment.type === 'prose' || fragment.type === 'marker') {
    return `${getNumericPrefix(sectionIndex ?? fragment.order ?? 0)}${fragment.id}.md`
  }

  return `${fragment.id}.md`
}

export function getProseFragmentIdFromFileName(fileName: string): string {
  return fileName.replace(/\.md$/i, '').replace(/^\d{4}-/, '')
}