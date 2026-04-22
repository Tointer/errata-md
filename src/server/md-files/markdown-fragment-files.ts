import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { findMarkdownFragmentEntry } from './markdown-fragment-entries.ts'
import { ARCHIVE_SUBDIR, getMarkdownStoryRoot } from './paths'
import {
  mkdirWithRetries,
  renameWithRetries,
  rmWithRetries,
  writeFileWithRetries,
} from '../fs-utils'

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
      await rmWithRetries(path, { force: true })
    }
  }

  await writeFileWithRetries(nextPath, content, 'utf-8')
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
      await rmWithRetries(path, { force: true })
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
  await mkdirWithRetries(archiveDir, { recursive: true })
  await renameWithRetries(match.path, join(archiveDir, match.entry))
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
  await renameWithRetries(match.path, join(targetDir, match.entry))
  return true
}