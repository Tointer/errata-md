import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { createTempDir, makeTestSettings } from '../setup'
import {
  createStory,
  getStory,
  listStories,
  updateStory,
  deleteStory,
  createFragment,
  getFragment,
  listFragments,
  updateFragment,
  updateFragmentVersioned,
  deleteFragment,
  archiveFragment,
  restoreFragment,
} from '@/server/fragments/storage'
import type { Fragment, StoryMeta } from '@/server/fragments/schema'

let dataDir: string
let cleanup: () => Promise<void>

beforeEach(async () => {
  const tmp = await createTempDir()
  dataDir = tmp.path
  cleanup = tmp.cleanup
})

afterEach(async () => {
  await cleanup()
})

const makeStory = (overrides: Partial<StoryMeta> = {}): StoryMeta => ({
  id: 'story-1',
  name: 'Test Story',
  description: 'A test story',
    coverImage: null,
  summary: '',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  settings: makeTestSettings(),
  ...overrides,
})

const makeFragment = (overrides: Partial<Fragment> = {}): Fragment => ({
  id: 'pr-a1b2',
  type: 'prose',
  name: 'Opening',
  description: 'The story begins',
  content: 'It was a dark and stormy night...',
  tags: [],
  refs: [],
  sticky: false,
  placement: 'user' as const,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  order: 0,
  meta: {},
  ...overrides,
})

describe('Story CRUD', () => {
  it('creates and retrieves a story', async () => {
    const story = makeStory()
    await createStory(dataDir, story)
    const retrieved = await getStory(dataDir, story.id)
    expect(retrieved).toEqual(story)
  })

  it('lists all stories', async () => {
    await createStory(dataDir, makeStory({ id: 'story-1' }))
    await createStory(dataDir, makeStory({ id: 'story-2', name: 'Second' }))
    const stories = await listStories(dataDir)
    expect(stories).toHaveLength(2)
    expect(stories.map((s) => s.id).sort()).toEqual(['story-1', 'story-2'])
  })

  it('updates a story', async () => {
    const story = makeStory()
    await createStory(dataDir, story)
    const updated = { ...story, name: 'Updated Name' }
    await updateStory(dataDir, updated)
    const retrieved = await getStory(dataDir, story.id)
    expect(retrieved!.name).toBe('Updated Name')
  })

  it('deletes a story', async () => {
    const story = makeStory()
    await createStory(dataDir, story)
    await deleteStory(dataDir, story.id)
    const stories = await listStories(dataDir)
    expect(stories).toHaveLength(0)
  })

  it('returns null for non-existent story', async () => {
    const result = await getStory(dataDir, 'nonexistent')
    expect(result).toBeNull()
  })

  it('persists story metadata without writing meta.json', async () => {
    const story = makeStory()
    await createStory(dataDir, story)

    expect(existsSync(join(dataDir, 'stories', story.id, 'meta.json'))).toBe(false)

    const retrieved = await getStory(dataDir, story.id)
    expect(retrieved).not.toBeNull()
    expect(retrieved!.id).toBe(story.id)
    expect(retrieved!.name).toBe(story.name)
    expect(retrieved!.description).toBe(story.description)
  })
})

