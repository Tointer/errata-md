import { describe, expect, it } from 'vitest'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createTempDir, makeTestSettings } from '../setup'
import type { Fragment, StoryMeta } from '@/server/fragments/schema'
import {
  createFragment,
  createStory,
  updateFragmentVersioned,
} from '@/server/fragments/storage'
import { addProseSection, addProseVariation } from '@/server/fragments/prose-chain'
import {
  getCompiledStoryPath,
  getMarkdownStoryRoot,
  loadMarkdownFragmentById,
} from '@/server/stories/markdown-repository'

function makeStory(id: string): StoryMeta {
  const now = new Date().toISOString()
  return {
    id,
    name: 'Markdown Story',
    description: 'Story synced to markdown files.',
    coverImage: null,
    summary: '',
    createdAt: now,
    updatedAt: now,
    settings: makeTestSettings(),
  }
}

function makeFragment(id: string, overrides?: Partial<Fragment>): Fragment {
  const now = new Date().toISOString()
  return {
    id,
    type: 'prose',
    name: 'Opening',
    description: 'The first beat',
    content: 'It was raining over the station.',
    tags: [],
    refs: [],
    sticky: false,
    placement: 'user',
    createdAt: now,
    updatedAt: now,
    order: 0,
    meta: {},
    archived: false,
    version: 1,
    versions: [],
    ...overrides,
  }
}

describe('markdown story repository sync', () => {
  it('creates markdown story layout and syncs setup fragments', async () => {
    const tmp = await createTempDir()

    try {
      const story = makeStory('story-mdsync')
      await createStory(tmp.path, story)

      const guideline = makeFragment('gl-aaaaaa', {
        type: 'guideline',
        name: 'Voice',
        description: 'Writing guidance',
        content: 'Keep the prose sharp and economical.',
        sticky: true,
        placement: 'system',
      })

      await createFragment(tmp.path, story.id, guideline)

      const root = getMarkdownStoryRoot(tmp.path, story.id)
      const storyMeta = await readFile(join(root, '_story.md'), 'utf-8')
      expect(storyMeta).toContain('name: "Markdown Story"')

      const loaded = await loadMarkdownFragmentById(tmp.path, story.id, guideline.id)
      expect(loaded?.type).toBe('guideline')
      expect(loaded?.content).toBe('Keep the prose sharp and economical.')
    } finally {
      await tmp.cleanup()
    }
  })

  it('regenerates compiled story markdown when prose changes', async () => {
    const tmp = await createTempDir()

    try {
      const story = makeStory('story-output-sync')
      await createStory(tmp.path, story)

      const prose = makeFragment('pr-aaaaaa', {
        type: 'prose',
        name: 'Arrival',
        content: 'She stepped off the train into cold air.',
      })

      await createFragment(tmp.path, story.id, prose)
      await addProseSection(tmp.path, story.id, prose.id)

      const compiledPath = getCompiledStoryPath(tmp.path, story.id)
      const firstPass = await readFile(compiledPath, 'utf-8')
      expect(firstPass).toContain('[[[pr-aaaaaa]]]')
      expect(firstPass).toContain('She stepped off the train into cold air.')

      await updateFragmentVersioned(
        tmp.path,
        story.id,
        prose.id,
        { content: 'She stepped off the train into bitter dawn air.' },
        { reason: 'test-update' },
      )

      const secondPass = await readFile(compiledPath, 'utf-8')
      expect(secondPass).toContain('She stepped off the train into bitter dawn air.')
      expect(secondPass).not.toContain('She stepped off the train into cold air.')
    } finally {
      await tmp.cleanup()
    }
  })

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
    } finally {
      await tmp.cleanup()
    }
  })
})