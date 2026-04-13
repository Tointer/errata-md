import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Fragment, ProseChain, StoryMeta } from '@/server/fragments/schema'
import { getContentRoot } from '@/server/fragments/branches'

const STORY_META_FILE = '_story.md'
const STORY_OUTPUT_FILE = 'story.md'

const FOLDER_BY_TYPE: Record<string, string> = {
  prose: 'Prose',
  character: 'Characters',
  guideline: 'Guidelines',
  knowledge: 'Lorebook',
  marker: 'Markers',
  image: 'Images',
  icon: 'Icons',
}

const STORY_DIRS = [
  'Guidelines',
  'Characters',
  'Lorebook',
  'Prose',
  'Markers',
  'Images',
  'Icons',
  'Fragments',
] as const

function storiesDir(dataDir: string): string {
  return join(dataDir, 'stories')
}

export function getMarkdownStoryRoot(dataDir: string, storyId: string): string {
  return join(storiesDir(dataDir), storyId)
}

function getStoryMetaPath(dataDir: string, storyId: string): string {
  return join(getMarkdownStoryRoot(dataDir, storyId), STORY_META_FILE)
}

export function getCompiledStoryPath(dataDir: string, storyId: string): string {
  return join(getMarkdownStoryRoot(dataDir, storyId), STORY_OUTPUT_FILE)
}

function getFragmentFolder(type: string): string {
  return FOLDER_BY_TYPE[type] ?? 'Fragments'
}

function getOrderPrefix(fragment: Fragment): string {
  if (fragment.type !== 'prose' && fragment.type !== 'marker') return ''
  return `${String(Math.max(0, fragment.order ?? 0)).padStart(4, '0')}-`
}

function getFragmentFileName(fragment: Fragment): string {
  return `${getOrderPrefix(fragment)}${fragment.id}.md`
}

function serializeFrontmatter(attributes: Record<string, unknown>, body: string): string {
  const lines = Object.entries(attributes).map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
  const normalizedBody = body.replace(/\r\n/g, '\n')
  return `---\n${lines.join('\n')}\n---\n${normalizedBody}`
}

function parseFrontmatter(raw: string): { attributes: Record<string, unknown>; body: string } {
  const normalized = raw.replace(/\r\n/g, '\n')
  if (!normalized.startsWith('---\n')) {
    return { attributes: {}, body: normalized }
  }

  const closingIndex = normalized.indexOf('\n---\n', 4)
  if (closingIndex === -1) {
    return { attributes: {}, body: normalized }
  }

  const header = normalized.slice(4, closingIndex)
  const body = normalized.slice(closingIndex + 5)
  const attributes: Record<string, unknown> = {}

  for (const line of header.split('\n')) {
    if (!line.trim()) continue
    const separator = line.indexOf(':')
    if (separator === -1) continue
    const key = line.slice(0, separator).trim()
    const valueText = line.slice(separator + 1).trim()
    if (!key) continue
    try {
      attributes[key] = JSON.parse(valueText)
    } catch {
      attributes[key] = valueText
    }
  }

  return { attributes, body }
}

function serializeStoryMeta(story: StoryMeta): string {
  return serializeFrontmatter(
    {
      id: story.id,
      name: story.name,
      coverImage: story.coverImage,
      summary: story.summary,
      createdAt: story.createdAt,
      updatedAt: story.updatedAt,
    },
    story.description,
  )
}

function serializeFragment(fragment: Fragment): string {
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

function fragmentFromMarkdown(attributes: Record<string, unknown>, body: string): Fragment | null {
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

export async function ensureMarkdownStoryLayout(dataDir: string, storyId: string): Promise<void> {
  const root = getMarkdownStoryRoot(dataDir, storyId)
  await mkdir(root, { recursive: true })
  await Promise.all(STORY_DIRS.map((dirName) => mkdir(join(root, dirName), { recursive: true })))
  const compiledPath = getCompiledStoryPath(dataDir, storyId)
  if (!existsSync(compiledPath)) {
    await writeFile(compiledPath, '', 'utf-8')
  }
}

export async function syncStoryMarkdownMeta(dataDir: string, story: StoryMeta): Promise<void> {
  await ensureMarkdownStoryLayout(dataDir, story.id)
  await writeFile(getStoryMetaPath(dataDir, story.id), serializeStoryMeta(story), 'utf-8')
}

async function listMarkdownFragmentPaths(dataDir: string, storyId: string, fragmentId: string): Promise<string[]> {
  const root = getMarkdownStoryRoot(dataDir, storyId)
  const matches: string[] = []

  for (const folder of STORY_DIRS) {
    const folderPath = join(root, folder)
    if (!existsSync(folderPath)) continue
    const entries = await readdir(folderPath)
    for (const entry of entries) {
      if (!entry.endsWith('.md')) continue
      if (!entry.includes(fragmentId)) continue
      matches.push(join(folderPath, entry))
    }
  }

  return matches
}

export async function syncFragmentMarkdown(dataDir: string, storyId: string, fragment: Fragment): Promise<void> {
  await ensureMarkdownStoryLayout(dataDir, storyId)

  const folderPath = join(getMarkdownStoryRoot(dataDir, storyId), getFragmentFolder(fragment.type))
  const nextPath = join(folderPath, getFragmentFileName(fragment))
  const existingPaths = await listMarkdownFragmentPaths(dataDir, storyId, fragment.id)

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
}

export async function loadMarkdownFragmentById(dataDir: string, storyId: string, fragmentId: string): Promise<Fragment | null> {
  const paths = await listMarkdownFragmentPaths(dataDir, storyId, fragmentId)
  const path = paths[0]
  if (!path || !existsSync(path)) return null
  const raw = await readFile(path, 'utf-8')
  const parsed = parseFrontmatter(raw)
  return fragmentFromMarkdown(parsed.attributes, parsed.body)
}

async function readCurrentProseChain(dataDir: string, storyId: string): Promise<ProseChain | null> {
  const root = await getContentRoot(dataDir, storyId)
  const chainPath = join(root, 'prose-chain.json')
  if (!existsSync(chainPath)) return null
  const raw = await readFile(chainPath, 'utf-8')
  return JSON.parse(raw) as ProseChain
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