describe('Fragment CRUD', () => {
  const storyId = 'story-1'

  beforeEach(async () => {
    await createStory(dataDir, makeStory({ id: storyId }))
  })

  it('creates and retrieves a fragment', async () => {
    const fragment = makeFragment()
    await createFragment(dataDir, storyId, fragment)
    const retrieved = await getFragment(dataDir, storyId, fragment.id)
    expect(retrieved).toEqual({
      ...fragment,
      archived: false,
      version: 1,
      versions: [],
    })
  })

  it('lists fragments by type', async () => {
    await createFragment(dataDir, storyId, makeFragment({ id: 'pr-a1b2' }))
    await createFragment(
      dataDir,
      storyId,
      makeFragment({ id: 'pr-c3d4', name: 'Second' })
    )
    await createFragment(
      dataDir,
      storyId,
      makeFragment({ id: 'ch-x9y8', type: 'character', name: 'Alice' })
    )

    const prose = await listFragments(dataDir, storyId, 'prose')
    expect(prose).toHaveLength(2)

    const characters = await listFragments(dataDir, storyId, 'character')
    expect(characters).toHaveLength(1)
  })

  it('lists all fragments when no type filter', async () => {
    await createFragment(dataDir, storyId, makeFragment({ id: 'pr-a1b2' }))
    await createFragment(
      dataDir,
      storyId,
      makeFragment({ id: 'ch-x9y8', type: 'character', name: 'Alice' })
    )
    const all = await listFragments(dataDir, storyId)
    expect(all).toHaveLength(2)
  })

  it('updates a fragment', async () => {
    const fragment = makeFragment()
    await createFragment(dataDir, storyId, fragment)
    const updated = { ...fragment, content: 'New content here.' }
    await updateFragment(dataDir, storyId, updated)
    const retrieved = await getFragment(dataDir, storyId, fragment.id)
    expect(retrieved!.content).toBe('New content here.')
  })

  it('updates content without storing native version history', async () => {
    const fragment = makeFragment({
      id: 'ch-alice',
      type: 'character',
      name: 'Alice',
      description: 'Original desc',
      content: 'Original content',
    })
    await createFragment(dataDir, storyId, fragment)

    const updated = await updateFragmentVersioned(
      dataDir,
      storyId,
      'ch-alice',
      { content: 'Updated content', description: 'Updated desc' },
      { reason: 'test-refine' },
    )

    expect(updated).not.toBeNull()
    expect(updated!.version).toBe(1)
    expect(updated!.versions).toEqual([])
    expect(updated!.content).toBe('Updated content')
    expect(updated!.description).toBe('Updated desc')
  })

  it('does not expose built-in version history anymore', async () => {
    const fragment = makeFragment({
      id: 'gl-tone',
      type: 'guideline',
      name: 'Tone',
      description: 'v1 desc',
      content: 'v1 content',
    })
    await createFragment(dataDir, storyId, fragment)

    await updateFragmentVersioned(dataDir, storyId, 'gl-tone', { content: 'v2 content', description: 'v2 desc' })
    await updateFragmentVersioned(dataDir, storyId, 'gl-tone', { content: 'v3 content', description: 'v3 desc' })

    const retrieved = await getFragment(dataDir, storyId, 'gl-tone')
    expect(retrieved).not.toBeNull()
    expect(retrieved!.content).toBe('v3 content')
    expect(retrieved!.version).toBe(1)
    expect(retrieved!.versions).toEqual([])
  })

  it('deletes a fragment', async () => {
    const fragment = makeFragment()
    await createFragment(dataDir, storyId, fragment)
    await deleteFragment(dataDir, storyId, fragment.id)
    const result = await getFragment(dataDir, storyId, fragment.id)
    expect(result).toBeNull()
  })

  it('returns null for non-existent fragment', async () => {
    const result = await getFragment(dataDir, storyId, 'pr-zzzz')
    expect(result).toBeNull()
  })

  it('persists fragment data without writing json sidecars', async () => {
    const fragment = makeFragment({ id: 'pr-mdonly' })
    await createFragment(dataDir, storyId, fragment)

    expect(existsSync(join(dataDir, 'stories', storyId, 'fragments', `${fragment.id}.json`))).toBe(false)

    const retrieved = await getFragment(dataDir, storyId, fragment.id)
    expect(retrieved).not.toBeNull()
    expect(retrieved!.id).toBe(fragment.id)
    expect(retrieved!.content).toBe(fragment.content)
    expect(retrieved!.version).toBe(1)
  })

  it('stores only generatedFrom and summary in prose markdown frontmatter', async () => {
    const fragment = makeFragment({
      id: 'pr-minmeta',
      name: 'Hidden prose title',
      description: 'Internal prose description',
      tags: ['scene'],
      refs: ['ch-mirea'],
      meta: {
        generatedFrom: 'Continue the scene after the blackout.',
        _librarian: {
          summary: 'Mirea is forced toward the tunnel exit.',
          analysisId: 'la-1234',
        },
        annotations: [{ type: 'mention', fragmentId: 'ch-mirea', text: 'Mirea' }],
        locked: true,
      },
    })

    await createFragment(dataDir, storyId, fragment)

    const markdownPath = join(dataDir, 'stories', storyId, 'Prose', '0000-pr-minmeta.md')
    const rawMarkdown = await readFile(markdownPath, 'utf-8')

    expect(rawMarkdown).toContain('generatedFrom: "Continue the scene after the blackout."')
    expect(rawMarkdown).toContain('summary: "Mirea is forced toward the tunnel exit."')
    expect(rawMarkdown).not.toContain('analysisId')
    expect(rawMarkdown).not.toContain('annotations')
    expect(rawMarkdown).not.toContain('name:')
    expect(rawMarkdown).not.toContain('description:')

    const internalPath = join(dataDir, 'stories', storyId, '.errata', 'prose-fragments.json')
    expect(existsSync(internalPath)).toBe(true)

    const internalRaw = await readFile(internalPath, 'utf-8')
    expect(internalRaw).toContain('analysisId')
    expect(internalRaw).toContain('annotations')
    expect(internalRaw).toContain('Hidden prose title')
    expect(internalRaw).not.toContain('generatedFrom')

    const retrieved = await getFragment(dataDir, storyId, fragment.id)
    expect(retrieved).not.toBeNull()
    expect(retrieved!.name).toBe('Hidden prose title')
    expect(retrieved!.description).toBe('Internal prose description')
    expect(retrieved!.meta.generatedFrom).toBe('Continue the scene after the blackout.')
    expect((retrieved!.meta._librarian as { summary: string; analysisId: string }).summary).toBe('Mirea is forced toward the tunnel exit.')
    expect((retrieved!.meta._librarian as { summary: string; analysisId: string }).analysisId).toBe('la-1234')
    expect(retrieved!.meta.locked).toBe(true)
  })

  it('lists fragments directly from markdown storage', async () => {
    const prose = makeFragment({ id: 'pr-mdlist' })
    const character = makeFragment({
      id: 'ch-asha',
      type: 'character',
      name: 'Asha',
      description: 'Pilot',
      content: 'Asha carries the map fragments.',
    })

    await createFragment(dataDir, storyId, prose)
    await createFragment(dataDir, storyId, character)

    const listed = await listFragments(dataDir, storyId)
    expect(listed).toHaveLength(2)
    expect(listed.map((fragment) => fragment.id).sort()).toEqual(['ch-asha', 'pr-mdlist'])
  })

  it('prefers markdown content over stale json sidecars', async () => {
    const fragment = makeFragment({ id: 'pr-mdwins', content: 'Old JSON content.' })
    await createFragment(dataDir, storyId, fragment)

    const markdownPath = join(dataDir, 'stories', storyId, 'Prose', '0000-pr-mdwins.md')
    const original = await readFile(markdownPath, 'utf-8')
    const updated = original.replace('Old JSON content.', 'Fresh markdown content.')
    await writeFile(markdownPath, updated, 'utf-8')

    const retrieved = await getFragment(dataDir, storyId, fragment.id)
    expect(retrieved).not.toBeNull()
    expect(retrieved!.content).toBe('Fresh markdown content.')

    const listed = await listFragments(dataDir, storyId, 'prose')
    const sameFragment = listed.find((item) => item.id === fragment.id)
    expect(sameFragment?.content).toBe('Fresh markdown content.')
  })
})

