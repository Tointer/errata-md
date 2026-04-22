import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createTempDir } from '../setup'
import { listStories, createFragment, createStory } from '@/server/fragments/storage'
import { getInternalStoryRoot, getMarkdownStoryRoot, loadMarkdownFragmentById } from '@/server/md-files'
import { makeFragment, makeStory } from './helpers'

describe('md-files loading and parsing', () => {
  it('derives character ids from human-readable filenames and infers type from folder', async () => {
    const tmp = await createTempDir()

    try {
      const story = makeStory('story-visible-file-names')
      await createStory(tmp.path, story)

      const character = makeFragment('ch-io-dren', {
        type: 'character',
        name: 'Io Dren',
        description: 'Station archivist',
        content: 'Keeps the paper archive running through the blackouts.',
      })

      await createFragment(tmp.path, story.id, character)

      const characterDir = join(getMarkdownStoryRoot(tmp.path, story.id), 'Characters')
      const raw = await readFile(join(characterDir, 'Io Dren.md'), 'utf-8')
      expect(raw).not.toContain('\nid:')
      expect(raw).not.toContain('\nname:')
      expect(raw).not.toContain('\ntype:')
      expect(raw).not.toContain('\ncreatedAt:')
      expect(raw).not.toContain('\nupdatedAt:')

      const internalRaw = await readFile(join(getInternalStoryRoot(tmp.path, story.id), 'fragment-internals.json'), 'utf-8')
      expect(internalRaw).toContain('"ch-io-dren"')
      expect(internalRaw).toContain('"createdAt"')
      expect(internalRaw).toContain('"updatedAt"')

      const loaded = await loadMarkdownFragmentById(tmp.path, story.id, 'ch-io-dren')
      expect(loaded?.id).toBe('ch-io-dren')
      expect(loaded?.type).toBe('character')
      expect(loaded?.name).toBe('Io Dren')
    } finally {
      await tmp.cleanup()
    }
  })

  it('defaults bare guideline markdown files to sticky using the fragment type default', async () => {
    const tmp = await createTempDir()

    try {
      const story = makeStory('story-bare-guideline')
      await createStory(tmp.path, story)

      const guidelinePath = join(getMarkdownStoryRoot(tmp.path, story.id), 'Guidelines', 'Scene Discipline.md')
      await writeFile(guidelinePath, 'Keep every scene tight and specific.', 'utf-8')

      const loaded = await loadMarkdownFragmentById(tmp.path, story.id, 'gl-scene-discipline')
      expect(loaded?.type).toBe('guideline')
      expect(loaded?.name).toBe('Scene Discipline')
      expect(loaded?.sticky).toBe(true)
      expect(loaded?.meta.frozenSections).toEqual([
        { id: 'fs-md-leading', text: 'Keep every scene tight and specific.' },
      ])
      expect(loaded?.content).toBe('Keep every scene tight and specific.')
    } finally {
      await tmp.cleanup()
    }
  })

  it('treats markdown before the editable delimiter as frozen content', async () => {
    const tmp = await createTempDir()

    try {
      const story = makeStory('story-editable-delimiter')
      await createStory(tmp.path, story)

      const guidelinePath = join(getMarkdownStoryRoot(tmp.path, story.id), 'Guidelines', 'Voice.md')
      await writeFile(
        guidelinePath,
        [
          'Keep the diction precise.',
          '',
          '<!-- editable -->',
          '',
          'Recent scene note: lean harder into suspicion.',
        ].join('\n'),
        'utf-8',
      )

      const loaded = await loadMarkdownFragmentById(tmp.path, story.id, 'gl-voice')
      expect(loaded?.content).toBe('Keep the diction precise.\n\nRecent scene note: lean harder into suspicion.')
      expect(loaded?.meta.frozenSections).toEqual([
        { id: 'fs-md-leading', text: 'Keep the diction precise.' },
      ])
    } finally {
      await tmp.cleanup()
    }
  })

  it('writes the editable delimiter back to markdown when a leading frozen section exists', async () => {
    const tmp = await createTempDir()

    try {
      const story = makeStory('story-leading-freeze-save')
      await createStory(tmp.path, story)

      await createFragment(tmp.path, story.id, makeFragment('gl-voice', {
        type: 'guideline',
        name: 'Voice',
        description: 'House voice',
        content: 'Keep the diction precise.\n\nRecent scene note: lean harder into suspicion.',
        sticky: true,
        meta: {
          frozenSections: [{ id: 'fs-md-leading', text: 'Keep the diction precise.' }],
        },
      }))

      const raw = await readFile(join(getMarkdownStoryRoot(tmp.path, story.id), 'Guidelines', 'Voice.md'), 'utf-8')
      expect(raw).toContain('<!-- editable -->')
      expect(raw).toContain('Keep the diction precise.')
      expect(raw).toContain('Recent scene note: lean harder into suspicion.')
      expect(raw).not.toContain('"fs-md-leading"')
    } finally {
      await tmp.cleanup()
    }
  })

  it('defaults bare character markdown files to sticky using the fragment type default', async () => {
    const tmp = await createTempDir()

    try {
      const story = makeStory('story-bare-character')
      await createStory(tmp.path, story)

      const characterPath = join(getMarkdownStoryRoot(tmp.path, story.id), 'Characters', 'Mira Vale.md')
      await writeFile(characterPath, 'A former courier who memorizes whole districts by smell.', 'utf-8')

      const loaded = await loadMarkdownFragmentById(tmp.path, story.id, 'ch-mira-vale')
      expect(loaded?.type).toBe('character')
      expect(loaded?.name).toBe('Mira Vale')
      expect(loaded?.sticky).toBe(true)
      expect(loaded?.content).toBe('A former courier who memorizes whole districts by smell.')
      expect(loaded?.meta.frozenSections).toBeUndefined()
    } finally {
      await tmp.cleanup()
    }
  })

  it('defaults bare knowledge markdown files to sticky using the fragment type default', async () => {
    const tmp = await createTempDir()

    try {
      const story = makeStory('story-bare-knowledge')
      await createStory(tmp.path, story)

      const knowledgePath = join(getMarkdownStoryRoot(tmp.path, story.id), 'Lorebook', 'Glass Coast.md')
      await writeFile(knowledgePath, 'The coast sings at low tide because of the buried shard fields.', 'utf-8')

      const loaded = await loadMarkdownFragmentById(tmp.path, story.id, 'kn-glass-coast')
      expect(loaded?.type).toBe('knowledge')
      expect(loaded?.name).toBe('Glass Coast')
      expect(loaded?.sticky).toBe(true)
      expect(loaded?.content).toBe('The coast sings at low tide because of the buried shard fields.')
      expect(loaded?.meta.frozenSections).toBeUndefined()
    } finally {
      await tmp.cleanup()
    }
  })

  it('continues loading fragments when fragment-internals.json is malformed', async () => {
    const tmp = await createTempDir()

    try {
      const story = makeStory('story-bad-internals')
      await createStory(tmp.path, story)

      const guidelinePath = join(getMarkdownStoryRoot(tmp.path, story.id), 'Guidelines', 'Voice.md')
      await writeFile(guidelinePath, 'Keep the tone restrained.', 'utf-8')
      await writeFile(
        join(getInternalStoryRoot(tmp.path, story.id), 'fragment-internals.json'),
        '{"gl-voice":{"createdAt":"2026-01-01T00:00:00.000Z"}}}',
        'utf-8',
      )

      const loaded = await loadMarkdownFragmentById(tmp.path, story.id, 'gl-voice')
      expect(loaded?.type).toBe('guideline')
      expect(loaded?.name).toBe('Voice')
      expect(loaded?.content).toBe('Keep the tone restrained.')
    } finally {
      await tmp.cleanup()
    }
  })

  it('discovers stories from lightweight _story.md files without full frontmatter', async () => {
    const tmp = await createTempDir()

    try {
      const storyId = 'sam-and-jake-mo1en84d'
      const storyRoot = join(tmp.path, 'stories', storyId)
      await mkdir(join(storyRoot, '.errata'), { recursive: true })
      await writeFile(
        join(storyRoot, '.errata', '_story.md'),
        [
          '---',
          'id: "sam-and-jake-mo1en84d"',
          'name: "Sam and Jake"',
          'Sam and Jake story',
        ].join('\n'),
        'utf-8',
      )

      const stories = await listStories(tmp.path)
      expect(stories).toHaveLength(1)
      expect(stories[0]?.id).toBe(storyId)
      expect(stories[0]?.name).toBe('Sam and Jake')
      expect(stories[0]?.description).toBe('Sam and Jake story')
    } finally {
      await tmp.cleanup()
    }
  })
})