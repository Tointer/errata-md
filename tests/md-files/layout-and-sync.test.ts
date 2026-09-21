import { describe, expect, it } from 'vitest'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createTempDir } from '../setup'
import { createFragment, createStory, updateFragmentVersioned } from '@/server/fragments/storage'
import { addProseSection } from '@/server/fragments/prose-chain'
import {
  getCompiledStoryPath,
  getInternalStoryRoot,
  getMarkdownStoryRoot,
  loadMarkdownFragmentById,
} from '@/server/md-files'
import { makeFragment, makeStory } from './helpers'

describe('md-files layout and sync', () => {
  it('creates markdown story layout and syncs setup fragments', async () => {
    const tmp = await createTempDir()

    try {
      const story = makeStory('story-mdsync')
      await createStory(tmp.path, story)

      const guideline = makeFragment('gl-voice', {
        type: 'guideline',
        name: 'Voice',
        description: 'Writing guidance',
        content: 'Keep the prose sharp and economical.',
        sticky: true,
        placement: 'system',
      })

      await createFragment(tmp.path, story.id, guideline)

      const root = getMarkdownStoryRoot(tmp.path, story.id)
      const storyMeta = await readFile(join(getInternalStoryRoot(tmp.path, story.id), '_story.md'), 'utf-8')
      expect(storyMeta).toContain('name: "Markdown Story"')

      const rootEntries = (await readdir(root)).sort()
      expect(rootEntries).toEqual(['.errata', 'Characters', 'Guidelines', 'Lorebook', 'Prose', 'story.md'])

      const loaded = await loadMarkdownFragmentById(tmp.path, story.id, 'gl-voice')
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