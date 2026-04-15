import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Fragment, ProseChain, StoryMeta } from '@/server/fragments/schema'
import {
  ARCHIVE_SUBDIR,
  getFilenameDerivedFragmentId,
  getCompiledStoryPath,
  getFragmentFileName,
  getFragmentFolder,
  getInternalStoryRoot,
  getInternalStoryPath,
  INTERNAL_MARKDOWN_DIRS,
  isVisibleFilenameDerivedType,
  MARKDOWN_FRAGMENT_DIRS,
  getMarkdownStoryRoot,
  getProseFragmentIdFromFileName,
  getStoryMetaPath,
  STORY_DIRS,
  getTypeForVisibleFolder,
} from './paths'
import { parseFrontmatter, serializeFrontmatter } from './frontmatter'
import { proseFragmentFromMarkdown, splitProseInternalMeta } from './prose-metadata'
import {
  readFragmentInternalIndex,
  removeFragmentInternalRecord,
  resolveFragmentTimestamps,
  upsertFragmentInternalRecord,
} from './fragment-internals'
import { serializeStoryMeta, storyMetaFromMarkdown } from './story-meta'

function optionalList<T>(value: T[]): T[] | undefined {
  return value.length > 0 ? value : undefined
}

function optionalRecord(value: Record<string, unknown>): Record<string, unknown> | undefined {
  return Object.keys(value).length > 0 ? value : undefined
}

function serializeFragment(fragment: Fragment): string {
  if (fragment.type === 'prose') {
    const { markdownMeta } = splitProseInternalMeta(fragment.meta)
    return serializeFrontmatter(markdownMeta, fragment.content)
  }

  if (isVisibleFilenameDerivedType(fragment.type)) {
    return serializeFrontmatter(
      {
        description: fragment.description,
        tags: optionalList(fragment.tags),
        refs: optionalList(fragment.refs),
        sticky: fragment.sticky,
        placement: fragment.placement,
        order: fragment.order,
        meta: optionalRecord(fragment.meta),
      },
      fragment.content,
    )
  }

  return serializeFrontmatter(
    {
      id: fragment.id,
      type: fragment.type,
      name: fragment.name,
      description: fragment.description,
      tags: optionalList(fragment.tags),
      refs: optionalList(fragment.refs),
      sticky: fragment.sticky,
      placement: fragment.placement,
      order: fragment.order,
      meta: optionalRecord(fragment.meta),
    },
    fragment.content,
  )
}

function fragmentFromLegacyMarkdown(
  attributes: Record<string, unknown>,
  body: string,
  internalRecord?: { createdAt: string; updatedAt: string },
): Fragment | null {
  if (typeof attributes.id !== 'string' || typeof attributes.type !== 'string') return null
  const timestamps = resolveFragmentTimestamps(attributes, internalRecord)
  return {
    id: attributes.id,
    type: attributes.type,
    name: typeof attributes.name === 'string' ? attributes.name : attributes.id,
    description: typeof attributes.description === 'string' ? attributes.description : '',
    content: body,
    tags: Array.isArray(attributes.tags) ? attributes.tags.filter((value): value is string => typeof value === 'string') : [],
    refs: Array.isArray(attributes.refs) ? attributes.refs.filter((value): value is string => typeof value === 'string') : [],
    sticky: Boolean(attributes.sticky),
    placement: attributes.placement === 'system' ? 'system' : 'user',
    createdAt: timestamps.createdAt,
    updatedAt: timestamps.updatedAt,
    order: typeof attributes.order === 'number' ? attributes.order : 0,
    meta: typeof attributes.meta === 'object' && attributes.meta !== null ? attributes.meta as Record<string, unknown> : {},
    version: 1,
    versions: [],
  }
}

