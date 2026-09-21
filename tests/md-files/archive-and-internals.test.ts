import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createTempDir } from '../setup'
import { createStory, listArchivedFragments, listFragments } from '@/server/fragments/storage'
import { getInternalStoryRoot, getMarkdownStoryRoot } from '@/server/md-files'
import { upsertFragmentInternalRecord } from '@/server/storage/stores/fragment-internals'
import { makeFragment, makeStory } from './helpers'

describe('md-files archive and internals', () => {
  it('infers archived state from the Archive subfolder', async () => {
    const tmp = await createTempDir()

    try {
      const story = makeStory('story-archive-folder')
      await createStory(tmp.path, story)

      const archiveDir = join(getMarkdownStoryRoot(tmp.path, story.id), 'Characters', 'Archive')
      await mkdir(archiveDir, { recursive: true })
      await writeFile(
        join(archiveDir, 'Mira Vale.md'),
        'A former courier who now lives off maps and rumors.',
        'utf-8',
      )

      expect(await listFragments(tmp.path, story.id, 'character')).toHaveLength(0)

      const archived = await listArchivedFragments(tmp.path, story.id, 'character')
      expect(archived).toHaveLength(1)
      expect(archived[0]?.id).toBe('ch-mira-vale')
      expect(archived[0]?.archived).toBe(true)
    } finally {
      await tmp.cleanup()
    }
  })

  it('serializes concurrent fragment internal index writes', async () => {
    const tmp = await createTempDir()

    try {
      const story = makeStory('story-concurrent-internals')
      await createStory(tmp.path, story)

      const fragments = Array.from({ length: 10 }, (_, index) => makeFragment(`pr-concurrent-${index}`, {
        type: 'prose',
        name: `Beat ${index}`,
        description: `Description ${index}`,
      }))

      await Promise.all(fragments.map(fragment => upsertFragmentInternalRecord(tmp.path, story.id, fragment)))

      const raw = await readFile(join(getInternalStoryRoot(tmp.path, story.id), 'fragment-internals.json'), 'utf-8')
      const parsed = JSON.parse(raw) as Record<string, unknown>

      expect(Object.keys(parsed)).toHaveLength(10)
      for (const fragment of fragments) {
        expect(parsed).toHaveProperty(fragment.id)
      }
    } finally {
      await tmp.cleanup()
    }
  })
})