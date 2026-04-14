import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import type { Fragment } from '@/server/fragments/schema'
import {
  getFragmentInternalIndexPath,
  getInternalStoryRoot,
  getLegacyProseFragmentIndexPath,
} from './paths'
import { buildProseInternalFields, type ProseFragmentInternalFields } from './prose-metadata'

export interface FragmentInternalRecord {
  createdAt: string
  updatedAt: string
  prose?: ProseFragmentInternalFields
}

interface LegacyProseFragmentInternalRecord extends ProseFragmentInternalFields {
  id: string
  createdAt: string
  updatedAt: string
}

function migrateLegacyProseIndex(
  legacy: Record<string, LegacyProseFragmentInternalRecord>,
): Record<string, FragmentInternalRecord> {
  return Object.fromEntries(
    Object.entries(legacy).map(([fragmentId, record]) => [
      fragmentId,
      {
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        prose: {
          name: record.name,
          description: record.description,
          tags: record.tags,
          refs: record.refs,
          sticky: record.sticky,
          placement: record.placement,
          order: record.order,
          meta: record.meta,
        },
      },
    ]),
  )
}

async function readLegacyProseFragmentIndex(
  dataDir: string,
  storyId: string,
): Promise<Record<string, FragmentInternalRecord>> {
  const legacyPath = getLegacyProseFragmentIndexPath(dataDir, storyId)
  if (!existsSync(legacyPath)) return {}
  const raw = await readFile(legacyPath, 'utf-8')
  return migrateLegacyProseIndex(JSON.parse(raw) as Record<string, LegacyProseFragmentInternalRecord>)
}

export async function readFragmentInternalIndex(
  dataDir: string,
  storyId: string,
): Promise<Record<string, FragmentInternalRecord>> {
  const indexPath = getFragmentInternalIndexPath(dataDir, storyId)
  const current = existsSync(indexPath)
    ? JSON.parse(await readFile(indexPath, 'utf-8')) as Record<string, FragmentInternalRecord>
    : {}
  const legacy = await readLegacyProseFragmentIndex(dataDir, storyId)

  if (Object.keys(legacy).length === 0) return current

  return {
    ...legacy,
    ...current,
  }
}

async function writeFragmentInternalIndex(
  dataDir: string,
  storyId: string,
  index: Record<string, FragmentInternalRecord>,
): Promise<void> {
  await mkdir(getInternalStoryRoot(dataDir, storyId), { recursive: true })
  await writeFile(getFragmentInternalIndexPath(dataDir, storyId), JSON.stringify(index, null, 2), 'utf-8')
  await rm(getLegacyProseFragmentIndexPath(dataDir, storyId), { force: true })
}

export function buildFragmentInternalRecord(fragment: Fragment): FragmentInternalRecord {
  return {
    createdAt: fragment.createdAt,
    updatedAt: fragment.updatedAt,
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
  const index = await readFragmentInternalIndex(dataDir, storyId)
  index[fragment.id] = buildFragmentInternalRecord(fragment)
  await writeFragmentInternalIndex(dataDir, storyId, index)
}

export async function removeFragmentInternalRecord(
  dataDir: string,
  storyId: string,
  fragmentId: string,
): Promise<void> {
  const index = await readFragmentInternalIndex(dataDir, storyId)
  if (!(fragmentId in index)) return
  delete index[fragmentId]
  await writeFragmentInternalIndex(dataDir, storyId, index)
}