export const STORY_ARCHIVE_ROOT = 'errata-story-export'

export type StoryArchiveImportMode =
  | { type: 'branched'; branchesKey: string }
  | { type: 'markdown' }

export interface StoryArchiveEntry {
  path: string
  relativePath: string
  content: Uint8Array
}

export function getStoryArchiveEntryPath(relativePath: string): string {
  return `${STORY_ARCHIVE_ROOT}/${relativePath}`
}

export function detectStoryArchiveImportMode(paths: string[]): StoryArchiveImportMode | null {
  const branchesKey = paths.find(
    (path) => path.endsWith('branches.json') && !path.includes('fragments/') && !path.includes('/branches/'),
  )
  const hasBranchedContent = paths.some((path) => path.includes('/branches/'))
  const hasMarkdownStoryTree = paths.some((path) =>
    path.includes('/Characters/')
    || path.includes('/Guidelines/')
    || path.includes('/Lorebook/')
    || path.includes('/Prose/')
    || path.endsWith('/story.md')
    || path.includes('/.errata/fragment-internals.json'),
  )

  if (branchesKey && hasBranchedContent) {
    return { type: 'branched', branchesKey }
  }

  if (hasMarkdownStoryTree) {
    return { type: 'markdown' }
  }

  return null
}

export function getStoryMetaArchiveKey(paths: string[]): string | null {
  const legacyMetaKey = paths.find(
    (path) => path.endsWith('meta.json') && !path.includes('fragments/') && !path.includes('branches/'),
  )
  if (legacyMetaKey) return legacyMetaKey

  return paths.find((path) => {
    if (path.includes('/branches/')) return false
    return path.endsWith('/.errata/_story.md') || path.endsWith('/_story.md')
  }) ?? null
}

export function getArchiveRootPrefix(paths: string[]): string {
  const firstPath = paths[0]
  if (!firstPath) return ''

  const firstSeparator = firstPath.indexOf('/')
  return firstSeparator === -1 ? '' : firstPath.slice(0, firstSeparator + 1)
}

export function getMarkdownArchiveEntries(extracted: Record<string, Uint8Array>): StoryArchiveEntry[] {
  const rootPrefix = getArchiveRootPrefix(Object.keys(extracted))

  return Object.entries(extracted)
    .filter(([path]) => !rootPrefix || path.startsWith(rootPrefix))
    .map(([path, content]) => ({
      path,
      relativePath: rootPrefix ? path.slice(rootPrefix.length) : path,
      content,
    }))
    .filter((entry) => entry.relativePath && entry.relativePath !== 'branches.json' && entry.relativePath !== '.errata/_story.md')
}

export function findBranchArchivePrefix(paths: string[], branchId: string): string | null {
  for (const path of paths) {
    const marker = `/branches/${branchId}/`
    const idx = path.indexOf(marker)
    if (idx !== -1) return path.substring(0, idx + marker.length - 1)
  }

  return null
}
