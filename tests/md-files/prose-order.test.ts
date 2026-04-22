import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createTempDir } from '../setup'
import { createFragment, createStory } from '@/server/fragments/storage'
import { addProseSection, addProseVariation } from '@/server/fragments/prose-chain'
import { getInternalStoryRoot, getMarkdownStoryRoot } from '@/server/md-files'
import { makeFragment, makeStory } from './helpers'

describe('md-files prose ordering', () => {
  it('numbers prose files by section order and keeps variations under the same number', async () => {
    const tmp = await createTempDir()

    try {
      const story = makeStory('story-prose-order')
      await createStory(tmp.path, story)

      const first = makeFragment('pr-firstaa', { type: 'prose', name: 'First beat' })
      const second = makeFragment('pr-seconda', { type: 'prose', name: 'Second beat' })
      const variant = makeFragment('pr-variaaa', { type: 'prose', name: 'Second beat alt' })

      await createFragment(tmp.path, story.id, first)
      await addProseSection(tmp.path, story.id, first.id)

      await createFragment(tmp.path, story.id, second)
      await addProseSection(tmp.path, story.id, second.id)

      await createFragment(tmp.path, story.id, variant)
      await addProseVariation(tmp.path, story.id, 1, variant.id)

      const proseDir = join(getMarkdownStoryRoot(tmp.path, story.id), 'Prose')
      const files = (await readdir(proseDir)).sort()

      expect(files).toContain('0000-pr-firstaa.md')
      expect(files).toContain('0001-pr-seconda.md')
      expect(files).toContain('0001-pr-variaaa.md')

      const internalRaw = await readFile(join(getInternalStoryRoot(tmp.path, story.id), 'fragment-internals.json'), 'utf-8')
      expect(internalRaw).toContain('"pr-firstaa"')
      expect(internalRaw).toContain('"prose"')
    } finally {
      await tmp.cleanup()
    }
  })
})