import { mkdir, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import type { Fragment, FragmentVersion, StoryMeta } from './schema'
import { getContentRoot, initBranches } from './branches'
import { createLogger } from '../logging'
import {
  loadMarkdownFragmentById,
  loadMarkdownStoryMeta,
  listMarkdownFragments,
  deleteFragmentMarkdown,
  syncCompiledStoryFromCurrentChain,
  syncFragmentMarkdown,
  syncStoryMarkdownMeta,
} from '../stories/markdown-repository'

const requestLogger = createLogger('fragment-storage')

// --- Path helpers ---

function storiesDir(dataDir: string) {
  return join(dataDir, 'stories')
}

function storyDir(dataDir: string, storyId: string) {
  return join(storiesDir(dataDir), storyId)
}

function storyMetaJsonPath(dataDir: string, storyId: string) {
  return join(storyDir(dataDir, storyId), 'meta.json')
}

async function fragmentJsonPath(dataDir: string, storyId: string, fragmentId: string) {
  const root = await getContentRoot(dataDir, storyId)
  const dir = join(root, 'fragments')
  await mkdir(dir, { recursive: true })
  return join(dir, `${fragmentId}.json`)
}

async function fragmentsDir(dataDir: string, storyId: string) {
  const root = await getContentRoot(dataDir, storyId)
  return join(root, 'fragments')
}

async function removeFileIfExists(path: string): Promise<void> {
  if (existsSync(path)) {
    await rm(path, { force: true })
  }
}

function normalizeFragment(fragment: Fragment | null): Fragment | null {
  if (!fragment) return null
  return {
    ...fragment,
    archived: fragment.archived ?? false,
    version: fragment.version ?? 1,
    versions: Array.isArray(fragment.versions) ? fragment.versions : [],
  }
}

// --- Story CRUD ---

export async function createStory(
  dataDir: string,
  story: StoryMeta
): Promise<void> {
  const dir = storyDir(dataDir, story.id)
  await mkdir(dir, { recursive: true })
  await initBranches(dataDir, story.id)
  await syncStoryMarkdownMeta(dataDir, story)
  await removeFileIfExists(storyMetaJsonPath(dataDir, story.id))
}

export async function getStory(
  dataDir: string,
  storyId: string
): Promise<StoryMeta | null> {
  return loadMarkdownStoryMeta(dataDir, storyId)
}

export async function listStories(dataDir: string): Promise<StoryMeta[]> {
  const dir = storiesDir(dataDir)
  if (!existsSync(dir)) return []

  const entries = await readdir(dir, { withFileTypes: true })
  const stories: StoryMeta[] = []

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const meta = await getStory(dataDir, entry.name)
      if (meta) stories.push(meta)
    }
  }

  return stories
}

export async function updateStory(
  dataDir: string,
  story: StoryMeta
): Promise<void> {
  await syncStoryMarkdownMeta(dataDir, story)
  await removeFileIfExists(storyMetaJsonPath(dataDir, story.id))
}

export async function deleteStory(
  dataDir: string,
  storyId: string
): Promise<void> {
  const dir = storyDir(dataDir, storyId)
  if (existsSync(dir)) {
    await rm(dir, { recursive: true, force: true })
  }
}

// --- Fragment CRUD ---

export async function createFragment(
  dataDir: string,
  storyId: string,
  fragment: Fragment
): Promise<void> {
  const normalized = normalizeFragment(fragment)
  if (normalized) {
    await syncFragmentMarkdown(dataDir, storyId, normalized)
    await removeFileIfExists(await fragmentJsonPath(dataDir, storyId, normalized.id))
    if (normalized.type === 'prose' || normalized.type === 'marker') {
      await syncCompiledStoryFromCurrentChain(dataDir, storyId)
    }
  }
}

export async function getFragment(
  dataDir: string,
  storyId: string,
  fragmentId: string
): Promise<Fragment | null> {
  return normalizeFragment(await loadMarkdownFragmentById(dataDir, storyId, fragmentId))
}