describe('Fragment Archive', () => {
  const storyId = 'story-1'

  beforeEach(async () => {
    await createStory(dataDir, makeStory({ id: storyId }))
  })

  it('archiveFragment sets archived to true', async () => {
    await createFragment(dataDir, storyId, makeFragment({ id: 'ch-test' }))
    const result = await archiveFragment(dataDir, storyId, 'ch-test')
    expect(result).not.toBeNull()
    expect(result!.archived).toBe(true)
  })

  it('restoreFragment sets archived to false', async () => {
    await createFragment(dataDir, storyId, makeFragment({ id: 'ch-test', archived: true }))
    const result = await restoreFragment(dataDir, storyId, 'ch-test')
    expect(result).not.toBeNull()
    expect(result!.archived).toBe(false)
  })

  it('archiveFragment returns null for non-existent fragment', async () => {
    const result = await archiveFragment(dataDir, storyId, 'pr-zzzz')
    expect(result).toBeNull()
  })

  it('listFragments excludes archived fragments by default', async () => {
    await createFragment(dataDir, storyId, makeFragment({ id: 'ch-aaaa' }))
    await createFragment(dataDir, storyId, makeFragment({ id: 'ch-bbbb' }))
    await archiveFragment(dataDir, storyId, 'ch-bbbb')

    const fragments = await listFragments(dataDir, storyId)
    expect(fragments).toHaveLength(1)
    expect(fragments[0].id).toBe('ch-aaaa')
  })

  it('listFragments includes archived fragments when opted in', async () => {
    await createFragment(dataDir, storyId, makeFragment({ id: 'ch-aaaa' }))
    await createFragment(dataDir, storyId, makeFragment({ id: 'ch-bbbb' }))
    await archiveFragment(dataDir, storyId, 'ch-bbbb')

    const fragments = await listFragments(dataDir, storyId, undefined, { includeArchived: true })
    expect(fragments).toHaveLength(2)
  })

  it('defaults archived to false for legacy fragments without the field', async () => {
    // Create a fragment without the archived field (simulating legacy data)
    const legacy = makeFragment({ id: 'pr-lega' })
    delete (legacy as unknown as Record<string, unknown>).archived
    await createFragment(dataDir, storyId, legacy)

    const fragments = await listFragments(dataDir, storyId)
    expect(fragments).toHaveLength(1)
    expect(fragments[0].archived).toBe(false)
  })
})
