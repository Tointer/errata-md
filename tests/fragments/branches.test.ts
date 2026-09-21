import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { createTempDir, makeTestSettings } from '../setup'
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

function makeStory(): StoryMeta {
  const now = new Date().toISOString()
  return {
    id: TEST_STORY_ID,
    name: 'Test Story',
    description: 'A test story',
    coverImage: null,
    summary: '',
    createdAt: now,
    updatedAt: now,
    settings: makeTestSettings(),
  }
}

beforeEach(async () => {
  const temp = await createTempDir()
  dataDir = temp.path
  cleanup = temp.cleanup
})

afterEach(async () => cleanup())

describe('branches compatibility', () => {
  it('returns one static main branch', async () => {
    const index = await getBranchesIndex(dataDir, TEST_STORY_ID)
    expect(index.activeBranchId).toBe('main')
    expect(index.branches.map((branch) => branch.id)).toEqual(['main'])
  })

  it('puts app-only content in the hidden story directory', async () => {
    await createStory(dataDir, makeStory())
    const expected = join(dataDir, 'stories', TEST_STORY_ID, '.errata')
    expect(await getContentRoot(dataDir, TEST_STORY_ID)).toBe(expected)
    expect(await getContentRootForBranch(dataDir, TEST_STORY_ID, 'main')).toBe(expected)
    expect(existsSync(join(expected, 'fragments'))).toBe(true)
  })

  it('keeps withBranch as a no-op compatibility scope', async () => {
    await createStory(dataDir, makeStory())
    const value = await withBranch(
      dataDir,
      TEST_STORY_ID,
      () => getContentRoot(dataDir, TEST_STORY_ID),
      'main',
    )
    expect(value).toBe(join(dataDir, 'stories', TEST_STORY_ID, '.errata'))
  })

  it('allows main and rejects alternate timelines', async () => {
    await expect(switchActiveBranch(dataDir, TEST_STORY_ID, 'main')).resolves.toBeUndefined()
    await expect(switchActiveBranch(dataDir, TEST_STORY_ID, 'alt')).rejects.toThrow('Timelines have been removed')
    await expect(createBranch(dataDir, TEST_STORY_ID, 'Alt', 'main')).rejects.toThrow('Timelines have been removed')
    await expect(renameBranch(dataDir, TEST_STORY_ID, 'main', 'Renamed')).rejects.toThrow('Timelines have been removed')
    await expect(deleteBranch(dataDir, TEST_STORY_ID, 'main')).rejects.toThrow('Timelines have been removed')
  })
})
