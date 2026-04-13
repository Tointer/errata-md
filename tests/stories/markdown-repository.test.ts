import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createTempDir, makeTestSettings } from '../setup'
import type { Fragment, StoryMeta } from '@/server/fragments/schema'
import {
  createFragment,
  createStory,
  updateFragmentVersioned,
} from '@/server/fragments/storage'
import { addProseSection } from '@/server/fragments/prose-chain'
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
})