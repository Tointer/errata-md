import { join } from 'node:path'
import type { BranchesIndex, BranchMeta } from './schema'
import { getStorageBackend } from '../storage/runtime'
import { getStoryDir } from '../storage/paths'

function storyDir(dataDir: string, storyId: string): string {
  return getStoryDir(dataDir, storyId)
}

function createMainBranch(): BranchMeta {
  return {
    id: 'main',
    name: 'Main',
    order: 0,
    createdAt: new Date().toISOString(),
  }
}

function createStaticBranchesIndex(): BranchesIndex {
  return {
    branches: [createMainBranch()],
    activeBranchId: 'main',
  }
}

export async function getBranchesIndex(_dataDir: string, _storyId: string): Promise<BranchesIndex> {
  return createStaticBranchesIndex()
}

export async function saveBranchesIndex(_dataDir: string, _storyId: string, _index: BranchesIndex): Promise<void> {
  // No-op: timelines are no longer persisted.
}

export async function withBranch<T>(
  _dataDir: string,
  _storyId: string,
  fn: () => Promise<T>,
  _explicitBranchId?: string,
): Promise<T> {
  return fn()
}

export async function getContentRoot(dataDir: string, storyId: string): Promise<string> {
  return storyDir(dataDir, storyId)
}

export async function getContentRootForBranch(dataDir: string, storyId: string, _branchId: string): Promise<string> {
  return storyDir(dataDir, storyId)
}

export async function getActiveBranchId(_dataDir: string, _storyId: string): Promise<string> {
  return 'main'
}

export async function switchActiveBranch(_dataDir: string, _storyId: string, branchId: string): Promise<void> {
  if (branchId !== 'main') {
    throw new Error('Timelines have been removed from Errata.')
  }
}

export async function createBranch(
  _dataDir: string,
  _storyId: string,
  _name: string,
  _parentBranchId: string,
  _forkAfterIndex?: number,
): Promise<BranchMeta> {
  throw new Error('Timelines have been removed from Errata.')
}

export async function deleteBranch(_dataDir: string, _storyId: string, _branchId: string): Promise<void> {
  throw new Error('Timelines have been removed from Errata.')
}

export async function renameBranch(_dataDir: string, _storyId: string, _branchId: string, _name: string): Promise<BranchMeta> {
  throw new Error('Timelines have been removed from Errata.')
}

export async function initBranches(dataDir: string, storyId: string): Promise<void> {
  const storage = getStorageBackend()
  const dir = storyDir(dataDir, storyId)
  await storage.ensureDir(dir)
  await storage.ensureDir(join(dir, '.errata', 'fragments'))
}
