import type { Fragment, FragmentVersion } from '@/server/fragments/schema'
import { getFragmentInternalIndexPath } from '../story-layout'
import { buildProseInternalFields, type ProseFragmentInternalFields } from '../../md-files/prose-metadata'
import { createLogger } from '../../logging/logger'
import { readTextIfExists, writeJsonAtomic } from '../../fs-utils'
import { withKeyLock } from '../../async-lock'

const logger = createLogger('fragment-internals')
function getStoryIndexWriteKey(dataDir: string, storyId: string): string {
  return `${dataDir}::${storyId}`
}

export interface FragmentInternalRecord {
  createdAt: string
  updatedAt: string
  version: number
  versions: FragmentVersion[]
  prose?: ProseFragmentInternalFields
}

export async function readFragmentInternalIndex(
  dataDir: string,
  storyId: string,
): Promise<Record<string, FragmentInternalRecord>> {
  const indexPath = getFragmentInternalIndexPath(dataDir, storyId)
  let current: Record<string, FragmentInternalRecord> = {}

  try {
    const raw = await readTextIfExists(indexPath)
    current = raw ? JSON.parse(raw) as Record<string, FragmentInternalRecord> : {}
  } catch (error) {
    logger.warn('Failed to parse fragment internal index; continuing with empty index', {
      storyId,
      path: indexPath,
      error: error instanceof Error ? error.message : String(error),
    })
  }

  return current
}

async function writeFragmentInternalIndex(
  dataDir: string,
  storyId: string,
  index: Record<string, FragmentInternalRecord>,
): Promise<void> {
  await writeJsonAtomic(getFragmentInternalIndexPath(dataDir, storyId), index)
}

export function buildFragmentInternalRecord(fragment: Fragment): FragmentInternalRecord {
  return {
    createdAt: fragment.createdAt,
    updatedAt: fragment.updatedAt,
    version: fragment.version ?? 1,
    versions: fragment.versions ?? [],
    ...(fragment.type === 'prose' ? { prose: buildProseInternalFields(fragment) } : {}),
  }
}

export function resolveFragmentTimestamps(
  attributes: Record<string, unknown>,
  internalRecord: FragmentInternalRecord | undefined,
): { createdAt: string; updatedAt: string } {
  const now = new Date().toISOString()
  return {
    createdAt: internalRecord?.createdAt ?? (typeof attributes.createdAt === 'string' ? attributes.createdAt : now),
    updatedAt: internalRecord?.updatedAt ?? (typeof attributes.updatedAt === 'string' ? attributes.updatedAt : now),
  }
}

export async function upsertFragmentInternalRecord(
  dataDir: string,
  storyId: string,
  fragment: Fragment,
): Promise<void> {
  await withKeyLock(getStoryIndexWriteKey(dataDir, storyId), async () => {
    const index = await readFragmentInternalIndex(dataDir, storyId)
    index[fragment.id] = buildFragmentInternalRecord(fragment)
    await writeFragmentInternalIndex(dataDir, storyId, index)
  })
}

export async function removeFragmentInternalRecord(
  dataDir: string,
  storyId: string,
  fragmentId: string,
): Promise<void> {
  await withKeyLock(getStoryIndexWriteKey(dataDir, storyId), async () => {
    const index = await readFragmentInternalIndex(dataDir, storyId)
    if (!(fragmentId in index)) return
    delete index[fragmentId]
    await writeFragmentInternalIndex(dataDir, storyId, index)
  })
}
