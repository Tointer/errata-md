import { join } from 'node:path'
import {
  ARCHIVE_SUBDIR,
  MARKDOWN_FRAGMENT_DIRS,
  getFilenameDerivedFragmentId,
  getProseFragmentIdFromFileName,
  getTypeForVisibleFolder,
  isVisibleFilenameDerivedType,
} from './fragment-layout'
import { getStoryDir as getMarkdownStoryRoot } from '../storage/story-layout'
import { readdir } from 'node:fs/promises'
import { readTextIfExists } from '../fs-utils'
import { parseFrontmatter } from './frontmatter'

export interface MarkdownFragmentEntry {
  path: string
  folder: string
  entry: string
  archived: boolean
}

function isMarkdownFile(entry: string): boolean {
  return entry.endsWith('.md')
}

async function collectMarkdownEntries(
  folderPath: string,
  folder: string,
  archived: boolean,
): Promise<MarkdownFragmentEntry[]> {
  let entries: string[]
  try {
    entries = await readdir(folderPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }

  return entries.filter(isMarkdownFile)
    .map((entry) => ({ path: join(folderPath, entry), folder, entry, archived }))
}

export function getEntryFragmentId(folder: string, entry: string): string | null {
  if (folder === 'Prose') return getProseFragmentIdFromFileName(entry)

  const visibleType = getTypeForVisibleFolder(folder)
  if (visibleType && isVisibleFilenameDerivedType(visibleType)) {
    return getFilenameDerivedFragmentId(visibleType, entry)
  }

  return null
}

export async function listFolderEntries(
  folderPath: string,
  folder: string,
  opts: { includeArchived?: boolean; onlyArchived?: boolean },
): Promise<MarkdownFragmentEntry[]> {
  const liveEntries = opts.onlyArchived
    ? []
    : await collectMarkdownEntries(folderPath, folder, false)
  const archivedEntries = opts.includeArchived || opts.onlyArchived
    ? await collectMarkdownEntries(join(folderPath, ARCHIVE_SUBDIR), folder, true)
    : []

  return [...liveEntries, ...archivedEntries]
}

export async function findMarkdownFragmentEntry(
  dataDir: string,
  storyId: string,
  fragmentId: string,
  opts: { includeArchived?: boolean; onlyArchived?: boolean } = { includeArchived: true },
): Promise<MarkdownFragmentEntry[]> {
  const root = getMarkdownStoryRoot(dataDir, storyId)
  const matches: MarkdownFragmentEntry[] = []

  for (const folder of MARKDOWN_FRAGMENT_DIRS) {
    const folderPath = join(root, folder)
    const entries = await listFolderEntries(folderPath, folder, opts)
    for (const candidate of entries) {
      const candidateId = getEntryFragmentId(folder, candidate.entry)
      let isMatch = candidateId
        ? candidateId === fragmentId
        : candidate.entry === `${fragmentId}.md`
      if (!isMatch) {
        const raw = await readTextIfExists(candidate.path)
        if (raw) {
          isMatch = parseFrontmatter(raw).attributes.id === fragmentId
        }
      }
      if (!isMatch) continue
      matches.push(candidate)
    }
  }

  return matches
}
