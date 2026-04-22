import { describe, expect, it } from 'vitest'
import type { Fragment, StoryMeta } from '@/server/fragments/schema'
import { createFragment, createStory, getStory, listFragments } from '@/server/fragments/storage'
import { getProseChain, saveProseChain } from '@/server/fragments/prose-chain'
import { exportStoryAsZip, importStoryFromZip } from '@/server/story-archive'
import { createTempDir, makeTestSettings } from './setup'

function makeStory(id: string): StoryMeta {
  const now = new Date().toISOString()
  return {
    id,
    name: 'Archive Story',
    description: 'Story used for archive tests.',
    coverImage: null,
    summary: '',
    createdAt: now,
    updatedAt: now,
    settings: makeTestSettings({
      providerId: 'provider-test',
      modelId: 'model-test',
    }),
  }
}

function makeFragment(id: string, overrides: Partial<Fragment> = {}): Fragment {
  const now = new Date().toISOString()
  return {
    id,
    type: 'prose',
    name: 'Opening',
    description: 'Opening beat',
    content: 'The station lamps burned through the rain.',
    tags: [],
    refs: [],
    sticky: false,
    placement: 'user',
    createdAt: now,
    updatedAt: now,
    order: 0,
    meta: {},
    version: 1,
    versions: [],
    ...overrides,
  }
}

describe('story archive', () => {
  it('round-trips current markdown-native story exports', async () => {
    const tmp = await createTempDir()

    try {
      const story = makeStory('story-export-roundtrip')
      await createStory(tmp.path, story)

      const prose = makeFragment('pr-opening')
      const guideline = makeFragment('gl-tone', {
        type: 'guideline',
        name: 'Tone',
        description: 'House tone',
        content: 'Keep the atmosphere taut and rain-soaked.',
        sticky: true,
        placement: 'system',
      })

      await createFragment(tmp.path, story.id, prose)
      await createFragment(tmp.path, story.id, guideline)
      await saveProseChain(tmp.path, story.id, {
        entries: [{ proseFragments: [prose.id], active: prose.id }],
      })

      const exported = await exportStoryAsZip(tmp.path, story.id)
      const imported = await importStoryFromZip(tmp.path, exported.buffer)

      expect(imported.id).not.toBe(story.id)
      expect(imported.name).toBe('Archive Story (imported)')
      expect(imported.settings.providerId).toBeNull()
      expect(imported.settings.modelId).toBeNull()

      const importedStory = await getStory(tmp.path, imported.id)
      expect(importedStory?.name).toBe('Archive Story (imported)')

      const importedFragments = await listFragments(tmp.path, imported.id)
      expect(importedFragments.map((fragment) => fragment.id).sort()).toEqual(['gl-tone', 'pr-opening'])

      const importedChain = await getProseChain(tmp.path, imported.id)
      expect(importedChain).toEqual({
        entries: [{ proseFragments: ['pr-opening'], active: 'pr-opening' }],
      })
    } finally {
      await tmp.cleanup()
    }
  })
})