function visibleFragmentFromMarkdown(
  type: string,
  fileName: string,
  attributes: Record<string, unknown>,
  body: string,
  internalRecord?: { createdAt: string; updatedAt: string },
): Fragment {
  const baseName = fileName.replace(/\.md$/i, '')
  const timestamps = resolveFragmentTimestamps(attributes, internalRecord)
  return {
    id: getFilenameDerivedFragmentId(type, fileName),
    type,
    name: baseName,
    description: typeof attributes.description === 'string' ? attributes.description : '',
    content: body,
    tags: Array.isArray(attributes.tags) ? attributes.tags.filter((value): value is string => typeof value === 'string') : [],
    refs: Array.isArray(attributes.refs) ? attributes.refs.filter((value): value is string => typeof value === 'string') : [],
    sticky: Boolean(attributes.sticky),
    placement: attributes.placement === 'system' ? 'system' : 'user',
    createdAt: timestamps.createdAt,
    updatedAt: timestamps.updatedAt,
    order: typeof attributes.order === 'number' ? attributes.order : 0,
    meta: typeof attributes.meta === 'object' && attributes.meta !== null ? attributes.meta as Record<string, unknown> : {},
    version: 1,
    versions: [],
  }
}

interface MarkdownFragmentEntry {
  path: string
  folder: string
  entry: string
  archived: boolean
}

async function listFolderEntries(
  folderPath: string,
  folder: string,
  opts: { includeArchived?: boolean; onlyArchived?: boolean },
): Promise<MarkdownFragmentEntry[]> {
  const matches: MarkdownFragmentEntry[] = []

  if (!opts.onlyArchived && existsSync(folderPath)) {
    const entries = await readdir(folderPath)
    for (const entry of entries) {
      if (!entry.endsWith('.md')) continue
      matches.push({ path: join(folderPath, entry), folder, entry, archived: false })
    }
  }

  if ((opts.includeArchived || opts.onlyArchived)) {
    const archivePath = join(folderPath, ARCHIVE_SUBDIR)
    if (existsSync(archivePath)) {
      const archiveEntries = await readdir(archivePath)
      for (const entry of archiveEntries) {
        if (!entry.endsWith('.md')) continue
        matches.push({ path: join(archivePath, entry), folder, entry, archived: true })
      }
    }
  }

  return matches
}

async function findMarkdownFragmentEntry(
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
      const entry = candidate.entry

      let candidateId: string | null = null
      const visibleType = getTypeForVisibleFolder(folder)
      if (folder === 'Prose') {
        candidateId = getProseFragmentIdFromFileName(entry)
      } else if (visibleType && isVisibleFilenameDerivedType(visibleType)) {
        candidateId = getFilenameDerivedFragmentId(visibleType, entry)
      } else if (entry.includes(fragmentId)) {
        candidateId = fragmentId
      }

      if (candidateId !== fragmentId) continue
      matches.push(candidate)
    }
  }

  return matches
}

export async function ensureMarkdownStoryLayout(dataDir: string, storyId: string): Promise<void> {
  const root = getMarkdownStoryRoot(dataDir, storyId)
  await mkdir(root, { recursive: true })
  await Promise.all([
    ...STORY_DIRS.map((dirName) => mkdir(join(root, dirName), { recursive: true })),
    ...INTERNAL_MARKDOWN_DIRS.map((dirName) => mkdir(join(root, dirName), { recursive: true })),
    mkdir(getInternalStoryRoot(dataDir, storyId), { recursive: true }),
  ])
  const compiledPath = getCompiledStoryPath(dataDir, storyId)
  if (!existsSync(compiledPath)) {
    await writeFile(compiledPath, '', 'utf-8')
  }
}

export async function syncStoryMarkdownMeta(dataDir: string, story: StoryMeta): Promise<void> {
  await ensureMarkdownStoryLayout(dataDir, story.id)
  await writeFile(getStoryMetaPath(dataDir, story.id), serializeStoryMeta(story), 'utf-8')
}

export async function loadMarkdownStoryMeta(dataDir: string, storyId: string): Promise<StoryMeta | null> {
  const path = getStoryMetaPath(dataDir, storyId)
  if (!existsSync(path)) return null
  const raw = await readFile(path, 'utf-8')
  const parsed = parseFrontmatter(raw)
  return storyMetaFromMarkdown(parsed.attributes, parsed.body)
}

