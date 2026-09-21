import { join } from 'node:path'
import { findMarkdownFragmentEntry } from './fragment-locator'
import { ARCHIVE_SUBDIR } from './fragment-layout'
import { getStoryDir as getMarkdownStoryRoot } from '../storage/story-layout'
import { existsSync } from 'node:fs'
import { moveFileWithRetry, removeFileWithRetry, writeTextAtomic } from '../fs-utils'

export async function writeMarkdownFragmentFile(
  dataDir: string,
  storyId: string,
  fragmentId: string,
  folder: string,
  entry: string,
  content: string,
): Promise<void> {
  const folderPath = join(getMarkdownStoryRoot(dataDir, storyId), folder)
  const existingEntries = await findMarkdownFragmentEntry(dataDir, storyId, fragmentId)
  const existingPaths = existingEntries.map((record) => record.path)
  const nextPath = join(folderPath, entry)

  for (const path of existingPaths) {
    if (path !== nextPath && existsSync(path)) {
      await removeFileWithRetry(path)
    }
  }

  await writeTextAtomic(nextPath, content)
}

export async function deleteMarkdownFragmentFiles(
  dataDir: string,
  storyId: string,
  fragmentId: string,
): Promise<void> {
  const existingPaths = (await findMarkdownFragmentEntry(dataDir, storyId, fragmentId, {
    includeArchived: true,
  })).map((record) => record.path)

  for (const path of existingPaths) {
    if (existsSync(path)) {
      await removeFileWithRetry(path)
    }
  }
}

export async function archiveMarkdownFragmentFile(
  dataDir: string,
  storyId: string,
  fragmentId: string,
): Promise<boolean> {
  const match = (await findMarkdownFragmentEntry(dataDir, storyId, fragmentId, { includeArchived: true }))[0]
  if (!match || match.archived) return false

  const archiveDir = join(getMarkdownStoryRoot(dataDir, storyId), match.folder, ARCHIVE_SUBDIR)
  await moveFileWithRetry(match.path, join(archiveDir, match.entry))
  return true
}

export async function restoreMarkdownFragmentFile(
  dataDir: string,
  storyId: string,
  fragmentId: string,
): Promise<boolean> {
  const match = (await findMarkdownFragmentEntry(dataDir, storyId, fragmentId, {
    includeArchived: true,
    onlyArchived: true,
  }))[0]
  if (!match) return false

  const targetDir = join(getMarkdownStoryRoot(dataDir, storyId), match.folder)
  await moveFileWithRetry(match.path, join(targetDir, match.entry))
  return true
}
