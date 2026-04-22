import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { createTempDir } from '../setup'
import {
  createBranch,
  deleteBranch,
  getBranchesIndex,
  getContentRoot,
  getContentRootForBranch,
  renameBranch,
  switchActiveBranch,
  withBranch,
} from '../../src/server/fragments/branches'
import { createStory } from '../../src/server/fragments/storage'
import type { StoryMeta } from '../../src/server/fragments/schema'

let dataDir: string
let cleanup: () => Promise<void>

const TEST_STORY_ID = 'test-story'

function makeStory(id: string = TEST_STORY_ID): StoryMeta {
  const now = new Date().toISOString()
  return {
    id,
    name: 'Test Story',
    description: 'A test story',
    coverImage: null,
    summary: '',
    createdAt: now,
    updatedAt: now,
    settings: {
      outputFormat: 'markdown',
      enabledPlugins: [],
      summarizationThreshold: 4,
      maxSteps: 10,
      modelOverrides: {},
      generationMode: 'standard' as const,
      autoApplyLibrarianSuggestions: false,
      disableLibrarianDirections: false,
      disableLibrarianSuggestions: false,
      contextOrderMode: 'simple',
      fragmentOrder: [],
      contextCompact: { type: 'proseLimit', value: 10 },
      summaryCompact: { maxCharacters: 12000, targetCharacters: 9000 },
      enableHierarchicalSummary: false,
    },
  }
}

beforeEach(async () => {
  const temp = await createTempDir()
  dataDir = temp.path
  cleanup = temp.cleanup
})

afterEach(async () => {
  await cleanup()
})

describe('branches compatibility', () => {
  it('returns a static main branch index', async () => {
    const index = await getBranchesIndex(dataDir, TEST_STORY_ID)
    expect(index.activeBranchId).toBe('main')
    expect(index.branches).toHaveLength(1)
    expect(index.branches[0].id).toBe('main')
  })

  it('uses the story root as content root', async () => {
    await createStory(dataDir, makeStory())

    const activeRoot = await getContentRoot(dataDir, TEST_STORY_ID)
    const explicitRoot = await getContentRootForBranch(dataDir, TEST_STORY_ID, 'main')

    expect(activeRoot).toBe(join(dataDir, 'stories', TEST_STORY_ID))
    expect(explicitRoot).toBe(join(dataDir, 'stories', TEST_STORY_ID))
  })

  it('initializes the markdown-native story directories', async () => {
    await createStory(dataDir, makeStory())

    const storyDir = join(dataDir, 'stories', TEST_STORY_ID)
    expect(existsSync(storyDir)).toBe(true)
    expect(existsSync(join(storyDir, '.errata', 'fragments'))).toBe(true)
  })

  it('executes withBranch without changing storage scope', async () => {
    await createStory(dataDir, makeStory())

    const value = await withBranch(dataDir, TEST_STORY_ID, async () => getContentRoot(dataDir, TEST_STORY_ID), 'main')
    expect(value).toBe(join(dataDir, 'stories', TEST_STORY_ID))
  })

  it('allows switching to main and rejects non-main branches', async () => {
    await expect(switchActiveBranch(dataDir, TEST_STORY_ID, 'main')).resolves.toBeUndefined()
    await expect(switchActiveBranch(dataDir, TEST_STORY_ID, 'alt')).rejects.toThrow('Timelines have been removed from Errata.')
  })

  it('rejects creating, renaming, and deleting branches', async () => {
    await expect(createBranch(dataDir, TEST_STORY_ID, 'Alt Timeline', 'main')).rejects.toThrow('Timelines have been removed from Errata.')
    await expect(renameBranch(dataDir, TEST_STORY_ID, 'main', 'Renamed')).rejects.toThrow('Timelines have been removed from Errata.')
    await expect(deleteBranch(dataDir, TEST_STORY_ID, 'main')).rejects.toThrow('Timelines have been removed from Errata.')
  })
})
