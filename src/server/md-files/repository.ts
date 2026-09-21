import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import type { Fragment, ProseChain, StoryMeta } from '@/server/fragments/schema'
import { getProseChain } from '../fragments/prose-chain'
import * as storyLayout from '../storage/story-layout'
import * as fragmentLayout from './fragment-layout'
import * as fragmentLocator from './fragment-locator'
import {
  archiveMarkdownFragmentFile,
  deleteMarkdownFragmentFiles,
  restoreMarkdownFragmentFile,
  writeMarkdownFragmentFile,
} from './markdown-fragment-files.ts'
import { parseFrontmatter } from './frontmatter'
import * as markdownFragmentCodec from './markdown-fragment-codec'
import { proseFragmentFromMarkdown } from './prose-metadata'
import * as fragmentInternals from '../storage/stores/fragment-internals'
import * as storyMeta from './story-meta'
import { createLogger } from '../logging/logger'
import { readTextIfExists, writeTextAtomic } from '../fs-utils'

const repositoryLogger = createLogger('md-repository')

function sortFragments(fragments: Fragment[]): Fragment[] {
  return fragments.sort((left, right) => {
    if (left.order !== right.order) return left.order - right.order
    return left.id.localeCompare(right.id)
  })
}

function buildFragmentFromEntry(
  record: fragmentLocator.MarkdownFragmentEntry,
  parsed: { attributes: Record<string, unknown>; body: string },
  internalIndex: Awaited<ReturnType<typeof fragmentInternals.readFragmentInternalIndex>>,
): Fragment | null {
  const visibleType = fragmentLayout.getTypeForVisibleFolder(record.folder)
  const proseId = record.folder === 'Prose'
    ? fragmentLayout.getProseFragmentIdFromFileName(record.entry)
    : undefined
  const visibleId = visibleType && fragmentLayout.isVisibleFilenameDerivedType(visibleType)
    ? fragmentLayout.getFilenameDerivedFragmentId(visibleType, record.entry)
    : undefined
  const explicitId = typeof parsed.attributes.id === 'string' ? parsed.attributes.id : undefined

  if (proseId) {
    const internalRecord = internalIndex[proseId]
    const fragment = proseFragmentFromMarkdown(
      proseId,
      parsed.attributes,
      parsed.body,
      internalRecord?.prose,
      fragmentInternals.resolveFragmentTimestamps(parsed.attributes, internalRecord),
      (attributes, body) => markdownFragmentCodec.fragmentFromExplicitMarkdown(attributes, body, internalRecord),
    )
    return {
      ...fragment,
      version: internalRecord?.version ?? fragment.version ?? 1,
      versions: internalRecord?.versions ?? fragment.versions ?? [],
    }
  }

  if (visibleType && fragmentLayout.isVisibleFilenameDerivedType(visibleType)) {
    return markdownFragmentCodec.visibleFragmentFromMarkdown(
      visibleType,
      record.entry,
      parsed.attributes,
      parsed.body,
      internalIndex[explicitId ?? visibleId ?? ''],
    )
  }

  return markdownFragmentCodec.fragmentFromExplicitMarkdown(parsed.attributes, parsed.body, explicitId ? internalIndex[explicitId] : undefined)
}

async function readFragmentFromEntry(
  record: fragmentLocator.MarkdownFragmentEntry,
  internalIndex: Awaited<ReturnType<typeof fragmentInternals.readFragmentInternalIndex>>,
): Promise<Fragment | null> {
  const raw = await readTextIfExists(record.path)
  if (!raw) return null

  return buildFragmentFromEntry(record, parseFrontmatter(raw), internalIndex)
}

async function loadFragmentsFromFolders(
  dataDir: string,
  storyId: string,
  folders: string[],
  internalIndex: Awaited<ReturnType<typeof fragmentInternals.readFragmentInternalIndex>>,
  options: {
    includeArchived?: boolean
    onlyArchived?: boolean
    type?: string
    logInvalid?: boolean
  },
): Promise<Fragment[]> {
  const root = storyLayout.getStoryDir(dataDir, storyId)
  const fragments: Fragment[] = []
  const storyLogger = repositoryLogger.child({ storyId, extra: options.type ? { type: options.type } : undefined })

  for (const folder of folders) {
    const entries = await fragmentLocator.listFolderEntries(join(root, folder), folder, options)
    for (const record of entries) {
      const fragment = await readFragmentFromEntry(record, internalIndex)
      if (!fragment) {
        if (options.logInvalid) {
          storyLogger.warn('Skipped invalid markdown fragment', {
            folder,
            path: record.path,
            entry: record.entry,
          })
        }
        continue
      }
      if (options.type && fragment.type !== options.type) continue
      fragments.push(fragment)
    }
  }

  return sortFragments(fragments)
}

export async function ensureMarkdownStoryLayout(dataDir: string, storyId: string): Promise<void> {
  const root = storyLayout.getStoryDir(dataDir, storyId)
  await mkdir(root, { recursive: true })
  await Promise.all([
    ...fragmentLayout.STORY_DIRS.map((dirName) => mkdir(join(root, dirName), { recursive: true })),
    ...fragmentLayout.INTERNAL_MARKDOWN_DIRS.map((dirName) => mkdir(join(root, dirName), { recursive: true })),
    mkdir(storyLayout.getStoryInternalDir(dataDir, storyId), { recursive: true }),
  ])
  const compiledPath = storyLayout.getCompiledStoryPath(dataDir, storyId)
  if (!existsSync(compiledPath)) {
    await writeTextAtomic(compiledPath, '')
  }
}

