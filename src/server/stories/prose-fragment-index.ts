import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import type { Fragment } from '@/server/fragments/schema'
import { getInternalStoryRoot, getProseFragmentIndexPath } from './markdown-paths'
import { buildProseInternalRecord, type ProseFragmentInternalRecord } from './prose-metadata'

export async function readProseFragmentIndex(dataDir: string, storyId: string): Promise<Record<string, ProseFragmentInternalRecord>> {
  const indexPath = getProseFragmentIndexPath(dataDir, storyId)
  if (!existsSync(indexPath)) return {}
  const raw = await readFile(indexPath, 'utf-8')
  return JSON.parse(raw) as Record<string, ProseFragmentInternalRecord>
}

async function writeProseFragmentIndex(
  dataDir: string,
  storyId: string,
  index: Record<string, ProseFragmentInternalRecord>,
): Promise<void> {
  await mkdir(getInternalStoryRoot(dataDir, storyId), { recursive: true })
  await writeFile(getProseFragmentIndexPath(dataDir, storyId), JSON.stringify(index, null, 2), 'utf-8')
}

export async function upsertProseFragmentInternalRecord(dataDir: string, storyId: string, fragment: Fragment): Promise<void> {
  const index = await readProseFragmentIndex(dataDir, storyId)
  index[fragment.id] = buildProseInternalRecord(fragment)
  await writeProseFragmentIndex(dataDir, storyId, index)
}

export async function removeProseFragmentInternalRecord(dataDir: string, storyId: string, fragmentId: string): Promise<void> {
  const index = await readProseFragmentIndex(dataDir, storyId)
  if (!(fragmentId in index)) return
  delete index[fragmentId]
  await writeProseFragmentIndex(dataDir, storyId, index)
}