export async function listFragments(
  dataDir: string,
  storyId: string,
  type?: string,
  opts?: { includeArchived?: boolean }
): Promise<Fragment[]> {
  return listMarkdownFragments(dataDir, storyId, type, opts)
}

export async function archiveFragment(
  dataDir: string,
  storyId: string,
  fragmentId: string
): Promise<Fragment | null> {
  const fragment = await getFragment(dataDir, storyId, fragmentId)
  if (!fragment) return null
  const updated: Fragment = {
    ...fragment,
    archived: true,
    updatedAt: new Date().toISOString(),
  }
  await syncFragmentMarkdown(dataDir, storyId, updated)
  await removeFileIfExists(await fragmentJsonPath(dataDir, storyId, fragmentId))
  if (updated.type === 'prose' || updated.type === 'marker') {
    await syncCompiledStoryFromCurrentChain(dataDir, storyId)
  }
  return updated
}

export async function restoreFragment(
  dataDir: string,
  storyId: string,
  fragmentId: string
): Promise<Fragment | null> {
  const fragment = await getFragment(dataDir, storyId, fragmentId)
  if (!fragment) return null
  const updated: Fragment = {
    ...fragment,
    archived: false,
    updatedAt: new Date().toISOString(),
  }
  await syncFragmentMarkdown(dataDir, storyId, updated)
  await removeFileIfExists(await fragmentJsonPath(dataDir, storyId, fragmentId))
  if (updated.type === 'prose' || updated.type === 'marker') {
    await syncCompiledStoryFromCurrentChain(dataDir, storyId)
  }
  return updated
}

export async function updateFragment(
  dataDir: string,
  storyId: string,
  fragment: Fragment
): Promise<void> {
  const normalized = normalizeFragment(fragment)
  if (normalized) {
    requestLogger.info('Updating fragment markdown', { fragmentId: normalized.id, storyId })
    await syncFragmentMarkdown(dataDir, storyId, normalized)
    await removeFileIfExists(await fragmentJsonPath(dataDir, storyId, normalized.id))
    if (normalized.type === 'prose' || normalized.type === 'marker') {
      await syncCompiledStoryFromCurrentChain(dataDir, storyId)
    }
  }
}

export async function updateFragmentVersioned(
  dataDir: string,
  storyId: string,
  fragmentId: string,
  updates: Partial<Pick<Fragment, 'name' | 'description' | 'content'>>,
  opts?: { reason?: string }
): Promise<Fragment | null> {
  void opts
  const existing = await getFragment(dataDir, storyId, fragmentId)
  if (!existing) return null

  const nextName = updates.name ?? existing.name
  const nextDescription = updates.description ?? existing.description
  const nextContent = updates.content ?? existing.content

  const now = new Date().toISOString()
  const updated: Fragment = {
    ...existing,
    name: nextName,
    description: nextDescription,
    content: nextContent,
    updatedAt: now,
    version: 1,
    versions: [],
  }

  await updateFragment(dataDir, storyId, updated)
  return updated
}

export async function listFragmentVersions(
  dataDir: string,
  storyId: string,
  fragmentId: string
): Promise<FragmentVersion[] | null> {
  const fragment = await getFragment(dataDir, storyId, fragmentId)
  if (!fragment) return null
  return []
}

export async function revertFragmentToVersion(
  dataDir: string,
  storyId: string,
  fragmentId: string,
  targetVersion?: number
): Promise<Fragment | null> {
  void dataDir
  void storyId
  void fragmentId
  void targetVersion
  return null
}

export async function deleteFragment(
  dataDir: string,
  storyId: string,
  fragmentId: string
): Promise<void> {
  const existing = await getFragment(dataDir, storyId, fragmentId)
  await removeFileIfExists(await fragmentJsonPath(dataDir, storyId, fragmentId))
  await deleteFragmentMarkdown(dataDir, storyId, fragmentId)
  if (existing && (existing.type === 'prose' || existing.type === 'marker')) {
    await syncCompiledStoryFromCurrentChain(dataDir, storyId)
  }
}
