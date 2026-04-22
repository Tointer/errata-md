import { stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Fragment, ProseChain, StoryMeta } from '@/server/fragments/schema'
import {
  getFilenameDerivedFragmentId,
  getCompiledStoryPath,
  getFragmentFileName,
  getFragmentFolder,
  getInternalStoryRoot,
  getInternalStoryPath,
  INTERNAL_MARKDOWN_DIRS,
  isVisibleFilenameDerivedType,
  getMarkdownStoryRoot,
  MARKDOWN_FRAGMENT_DIRS,
  getProseFragmentIdFromFileName,
  getStoryMetaPath,
  STORY_DIRS,
  getTypeForVisibleFolder,
} from './paths'
import { findMarkdownFragmentEntry, listFolderEntries } from './markdown-fragment-entries.ts'
import {
  archiveMarkdownFragmentFile,
  deleteMarkdownFragmentFiles,
  restoreMarkdownFragmentFile,
  writeMarkdownFragmentFile,
} from './markdown-fragment-files.ts'
import { parseFrontmatter } from './frontmatter'
import {
  fragmentFromLegacyMarkdown,
  serializeFragment,
  visibleFragmentFromMarkdown,
} from './markdown-fragment-codec'
import { proseFragmentFromMarkdown } from './prose-metadata'
import {
  readFragmentInternalIndex,
  removeFragmentInternalRecord,
  resolveFragmentTimestamps,
  upsertFragmentInternalRecord,
} from './fragment-internals'
import { serializeStoryMeta, storyMetaFromMarkdown } from './story-meta'
import {
  mkdirWithRetries,
  readFileWithRetries,
  writeFileWithRetries,
} from '../fs-utils'
import { createLogger } from '../logging/logger'

const repositoryLogger = createLogger('md-repository')

export async function ensureMarkdownStoryLayout(dataDir: string, storyId: string): Promise<void> {
  const root = getMarkdownStoryRoot(dataDir, storyId)
  await mkdirWithRetries(root, { recursive: true })
  await Promise.all([
    ...STORY_DIRS.map((dirName) => mkdirWithRetries(join(root, dirName), { recursive: true })),
    ...INTERNAL_MARKDOWN_DIRS.map((dirName) => mkdirWithRetries(join(root, dirName), { recursive: true })),
    mkdirWithRetries(getInternalStoryRoot(dataDir, storyId), { recursive: true }),
  ])
  const compiledPath = getCompiledStoryPath(dataDir, storyId)
  if (!existsSync(compiledPath)) {
    await writeFileWithRetries(compiledPath, '', 'utf-8')
  }
}

export async function syncStoryMarkdownMeta(dataDir: string, story: StoryMeta): Promise<void> {
  await ensureMarkdownStoryLayout(dataDir, story.id)
  await writeFileWithRetries(getStoryMetaPath(dataDir, story.id), serializeStoryMeta(story), 'utf-8')
}

export async function loadMarkdownStoryMeta(dataDir: string, storyId: string): Promise<StoryMeta | null> {
  const path = getStoryMetaPath(dataDir, storyId)
  if (!existsSync(path)) return null
  const [raw, fileStats] = await Promise.all([
    readFileWithRetries(path, 'utf-8'),
    stat(path),
  ])
  const parsed = parseFrontmatter(raw)
  return storyMetaFromMarkdown(parsed.attributes, parsed.body, {
    createdAt: fileStats.birthtime.toISOString(),
    updatedAt: fileStats.mtime.toISOString(),
  })
}

async function readCurrentProseChain(dataDir: string, storyId: string): Promise<ProseChain | null> {
  const chainPath = getInternalStoryPath(dataDir, storyId, 'prose-chain.json')
  if (!existsSync(chainPath)) return null
  const raw = await readFileWithRetries(chainPath, 'utf-8')
  return JSON.parse(raw) as ProseChain
}

function findProseSectionIndex(chain: ProseChain | null, fragmentId: string): number | undefined {
  if (!chain) return undefined
  const index = chain.entries.findIndex((entry) => entry.proseFragments.includes(fragmentId))
  return index === -1 ? undefined : index
}

export async function syncFragmentMarkdown(dataDir: string, storyId: string, fragment: Fragment): Promise<void> {
  await ensureMarkdownStoryLayout(dataDir, storyId)
  await upsertFragmentInternalRecord(dataDir, storyId, fragment)

  const chain = fragment.type === 'prose' || fragment.type === 'marker'
    ? await readCurrentProseChain(dataDir, storyId)
    : null
  await writeMarkdownFragmentFile(
    dataDir,
    storyId,
    fragment.id,
    getFragmentFolder(fragment.type),
    getFragmentFileName(fragment, findProseSectionIndex(chain, fragment.id)),
    serializeFragment(fragment),
  )
}

