import { describe, expect, it } from 'vitest'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
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
  getInternalStoryRoot,
  getMarkdownStoryRoot,
  loadMarkdownFragmentById,
} from '@/server/md-files'
import { listStories } from '@/server/fragments/storage'
import { upsertFragmentInternalRecord } from '@/server/md-files/fragment-internals'

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
    version: 1,
    versions: [],
    ...overrides,
  }
}

describe('md-files repository sync', () => {
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
      const files = await readdir(characterDir)
      expect(files).toContain('Io Dren.md')

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
      expect(loaded?.content).toBe('Keep every scene tight and specific.')
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