export async function syncStoryMarkdownMeta(dataDir: string, story: StoryMeta): Promise<void> {
  await ensureMarkdownStoryLayout(dataDir, story.id)
  await writeTextAtomic(storyLayout.getStoryMetaPath(dataDir, story.id), storyMeta.serializeStoryMeta(story))
}

export async function loadMarkdownStoryMeta(dataDir: string, storyId: string): Promise<StoryMeta | null> {
  const path = storyLayout.getStoryMetaPath(dataDir, storyId)
  const raw = await readTextIfExists(path)
  if (!raw) return null
  const parsed = parseFrontmatter(raw)
  return storyMeta.storyMetaFromMarkdown(parsed.attributes, parsed.body)
}

function findProseSectionIndex(chain: ProseChain | null, fragmentId: string): number | undefined {
  if (!chain) return undefined
  const index = chain.entries.findIndex((entry) => entry.proseFragments.includes(fragmentId))
  return index === -1 ? undefined : index
}

export async function syncFragmentMarkdown(dataDir: string, storyId: string, fragment: Fragment): Promise<void> {
  await ensureMarkdownStoryLayout(dataDir, storyId)
  await fragmentInternals.upsertFragmentInternalRecord(dataDir, storyId, fragment)

  const chain = fragment.type === 'prose' || fragment.type === 'marker'
    ? await getProseChain(dataDir, storyId)
    : null
  await writeMarkdownFragmentFile(
    dataDir,
    storyId,
    fragment.id,
    fragmentLayout.getFragmentFolder(fragment.type),
    fragmentLayout.getFragmentFileName(fragment, findProseSectionIndex(chain, fragment.id)),
    markdownFragmentCodec.serializeFragment(fragment),
  )
}

export async function deleteFragmentMarkdown(dataDir: string, storyId: string, fragmentId: string): Promise<void> {
  await deleteMarkdownFragmentFiles(dataDir, storyId, fragmentId)
  await fragmentInternals.removeFragmentInternalRecord(dataDir, storyId, fragmentId)
}

export async function loadMarkdownFragmentById(dataDir: string, storyId: string, fragmentId: string): Promise<Fragment | null> {
  const matches = await fragmentLocator.findMarkdownFragmentEntry(dataDir, storyId, fragmentId, { includeArchived: true })
  const match = matches[0]
  if (!match) return null

  const internalIndex = await fragmentInternals.readFragmentInternalIndex(dataDir, storyId)
  const fragment = await readFragmentFromEntry(match, internalIndex)
  return fragment ? { ...fragment, archived: match.archived } : null
}

export async function listMarkdownFragments(
  dataDir: string,
  storyId: string,
  type?: string,
): Promise<Fragment[]> {
  const root = storyLayout.getStoryDir(dataDir, storyId)
  if (!existsSync(root)) return []

  const folders = type ? [fragmentLayout.getFragmentFolder(type)] : [...fragmentLayout.MARKDOWN_FRAGMENT_DIRS]
  const internalIndex = await fragmentInternals.readFragmentInternalIndex(dataDir, storyId)

  return loadFragmentsFromFolders(dataDir, storyId, folders, internalIndex, {
    includeArchived: false,
    type,
    logInvalid: true,
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
  await writeTextAtomic(storyLayout.getCompiledStoryPath(dataDir, storyId), compiled ? `${compiled}\n` : '')
}

export async function syncCompiledStoryFromCurrentChain(dataDir: string, storyId: string): Promise<void> {
  const chain = await getProseChain(dataDir, storyId)
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
  const chain = await getProseChain(dataDir, storyId)
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
  const match = (await fragmentLocator.findMarkdownFragmentEntry(dataDir, storyId, fragmentId, { includeArchived: true }))[0]
  return Boolean(match?.archived)
}

export async function listArchivedMarkdownFragments(
  dataDir: string,
  storyId: string,
  type?: string,
): Promise<Fragment[]> {
  const root = storyLayout.getStoryDir(dataDir, storyId)
  if (!existsSync(root)) return []

  const folders = type ? [fragmentLayout.getFragmentFolder(type)] : [...fragmentLayout.MARKDOWN_FRAGMENT_DIRS]
  const internalIndex = await fragmentInternals.readFragmentInternalIndex(dataDir, storyId)

  return loadFragmentsFromFolders(dataDir, storyId, folders, internalIndex, {
    includeArchived: true,
    onlyArchived: true,
    type,
  })
}

export async function archiveFragmentMarkdown(dataDir: string, storyId: string, fragmentId: string): Promise<boolean> {
  return archiveMarkdownFragmentFile(dataDir, storyId, fragmentId)
}

export async function restoreFragmentMarkdown(dataDir: string, storyId: string, fragmentId: string): Promise<boolean> {
  return restoreMarkdownFragmentFile(dataDir, storyId, fragmentId)
}