async function readCurrentProseChain(dataDir: string, storyId: string): Promise<ProseChain | null> {
  const chainPath = getInternalStoryPath(dataDir, storyId, 'prose-chain.json')
  if (!existsSync(chainPath)) return null
  const raw = await readFile(chainPath, 'utf-8')
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

  const folderPath = join(getMarkdownStoryRoot(dataDir, storyId), getFragmentFolder(fragment.type))
  const chain = fragment.type === 'prose' || fragment.type === 'marker'
    ? await readCurrentProseChain(dataDir, storyId)
    : null
  const existingEntries = await findMarkdownFragmentEntry(dataDir, storyId, fragment.id)
  const existingPaths = existingEntries.map((entry) => entry.path)
  const defaultPath = join(folderPath, getFragmentFileName(fragment, findProseSectionIndex(chain, fragment.id)))
  const nextPath = defaultPath

  for (const path of existingPaths) {
    if (path !== nextPath && existsSync(path)) {
      await rm(path, { force: true })
    }
  }

  await writeFile(nextPath, serializeFragment(fragment), 'utf-8')
}

export async function deleteFragmentMarkdown(dataDir: string, storyId: string, fragmentId: string): Promise<void> {
  const existingPaths = (await findMarkdownFragmentEntry(dataDir, storyId, fragmentId, { includeArchived: true })).map((entry) => entry.path)
  for (const path of existingPaths) {
    if (existsSync(path)) {
      await rm(path, { force: true })
    }
  }
  await removeFragmentInternalRecord(dataDir, storyId, fragmentId)
}

export async function loadMarkdownFragmentById(dataDir: string, storyId: string, fragmentId: string): Promise<Fragment | null> {
  const matches = await findMarkdownFragmentEntry(dataDir, storyId, fragmentId, { includeArchived: true })
  const match = matches[0]
  const path = match?.path
  if (!path || !existsSync(path)) return null

  const raw = await readFile(path, 'utf-8')
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

  for (const folder of folders) {
    const folderPath = join(root, folder)
    if (!existsSync(folderPath)) continue
    const entries = await listFolderEntries(folderPath, folder, { includeArchived: false })
    const visibleType = getTypeForVisibleFolder(folder)
    for (const record of entries) {
      const entry = record.entry
      const raw = await readFile(record.path, 'utf-8')
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

export async function writeCompiledStoryMarkdown(
  dataDir: string,
  storyId: string,
  blocks: Array<{ id: string; content: string }>,
): Promise<void> {
  await ensureMarkdownStoryLayout(dataDir, storyId)
  const compiled = blocks
    .map((block) => `[[[${block.id}]]]\n${block.content.trimEnd()}`)
    .join('\n\n')
  await writeFile(getCompiledStoryPath(dataDir, storyId), compiled ? `${compiled}\n` : '', 'utf-8')
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
      const raw = await readFile(record.path, 'utf-8')
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
  const match = (await findMarkdownFragmentEntry(dataDir, storyId, fragmentId, { includeArchived: true }))[0]
  if (!match || match.archived) return false

  const archiveDir = join(join(getMarkdownStoryRoot(dataDir, storyId), match.folder), ARCHIVE_SUBDIR)
  await mkdir(archiveDir, { recursive: true })
  await rename(match.path, join(archiveDir, match.entry))
  return true
}

export async function restoreFragmentMarkdown(dataDir: string, storyId: string, fragmentId: string): Promise<boolean> {
  const match = (await findMarkdownFragmentEntry(dataDir, storyId, fragmentId, { includeArchived: true, onlyArchived: true }))[0]
  if (!match) return false

  const targetDir = join(getMarkdownStoryRoot(dataDir, storyId), match.folder)
  await rename(match.path, join(targetDir, match.entry))
  return true
}
