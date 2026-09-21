import { readdir, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import type { Fragment, FragmentVersion, StoryMeta } from './schema'
import { createLogger } from '../logging'
import { getMarkdownStoryRepository } from '../md-files/markdown-story-repository'
import { getStoriesDir, getStoryDir } from '../storage/story-layout'

const requestLogger = createLogger('fragment-storage')

function normalizeFragment(fragment: Fragment | null): Fragment | null {
  if (!fragment) return null
  return {
    ...fragment,
    archived: fragment.archived ?? false,
    version: fragment.version ?? 1,
    versions: Array.isArray(fragment.versions) ? fragment.versions : [],
  }
}

function makeVersionSnapshot(fragment: Fragment, reason?: string): FragmentVersion {
  return {
    version: fragment.version ?? 1,
    name: fragment.name,
    description: fragment.description,
    content: fragment.content,
    createdAt: new Date().toISOString(),
    ...(reason ? { reason } : {}),
  }
}

// --- Story CRUD ---

export async function createStory(
  dataDir: string,
  story: StoryMeta
): Promise<void> {
  await getMarkdownStoryRepository().syncStory(dataDir, story)
}

export async function getStory(
  dataDir: string,
  storyId: string
): Promise<StoryMeta | null> {
  return getMarkdownStoryRepository().loadStory(dataDir, storyId)
}

export async function listStories(dataDir: string): Promise<StoryMeta[]> {
  const dir = getStoriesDir(dataDir)
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
  await getMarkdownStoryRepository().syncStory(dataDir, story)
}

export async function deleteStory(
  dataDir: string,
  storyId: string
): Promise<void> {
  const dir = getStoryDir(dataDir, storyId)
  if (existsSync(dir)) {
    await rm(dir, { recursive: true, force: true })
  }
}

// --- Fragment CRUD ---

export async function createFragment(
  dataDir: string,
  storyId: string,
  fragment: Fragment,
  opts?: { overwrite?: boolean }
): Promise<void> {
  const repository = getMarkdownStoryRepository()
  // Guard against silently clobbering an existing fragment. Callers that
  // intentionally replace by id (e.g. pack install) pass overwrite: true.
  if (!opts?.overwrite && await repository.loadFragment(dataDir, storyId, fragment.id)) {
    throw new Error(`Fragment ${fragment.id} already exists; use updateFragment to modify it`)
  }
  const normalized = normalizeFragment(fragment)
  if (normalized) {
    await repository.syncFragment(dataDir, storyId, normalized)
    if (normalized.archived) {
      await repository.archiveFragment(dataDir, storyId, normalized.id)
    }
    if (normalized.type === 'prose' || normalized.type === 'marker') {
      await repository.syncCompiledStory(dataDir, storyId)
    }
  }
}

export async function getFragment(
  dataDir: string,
  storyId: string,
  fragmentId: string
): Promise<Fragment | null> {
  const fragment = await getMarkdownStoryRepository().loadFragment(dataDir, storyId, fragmentId)
  return normalizeFragment(fragment)
}

export async function listFragments(
  dataDir: string,
  storyId: string,
  type?: string,
  opts?: { includeArchived?: boolean }
): Promise<Fragment[]> {
  const repository = getMarkdownStoryRepository()
  const active = (await repository.listFragments(dataDir, storyId, type))
    .map((fragment) => normalizeFragment({ ...fragment, archived: false })!)
  if (!opts?.includeArchived) return active

  const archived = (await repository.listArchivedFragments(dataDir, storyId, type))
    .map((fragment) => normalizeFragment({ ...fragment, archived: true })!)
  return [...active, ...archived]
}

export async function listArchivedFragments(
  dataDir: string,
  storyId: string,
  type?: string,
): Promise<Fragment[]> {
  return (await getMarkdownStoryRepository().listArchivedFragments(dataDir, storyId, type))
    .map((fragment) => normalizeFragment({ ...fragment, archived: true })!)
}

export async function archiveFragment(
  dataDir: string,
  storyId: string,
  fragmentId: string
): Promise<Fragment | null> {
  const fragment = await getFragment(dataDir, storyId, fragmentId)
  if (!fragment) return null
  if (!(await getMarkdownStoryRepository().archiveFragment(dataDir, storyId, fragmentId))) return null
  if (fragment.type === 'prose' || fragment.type === 'marker') {
    await getMarkdownStoryRepository().syncCompiledStory(dataDir, storyId)
  }
  return { ...fragment, archived: true, updatedAt: new Date().toISOString() }
}

export async function restoreFragment(
  dataDir: string,
  storyId: string,
  fragmentId: string
): Promise<Fragment | null> {
  const fragment = await getFragment(dataDir, storyId, fragmentId)
  if (!fragment) return null
  if (!(await getMarkdownStoryRepository().restoreFragment(dataDir, storyId, fragmentId))) return null
  if (fragment.type === 'prose' || fragment.type === 'marker') {
    await getMarkdownStoryRepository().syncCompiledStory(dataDir, storyId)
  }
  return { ...fragment, archived: false, updatedAt: new Date().toISOString() }
}

export async function updateFragment(
  dataDir: string,
  storyId: string,
  fragment: Fragment
): Promise<void> {
  const normalized = normalizeFragment(fragment)
  requestLogger.info('Updating fragment markdown', { fragmentId: fragment.id, storyId })
  if (normalized) {
    const repository = getMarkdownStoryRepository()
    await repository.syncFragment(dataDir, storyId, normalized)
    if (normalized.archived) {
      await repository.archiveFragment(dataDir, storyId, normalized.id)
    }
    if (normalized.type === 'prose' || normalized.type === 'marker') {
      await getMarkdownStoryRepository().syncCompiledStory(dataDir, storyId)
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
  const existing = await getFragment(dataDir, storyId, fragmentId)
  if (!existing) return null

  const nextName = updates.name ?? existing.name
  const nextDescription = updates.description ?? existing.description
  const nextContent = updates.content ?? existing.content
  const hasVersionedChange =
    nextName !== existing.name ||
    nextDescription !== existing.description ||
    nextContent !== existing.content

  const now = new Date().toISOString()
  const updated: Fragment = hasVersionedChange
    ? {
        ...existing,
        name: nextName,
        description: nextDescription,
        content: nextContent,
        updatedAt: now,
        version: (existing.version ?? 1) + 1,
        versions: [...(existing.versions ?? []), makeVersionSnapshot(existing, opts?.reason)],
      }
    : {
        ...existing,
        name: nextName,
        description: nextDescription,
        content: nextContent,
        updatedAt: now,
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
  return [...(fragment.versions ?? [])]
}

export async function revertFragmentToVersion(
  dataDir: string,
  storyId: string,
  fragmentId: string,
  targetVersion?: number
): Promise<Fragment | null> {
  const fragment = await getFragment(dataDir, storyId, fragmentId)
  if (!fragment) return null

  const versions = fragment.versions ?? []
  const snapshot = targetVersion === undefined
    ? versions.at(-1)
    : versions.find((v) => v.version === targetVersion)
  if (!snapshot) return null

  const now = new Date().toISOString()
  const nextVersion = (fragment.version ?? 1) + 1
  const updated: Fragment = {
    ...fragment,
    name: snapshot.name,
    description: snapshot.description,
    content: snapshot.content,
    updatedAt: now,
    version: nextVersion,
    versions: [
      ...versions,
      makeVersionSnapshot(fragment, targetVersion === undefined
        ? `revert-to-${snapshot.version}`
        : `revert-to-${targetVersion}`),
    ],
  }

  await updateFragment(dataDir, storyId, updated)
  return updated
}

export async function deleteFragment(
  dataDir: string,
  storyId: string,
  fragmentId: string
): Promise<void> {
  const existing = await getFragment(dataDir, storyId, fragmentId)
  await getMarkdownStoryRepository().deleteFragment(dataDir, storyId, fragmentId)
  if (existing && (existing.type === 'prose' || existing.type === 'marker')) {
    await getMarkdownStoryRepository().syncCompiledStory(dataDir, storyId)
  }
}

/**
 * @deprecated TRANSITIONAL. Delete alongside `StoryMeta.summary` once all
 * live stories have been migrated.
 *
 * One-shot migration for the summary-fragments feature. Converts any
 * non-empty `story.summary` string into a single summary fragment, then
 * clears the field. Idempotent — running again with no `story.summary`
 * is a no-op. Existing summary fragments are never overwritten.
 *
 * Called at the top of `buildContextState` and `applyDeferredSummaries`
 * so legacy content surfaces through the new fragment path on first use.
 */
export async function migrateStoryToSummaryFragments(
  dataDir: string,
  storyId: string,
): Promise<{ migrated: boolean; fragmentId?: string }> {
  const story = await getStory(dataDir, storyId)
  if (!story) return { migrated: false }

  const legacy = typeof story.summary === 'string' ? story.summary.trim() : ''
  if (!legacy) return { migrated: false }

  const existing = await listFragments(dataDir, storyId, 'summary', { includeArchived: true })
  if (existing.length > 0) {
    // Already migrated or summaries exist from the new flow. Clear the
    // legacy field so it doesn't drift further.
    await updateStory(dataDir, { ...story, summary: '', updatedAt: new Date().toISOString() })
    return { migrated: false }
  }

  const { generateFragmentId } = await import('@/lib/fragment-ids')
  const now = new Date().toISOString()
  const fragment: Fragment = {
    id: generateFragmentId('summary'),
    type: 'summary',
    name: 'Story summary',
    description: 'Rolling summary migrated from the legacy story.summary field.',
    content: legacy,
    tags: [],
    refs: [],
    sticky: false,
    placement: 'system',
    createdAt: now,
    updatedAt: now,
    order: 0,
    meta: {
      isEraSummary: true,
      chapterId: null,
      migratedFromLegacy: true,
    },
    archived: false,
    version: 1,
    versions: [],
  }

  await createFragment(dataDir, storyId, fragment)
  await updateStory(dataDir, { ...story, summary: '', updatedAt: now })

  requestLogger.info('Migrated legacy story.summary to summary fragment', {
    storyId,
    fragmentId: fragment.id,
    length: legacy.length,
  })

  return { migrated: true, fragmentId: fragment.id }
}
