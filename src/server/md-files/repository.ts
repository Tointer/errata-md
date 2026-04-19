import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
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
import { registry } from '../fragments/registry'
import { createLogger } from '../logging/logger'
import { getFrozenSections, type FrozenSection } from '../fragments/protection'

const repositoryLogger = createLogger('md-repository')
const MARKDOWN_EDITABLE_DELIMITER = '<!-- editable -->'
const MARKDOWN_LEADING_FROZEN_SECTION_ID = 'fs-md-leading'
const MARKDOWN_LEADING_FROZEN_META_KEY = '_mdLeadingFrozen'

function optionalList<T>(value: T[]): T[] | undefined {
  return value.length > 0 ? value : undefined
}

function optionalRecord(value: Record<string, unknown>): Record<string, unknown> | undefined {
  const filtered = Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined),
  )
  return Object.keys(filtered).length > 0 ? filtered : undefined
}

function resolveSticky(type: string, attributes: Record<string, unknown>): boolean {
  if (typeof attributes.sticky === 'boolean') return attributes.sticky
  return registry.getType(type)?.stickyByDefault ?? false
}

function supportsMarkdownLeadingFreeze(type: string): boolean {
  return type === 'character' || type === 'guideline' || type === 'knowledge'
}

function dedupeFrozenSections(sections: FrozenSection[]): FrozenSection[] {
  const seen = new Set<string>()
  const result: FrozenSection[] = []

  for (const section of sections) {
    const key = `${section.id}\u0000${section.text}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push(section)
  }

  return result
}

function combineBodyParts(frozenPart: string, editablePart: string): string {
  if (frozenPart && editablePart) return `${frozenPart}\n\n${editablePart}`
  return frozenPart || editablePart
}

function splitMarkdownEditableBody(body: string): {
  content: string
  leadingFrozenText: string | null
} {
  const normalized = body.replace(/\r\n/g, '\n')
  const lines = normalized.split('\n')
  const delimiterIndex = lines.findIndex((line) => line.trim() === MARKDOWN_EDITABLE_DELIMITER)

  if (delimiterIndex === -1) {
    return {
      content: normalized,
      leadingFrozenText: null,
    }
  }

  const frozenPart = lines.slice(0, delimiterIndex).join('\n').replace(/\n+$/g, '')
  const editablePart = lines.slice(delimiterIndex + 1).join('\n').replace(/^\n+/g, '')

  return {
    content: combineBodyParts(frozenPart, editablePart),
    leadingFrozenText: frozenPart.length > 0 ? frozenPart : null,
  }
}

function extractMarkdownFrozenMeta(type: string, body: string, meta: Record<string, unknown>): {
  content: string
  meta: Record<string, unknown>
} {
  const storedLeadingFrozen = meta[MARKDOWN_LEADING_FROZEN_META_KEY] === true
  const { [MARKDOWN_LEADING_FROZEN_META_KEY]: _ignoredLeadingFrozen, ...metaWithoutInternalMarker } = meta

  if (!supportsMarkdownLeadingFreeze(type)) {
    return { content: body, meta: metaWithoutInternalMarker }
  }

  const normalizedBody = body.replace(/\r\n/g, '\n')
  const { content, leadingFrozenText } = splitMarkdownEditableBody(body)
  const fallbackLeadingFrozenText = type === 'guideline' && storedLeadingFrozen === false && normalizedBody.trim().length > 0
    ? normalizedBody
    : null
  const effectiveLeadingFrozenText = leadingFrozenText ?? (storedLeadingFrozen ? normalizedBody : fallbackLeadingFrozenText)
  const existingSections = getFrozenSections(metaWithoutInternalMarker)
  const leadingSection = effectiveLeadingFrozenText
    ? [{ id: MARKDOWN_LEADING_FROZEN_SECTION_ID, text: effectiveLeadingFrozenText } satisfies FrozenSection]
    : []
  const frozenSections = dedupeFrozenSections([
    ...leadingSection,
    ...existingSections.filter((section) => section.id !== MARKDOWN_LEADING_FROZEN_SECTION_ID),
  ])

  return {
    content,
    meta: frozenSections.length > 0
      ? { ...metaWithoutInternalMarker, frozenSections }
      : { ...metaWithoutInternalMarker, frozenSections: undefined },
  }
}

function findLeadingFrozenSection(type: string, fragment: Fragment): FrozenSection | null {
  if (!supportsMarkdownLeadingFreeze(type)) return null

  const sections = getFrozenSections(fragment.meta)
  let best: FrozenSection | null = null

  for (const section of sections) {
    if (!fragment.content.startsWith(section.text)) continue
    if (!best || section.text.length > best.text.length) {
      best = section
    }
  }

  return best
}

function splitFrontmatterMetaForMarkdown(type: string, fragment: Fragment): {
  body: string
  frontmatterMeta: Record<string, unknown>
} {
  const leadingFrozen = findLeadingFrozenSection(type, fragment)
  const sections = getFrozenSections(fragment.meta)
  const remainingFrozenSections = leadingFrozen
    ? sections.filter((section) => section.id !== leadingFrozen.id || section.text !== leadingFrozen.text)
    : sections

  const frontmatterMeta: Record<string, unknown> = {
    ...fragment.meta,
    [MARKDOWN_LEADING_FROZEN_META_KEY]: leadingFrozen && leadingFrozen.text === fragment.content ? true : undefined,
    frozenSections: remainingFrozenSections.length > 0 ? remainingFrozenSections : undefined,
  }

  if (!leadingFrozen || leadingFrozen.text === fragment.content) {
    return {
      body: fragment.content,
      frontmatterMeta,
    }
  }

  const editablePart = fragment.content.slice(leadingFrozen.text.length).replace(/^\n+/g, '')
  return {
    body: editablePart.length > 0
      ? `${leadingFrozen.text.replace(/\n+$/g, '')}\n\n${MARKDOWN_EDITABLE_DELIMITER}\n\n${editablePart}`
      : leadingFrozen.text,
    frontmatterMeta,
  }
}

function serializeFragment(fragment: Fragment): string {
  if (fragment.type === 'prose') {
    const { markdownMeta } = splitProseInternalMeta(fragment.meta)
    return serializeFrontmatter(markdownMeta, fragment.content)
  }

  const { body, frontmatterMeta } = splitFrontmatterMetaForMarkdown(fragment.type, fragment)

  if (isVisibleFilenameDerivedType(fragment.type)) {
    return serializeFrontmatter(
      {
        description: fragment.description,
        tags: optionalList(fragment.tags),
        refs: optionalList(fragment.refs),
        sticky: fragment.sticky,
        placement: fragment.placement,
        order: fragment.order,
        meta: optionalRecord(frontmatterMeta),
      },
      body,
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
      meta: optionalRecord(frontmatterMeta),
    },
    body,
  )
}

function fragmentFromLegacyMarkdown(
  attributes: Record<string, unknown>,
  body: string,
  internalRecord?: { createdAt: string; updatedAt: string },
): Fragment | null {
  if (typeof attributes.id !== 'string' || typeof attributes.type !== 'string') return null
  const timestamps = resolveFragmentTimestamps(attributes, internalRecord)
  const rawMeta = typeof attributes.meta === 'object' && attributes.meta !== null
    ? attributes.meta as Record<string, unknown>
    : {}
  const bodyFreeze = extractMarkdownFrozenMeta(attributes.type, body, rawMeta)
  return {
    id: attributes.id,
    type: attributes.type,
    name: typeof attributes.name === 'string' ? attributes.name : attributes.id,
    description: typeof attributes.description === 'string' ? attributes.description : '',
    content: bodyFreeze.content,
    tags: Array.isArray(attributes.tags) ? attributes.tags.filter((value): value is string => typeof value === 'string') : [],
    refs: Array.isArray(attributes.refs) ? attributes.refs.filter((value): value is string => typeof value === 'string') : [],
    sticky: resolveSticky(attributes.type, attributes),
    placement: attributes.placement === 'system' ? 'system' : 'user',
    createdAt: timestamps.createdAt,
    updatedAt: timestamps.updatedAt,
    order: typeof attributes.order === 'number' ? attributes.order : 0,
    meta: bodyFreeze.meta,
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
  const rawMeta = typeof attributes.meta === 'object' && attributes.meta !== null
    ? attributes.meta as Record<string, unknown>
    : {}
  const bodyFreeze = extractMarkdownFrozenMeta(type, body, rawMeta)
  return {
    id: getFilenameDerivedFragmentId(type, fileName),
    type,
    name: baseName,
    description: typeof attributes.description === 'string' ? attributes.description : '',
    content: bodyFreeze.content,
    tags: Array.isArray(attributes.tags) ? attributes.tags.filter((value): value is string => typeof value === 'string') : [],
    refs: Array.isArray(attributes.refs) ? attributes.refs.filter((value): value is string => typeof value === 'string') : [],
    sticky: resolveSticky(type, attributes),
    placement: attributes.placement === 'system' ? 'system' : 'user',
    createdAt: timestamps.createdAt,
    updatedAt: timestamps.updatedAt,
    order: typeof attributes.order === 'number' ? attributes.order : 0,
    meta: bodyFreeze.meta,
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
  const [raw, fileStats] = await Promise.all([
    readFile(path, 'utf-8'),
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
  const storyLogger = repositoryLogger.child({ storyId, extra: type ? { type } : undefined })

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
