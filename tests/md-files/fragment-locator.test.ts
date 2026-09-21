import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createStory } from '@/server/fragments/storage'
import { findMarkdownFragmentEntry, getEntryFragmentId } from '@/server/md-files/fragment-locator'
import { getStoryDir as getMarkdownStoryRoot } from '@/server/storage/story-layout'
import { createTempDir } from '../setup'
import { makeStory } from './helpers'

describe('md fragment locator', () => {
  it('derives ids from visible and prose filenames', () => {
    expect(getEntryFragmentId('Characters', 'Io Dren.md')).toBe('ch-io-dren')
    expect(getEntryFragmentId('Guidelines', 'Scene Discipline.md')).toBe('gl-scene-discipline')
    expect(getEntryFragmentId('Prose', '0003-pr-opening.md')).toBe('pr-opening')
    expect(getEntryFragmentId(join('.errata', 'Markers'), 'mk-beat.md')).toBeNull()
  })

  it('finds live and archived fragment entries according to lookup options', async () => {
    const tmp = await createTempDir()

    try {
      const story = makeStory('story-fragment-locator')
      await createStory(tmp.path, story)

      const root = getMarkdownStoryRoot(tmp.path, story.id)
      await writeFile(join(root, 'Characters', 'Io Dren.md'), 'Visible character', 'utf-8')
      await mkdir(join(root, 'Characters', 'Archive'), { recursive: true })
      await writeFile(join(root, 'Characters', 'Archive', 'Mira Vale.md'), 'Archived character', 'utf-8')

      const live = await findMarkdownFragmentEntry(tmp.path, story.id, 'ch-io-dren', { includeArchived: false })
      expect(live).toHaveLength(1)
      expect(live[0]?.archived).toBe(false)

      const archivedOnly = await findMarkdownFragmentEntry(tmp.path, story.id, 'ch-mira-vale', {
        includeArchived: true,
        onlyArchived: true,
      })
      expect(archivedOnly).toHaveLength(1)
      expect(archivedOnly[0]?.archived).toBe(true)

      const all = await findMarkdownFragmentEntry(tmp.path, story.id, 'ch-mira-vale', { includeArchived: true })
      expect(all).toHaveLength(1)
      expect(all[0]?.archived).toBe(true)
    } finally {
      await tmp.cleanup()
    }
  })
})