export async function deleteFragmentMarkdown(dataDir: string, storyId: string, fragmentId: string): Promise<void> {
  await deleteMarkdownFragmentFiles(dataDir, storyId, fragmentId)
  await removeFragmentInternalRecord(dataDir, storyId, fragmentId)
}

export async function loadMarkdownFragmentById(dataDir: string, storyId: string, fragmentId: string): Promise<Fragment | null> {
  const matches = await findMarkdownFragmentEntry(dataDir, storyId, fragmentId, { includeArchived: true })
  const match = matches[0]
  const path = match?.path
  if (!path || !existsSync(path)) return null

  const raw = await readFileWithRetries(path, 'utf-8')
  const parsed = parseFrontmatter(raw)
  const internalIndex = await readFragmentInternalIndex(dataDir, storyId)
  const internalRecord = internalIndex[fragmentId]
  const proseDir = join(getMarkdownStoryRoot(dataDir, storyId), 'Prose')

  if (path.startsWith(proseDir)) {
    return proseFragmentFromMarkdown(
      fragmentId,
      parsed.attributes,
      parsed.body,
      internalRecord?.prose,
      resolveFragmentTimestamps(parsed.attributes, internalRecord),
      (attributes, body) => fragmentFromLegacyMarkdown(attributes, body, internalRecord),
    )
  }

  const visibleType = match ? getTypeForVisibleFolder(match.folder) : null
  if (visibleType && isVisibleFilenameDerivedType(visibleType) && match) {
    return visibleFragmentFromMarkdown(visibleType, match.entry, parsed.attributes, parsed.body, internalRecord)
  }

  return fragmentFromLegacyMarkdown(parsed.attributes, parsed.body, internalRecord)
}

export async function listMarkdownFragments(
  dataDir: string,
  storyId: string,
  type?: string,
): Promise<Fragment[]> {
  const root = getMarkdownStoryRoot(dataDir, storyId)
  if (!existsSync(root)) return []

  const folders = type ? [getFragmentFolder(type)] : [...MARKDOWN_FRAGMENT_DIRS]
  const fragments: Fragment[] = []
  const internalIndex = await readFragmentInternalIndex(dataDir, storyId)
  const storyLogger = repositoryLogger.child({ storyId, extra: type ? { type } : undefined })

  for (const folder of folders) {
    const folderPath = join(root, folder)
    if (!existsSync(folderPath)) continue
    const entries = await listFolderEntries(folderPath, folder, { includeArchived: false })
    const visibleType = getTypeForVisibleFolder(folder)
    for (const record of entries) {
      const entry = record.entry
      const raw = await readFileWithRetries(record.path, 'utf-8')
      const parsed = parseFrontmatter(raw)
      const proseId = getProseFragmentIdFromFileName(entry)
      const visibleId = visibleType && isVisibleFilenameDerivedType(visibleType)
        ? getFilenameDerivedFragmentId(visibleType, entry)
        : undefined
      const legacyId = typeof parsed.attributes.id === 'string' ? parsed.attributes.id : undefined
      const fragment = folder === 'Prose'
        ? proseFragmentFromMarkdown(
            proseId,
            parsed.attributes,
            parsed.body,
            internalIndex[proseId]?.prose,
            resolveFragmentTimestamps(parsed.attributes, internalIndex[proseId]),
            (attributes, body) => fragmentFromLegacyMarkdown(attributes, body, internalIndex[proseId]),
          )
        : visibleType && isVisibleFilenameDerivedType(visibleType)
          ? visibleFragmentFromMarkdown(visibleType, entry, parsed.attributes, parsed.body, internalIndex[visibleId ?? ''])
          : fragmentFromLegacyMarkdown(parsed.attributes, parsed.body, legacyId ? internalIndex[legacyId] : undefined)

      if (!fragment) {
        storyLogger.warn('Skipped invalid markdown fragment', {
          folder,
          path: record.path,
          entry,
        })
        continue
      }
      if (type && fragment.type !== type) continue
      fragments.push(fragment)
    }
  }

  return fragments.sort((left, right) => {
    if (left.order !== right.order) return left.order - right.order
    return left.id.localeCompare(right.id)
  })
}

