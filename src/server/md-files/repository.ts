import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
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
  readProseFragmentIndex,
  removeProseFragmentInternalRecord,
  upsertProseFragmentInternalRecord,
} from './prose-fragment-index'
import { serializeStoryMeta, storyMetaFromMarkdown } from './story-meta'

function serializeFragment(fragment: Fragment): string {
  if (fragment.type === 'prose') {
    const { markdownMeta } = splitProseInternalMeta(fragment.meta)
    return serializeFrontmatter(markdownMeta, fragment.content)
  }

  if (isVisibleFilenameDerivedType(fragment.type)) {
    return serializeFrontmatter(
      {
        description: fragment.description,
        tags: fragment.tags,
        refs: fragment.refs,
        sticky: fragment.sticky,
        placement: fragment.placement,
        order: fragment.order,
        createdAt: fragment.createdAt,
        updatedAt: fragment.updatedAt,
        archived: fragment.archived ?? false,
        meta: fragment.meta,
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
      tags: fragment.tags,
      refs: fragment.refs,
      sticky: fragment.sticky,
      placement: fragment.placement,
      order: fragment.order,
      createdAt: fragment.createdAt,
      updatedAt: fragment.updatedAt,
      archived: fragment.archived ?? false,
      meta: fragment.meta,
    },
    fragment.content,
  )
}

function fragmentFromLegacyMarkdown(attributes: Record<string, unknown>, body: string): Fragment | null {
  if (typeof attributes.id !== 'string' || typeof attributes.type !== 'string') return null
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
    createdAt: typeof attributes.createdAt === 'string' ? attributes.createdAt : new Date().toISOString(),
    updatedAt: typeof attributes.updatedAt === 'string' ? attributes.updatedAt : new Date().toISOString(),
    order: typeof attributes.order === 'number' ? attributes.order : 0,
    meta: typeof attributes.meta === 'object' && attributes.meta !== null ? attributes.meta as Record<string, unknown> : {},
    archived: Boolean(attributes.archived),
    version: 1,
    versions: [],
  }
}

function visibleFragmentFromMarkdown(
  type: string,
  fileName: string,
  attributes: Record<string, unknown>,
  body: string,
): Fragment {
  const baseName = fileName.replace(/\.md$/i, '')
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
    createdAt: typeof attributes.createdAt === 'string' ? attributes.createdAt : new Date().toISOString(),
    updatedAt: typeof attributes.updatedAt === 'string' ? attributes.updatedAt : new Date().toISOString(),
    order: typeof attributes.order === 'number' ? attributes.order : 0,
    meta: typeof attributes.meta === 'object' && attributes.meta !== null ? attributes.meta as Record<string, unknown> : {},
    archived: Boolean(attributes.archived),
    version: 1,
    versions: [],
  }
}

async function findMarkdownFragmentEntry(
  dataDir: string,
  storyId: string,
  fragmentId: string,
): Promise<Array<{ path: string; folder: string; entry: string }>> {
  const root = getMarkdownStoryRoot(dataDir, storyId)
  const matches: Array<{ path: string; folder: string; entry: string }> = []

  for (const folder of MARKDOWN_FRAGMENT_DIRS) {
    const folderPath = join(root, folder)
    if (!existsSync(folderPath)) continue
    const entries = await readdir(folderPath)
    for (const entry of entries) {
      if (!entry.endsWith('.md')) continue

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
      matches.push({ path: join(folderPath, entry), folder, entry })
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

async function listMarkdownFragmentPaths(dataDir: string, storyId: string, fragmentId: string): Promise<string[]> {
  return (await findMarkdownFragmentEntry(dataDir, storyId, fragmentId)).map((match) => match.path)
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

  if (fragment.type === 'prose') {
    await upsertProseFragmentInternalRecord(dataDir, storyId, fragment)
  }

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
  const existingPaths = await listMarkdownFragmentPaths(dataDir, storyId, fragmentId)
  for (const path of existingPaths) {
    if (existsSync(path)) {
      await rm(path, { force: true })
    }
  }
  await removeProseFragmentInternalRecord(dataDir, storyId, fragmentId)
}

export async function loadMarkdownFragmentById(dataDir: string, storyId: string, fragmentId: string): Promise<Fragment | null> {
  const matches = await findMarkdownFragmentEntry(dataDir, storyId, fragmentId)
  const match = matches[0]
  const path = match?.path
  if (!path || !existsSync(path)) return null

  const raw = await readFile(path, 'utf-8')
  const parsed = parseFrontmatter(raw)
  const proseDir = join(getMarkdownStoryRoot(dataDir, storyId), 'Prose')

  if (path.startsWith(proseDir)) {
    const proseIndex = await readProseFragmentIndex(dataDir, storyId)
    return proseFragmentFromMarkdown(fragmentId, parsed.attributes, parsed.body, proseIndex[fragmentId], fragmentFromLegacyMarkdown)
  }

  const visibleType = match ? getTypeForVisibleFolder(match.folder) : null
  if (visibleType && isVisibleFilenameDerivedType(visibleType) && match) {
    return visibleFragmentFromMarkdown(visibleType, match.entry, parsed.attributes, parsed.body)
  }

  return fragmentFromLegacyMarkdown(parsed.attributes, parsed.body)
}

export async function listMarkdownFragments(
  dataDir: string,
  storyId: string,
  type?: string,
  opts?: { includeArchived?: boolean },
): Promise<Fragment[]> {
  const root = getMarkdownStoryRoot(dataDir, storyId)
  if (!existsSync(root)) return []

  const includeArchived = opts?.includeArchived ?? false
  const folders = type ? [getFragmentFolder(type)] : [...MARKDOWN_FRAGMENT_DIRS]
  const fragments: Fragment[] = []
  const proseIndex = folders.includes(getFragmentFolder('prose')) ? await readProseFragmentIndex(dataDir, storyId) : {}

  for (const folder of folders) {
    const folderPath = join(root, folder)
    if (!existsSync(folderPath)) continue
    const entries = await readdir(folderPath)
    const visibleType = getTypeForVisibleFolder(folder)
    for (const entry of entries) {
      if (!entry.endsWith('.md')) continue
      const raw = await readFile(join(folderPath, entry), 'utf-8')
      const parsed = parseFrontmatter(raw)
      const proseId = getProseFragmentIdFromFileName(entry)
      const fragment = folder === 'Prose'
        ? proseFragmentFromMarkdown(proseId, parsed.attributes, parsed.body, proseIndex[proseId], fragmentFromLegacyMarkdown)
        : visibleType && isVisibleFilenameDerivedType(visibleType)
          ? visibleFragmentFromMarkdown(visibleType, entry, parsed.attributes, parsed.body)
        : fragmentFromLegacyMarkdown(parsed.attributes, parsed.body)

      if (!fragment) continue
      if (type && fragment.type !== type) continue
      if (!includeArchived && fragment.archived) continue
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
    if (!fragment || fragment.archived || fragment.type === 'marker') continue
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
