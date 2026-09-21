import { describe, expect, it } from 'vitest'
import {
  detectStoryArchiveImportMode,
  findBranchArchivePrefix,
  getMarkdownArchiveEntries,
  getStoryArchiveEntryPath,
  getStoryMetaArchiveKey,
  STORY_ARCHIVE_ROOT,
} from '@/server/stories/archive-format'

describe('story archive format', () => {
  it('builds archive entry paths under the shared root', () => {
    expect(STORY_ARCHIVE_ROOT).toBe('errata-story-export')
    expect(getStoryArchiveEntryPath('story.md')).toBe('errata-story-export/story.md')
  })

  it('detects markdown and branched import modes', () => {
    expect(detectStoryArchiveImportMode([
      'errata-story-export/.errata/_story.md',
      'errata-story-export/Prose/0000-pr-opening.md',
    ])).toEqual({ type: 'markdown' })

    expect(detectStoryArchiveImportMode([
      'errata-story-export/.errata/_story.md',
      'errata-story-export/branches.json',
      'errata-story-export/branches/main/fragments/pr-opening.json',
    ])).toEqual({
      type: 'branched',
      branchesKey: 'errata-story-export/branches.json',
    })
  })

  it('locates current and legacy story metadata', () => {
    expect(getStoryMetaArchiveKey([
      'errata-story-export/.errata/_story.md',
    ])).toBe('errata-story-export/.errata/_story.md')

    expect(getStoryMetaArchiveKey([
      'errata-story-export/meta.json',
    ])).toBe('errata-story-export/meta.json')
  })

  it('strips the archive root and skips non-content entries for markdown imports', () => {
    const entries = getMarkdownArchiveEntries({
      'errata-story-export/.errata/_story.md': new Uint8Array([1]),
      'errata-story-export/branches.json': new Uint8Array([2]),
      'errata-story-export/Prose/0000-pr-opening.md': new Uint8Array([3]),
      'errata-story-export/story.md': new Uint8Array([4]),
    })

    expect(entries.map((entry) => entry.relativePath)).toEqual([
      'Prose/0000-pr-opening.md',
      'story.md',
    ])
  })

  it('finds a branch prefix from archive entries', () => {
    expect(findBranchArchivePrefix([
      'errata-story-export/branches/main/fragments/pr-opening.json',
      'errata-story-export/branches/main/prose-chain.json',
    ], 'main')).toBe('errata-story-export/branches/main')
  })
})