export async function writeCompiledStoryMarkdown(
  dataDir: string,
  storyId: string,
  blocks: Array<{ id: string; content: string }>,
): Promise<void> {
  await ensureMarkdownStoryLayout(dataDir, storyId)
  const compiled = blocks
    .map((block) => `[[[${block.id}]]]\n${block.content.trimEnd()}`)
    .join('\n\n')
  await writeFileWithRetries(getCompiledStoryPath(dataDir, storyId), compiled ? `${compiled}\n` : '', 'utf-8')
}

export async function syncCompiledStoryFromCurrentChain(dataDir: string, storyId: string): Promise<void> {
  const chain = await readCurrentProseChain(dataDir, storyId)
  if (!chain) {
    await writeCompiledStoryMarkdown(dataDir, storyId, [])
    return
  }

  const blocks: Array<{ id: string; content: string }> = []
  for (const entry of chain.entries) {
    const fragment = await loadMarkdownFragmentById(dataDir, storyId, entry.active)
    if (!fragment || await isMarkdownFragmentArchived(dataDir, storyId, entry.active) || fragment.type === 'marker') continue
    blocks.push({ id: fragment.id, content: fragment.content })
  }

  await writeCompiledStoryMarkdown(dataDir, storyId, blocks)
}

export async function syncProseMarkdownOrder(dataDir: string, storyId: string): Promise<void> {
  const chain = await readCurrentProseChain(dataDir, storyId)
  if (!chain) return

  for (const entry of chain.entries) {
    for (const fragmentId of entry.proseFragments) {
      const fragment = await loadMarkdownFragmentById(dataDir, storyId, fragmentId)
      if (!fragment) continue
      await syncFragmentMarkdown(dataDir, storyId, fragment)
    }
  }
}

export async function isMarkdownFragmentArchived(dataDir: string, storyId: string, fragmentId: string): Promise<boolean> {
  const match = (await findMarkdownFragmentEntry(dataDir, storyId, fragmentId, { includeArchived: true }))[0]
  return Boolean(match?.archived)
}

export async function listArchivedMarkdownFragments(
  dataDir: string,
  storyId: string,
  type?: string,
): Promise<Fragment[]> {
  const root = getMarkdownStoryRoot(dataDir, storyId)
  if (!existsSync(root)) return []

  const folders = type ? [getFragmentFolder(type)] : [...MARKDOWN_FRAGMENT_DIRS]
  const fragments: Fragment[] = []
  const internalIndex = await readFragmentInternalIndex(dataDir, storyId)

  for (const folder of folders) {
    const folderPath = join(root, folder)
    if (!existsSync(folderPath)) continue
    const entries = await listFolderEntries(folderPath, folder, { includeArchived: true, onlyArchived: true })
    const visibleType = getTypeForVisibleFolder(folder)
    for (const record of entries) {
      const raw = await readFileWithRetries(record.path, 'utf-8')
      const parsed = parseFrontmatter(raw)
      const proseId = getProseFragmentIdFromFileName(record.entry)
      const visibleId = visibleType && isVisibleFilenameDerivedType(visibleType)
        ? getFilenameDerivedFragmentId(visibleType, record.entry)
        : undefined
      const legacyId = typeof parsed.attributes.id === 'string' ? parsed.attributes.id : undefined
      const fragment = folder === 'Prose'
        ? proseFragmentFromMarkdown(
            proseId,
            parsed.attributes,
            parsed.body,
            internalIndex[proseId]?.prose,
            resolveFragmentTimestamps(parsed.attributes, internalIndex[proseId]),
            (attributes, body) => fragmentFromLegacyMarkdown(attributes, body, internalIndex[proseId]),
          )
        : visibleType && isVisibleFilenameDerivedType(visibleType)
          ? visibleFragmentFromMarkdown(visibleType, record.entry, parsed.attributes, parsed.body, internalIndex[visibleId ?? ''])
          : fragmentFromLegacyMarkdown(parsed.attributes, parsed.body, legacyId ? internalIndex[legacyId] : undefined)

      if (!fragment) continue
      if (type && fragment.type !== type) continue
      fragments.push(fragment)
    }
  }

  return fragments.sort((left, right) => {
    if (left.order !== right.order) return left.order - right.order
    return left.id.localeCompare(right.id)
  })
}

export async function archiveFragmentMarkdown(dataDir: string, storyId: string, fragmentId: string): Promise<boolean> {
  return archiveMarkdownFragmentFile(dataDir, storyId, fragmentId)
}

export async function restoreFragmentMarkdown(dataDir: string, storyId: string, fragmentId: string): Promise<boolean> {
  return restoreMarkdownFragmentFile(dataDir, storyId, fragmentId)
}
