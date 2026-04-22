import { join } from 'node:path'
import { zipSync, unzipSync } from 'fflate'
import { generateFragmentId } from '@/lib/fragment-ids'
import { createStory, getStory } from './fragments/storage'
import { saveProseChain } from './fragments/prose-chain'
import { saveAssociations } from './fragments/associations'
import { getBranchesIndex, getContentRoot } from './fragments/branches'
import type { StoryMeta, Fragment, Associations, ProseChain, BranchesIndex } from './fragments/schema'
import { parseFrontmatter } from './md-files/frontmatter'
import { storyMetaFromMarkdown } from './md-files/story-meta'
import {
  getStoryDir,
  getStoryInternalDir,
} from './storage/paths'
import { getStorageBackend } from './storage/runtime'

export interface ExportResult {
  buffer: Uint8Array
  filename: string
}

// --- Export ---

export async function exportStoryAsZip(
  dataDir: string,
  storyId: string,
): Promise<ExportResult> {
  const storage = getStorageBackend()
  const storyDir = getStoryDir(dataDir, storyId)
  const story = await getStory(dataDir, storyId)
  if (!story) {
    throw new Error(`Story not found: ${storyId}`)
  }

  const zipRoot = 'errata-story-export'
  const files = Object.fromEntries(
    Object.entries(await storage.readTree(storyDir)).map(([relativePath, content]) => [
      `${zipRoot}/${relativePath}`,
      content,
    ] as const),
  )

  // Ensure branches.json reflects migrated state
  const branchesIndex = await getBranchesIndex(dataDir, storyId)
  files[`${zipRoot}/branches.json`] = new TextEncoder().encode(
    JSON.stringify(branchesIndex, null, 2),
  )

  const buffer = zipSync(files)

  // Read meta for filename
  let storyName = storyId
  if (story) {
    storyName = story.name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 50)
  }

  return {
    buffer,
    filename: `errata-${storyName}.zip`,
  }
}

// --- Import ---

export async function importStoryFromZip(
  dataDir: string,
  zipBuffer: Uint8Array,
): Promise<StoryMeta> {
  const extracted = unzipSync(zipBuffer)

  const paths = Object.keys(extracted)
  const decoder = new TextDecoder()

  const originalMeta = readStoryMetaFromArchive(paths, extracted, decoder)

  // Generate new story ID
  const newStoryId = `story-${Date.now().toString(36)}`
  const now = new Date().toISOString()

  // Detect format: new (has branches.json at root) or legacy (root-level content)
  const branchesKey = paths.find(
    (p) => p.endsWith('branches.json') && !p.includes('fragments/') && !p.includes('/branches/'),
  )
  const hasBranchedContent = paths.some((path) => path.includes('/branches/'))
  const hasMarkdownStoryTree = paths.some((path) =>
    path.includes('/Characters/')
    || path.includes('/Guidelines/')
    || path.includes('/Lorebook/')
    || path.includes('/Prose/')
    || path.endsWith('/story.md')
    || path.includes('/.errata/fragment-internals.json'),
  )

  const importMode = branchesKey && hasBranchedContent
    ? 'branched'
    : hasMarkdownStoryTree
      ? 'markdown'
      : null
  if (!importMode) {
    throw new Error('Invalid archive: only current Errata story archives are supported')
  }

  // Build new story meta
  const newMeta: StoryMeta = {
    ...originalMeta,
    id: newStoryId,
    name: originalMeta.name + ' (imported)',
    createdAt: now,
    updatedAt: now,
    settings: {
      ...originalMeta.settings,
      providerId: null,
      modelId: null,
    },
  }

  // Create story (sets up branches/main/ + branches.json)
  await createStory(dataDir, newMeta)

  if (importMode === 'branched') {
    await importNewFormat(dataDir, newStoryId, extracted, decoder, branchesKey)
  } else {
    await importMarkdownStoryFormat(dataDir, newStoryId, extracted, paths)
  }

  return newMeta
}

async function importMarkdownStoryFormat(
  dataDir: string,
  storyId: string,
  extracted: Record<string, Uint8Array>,
  paths: string[],
): Promise<void> {
  const storage = getStorageBackend()
  const root = await getContentRoot(dataDir, storyId)
  const rootPrefix = getArchiveRootPrefix(paths)

  for (const [path, content] of Object.entries(extracted)) {
    if (rootPrefix && !path.startsWith(rootPrefix)) continue

    const relativePath = rootPrefix ? path.slice(rootPrefix.length) : path
    if (!relativePath || relativePath === 'branches.json' || relativePath === '.errata/_story.md') continue

    await storage.writeBytes(join(root, relativePath), content)
  }
}

// --- New format import (with branches/) ---

async function importNewFormat(
  dataDir: string,
  storyId: string,
  extracted: Record<string, Uint8Array>,
  decoder: TextDecoder,
  branchesKey: string,
): Promise<void> {
  const storage = getStorageBackend()
  const storyDir = getStoryDir(dataDir, storyId)

  // Read branches.json from archive
  const branchesIndex = JSON.parse(decoder.decode(extracted[branchesKey])) as BranchesIndex

  // Collect ALL fragment IDs across all branches for consistent remapping
  const idMap = new Map<string, string>()
  for (const [path, content] of Object.entries(extracted)) {
    if (!path.includes('/branches/') || !path.includes('/fragments/') || !path.endsWith('.json')) continue
    const fragment = JSON.parse(decoder.decode(content)) as Fragment
    if (!idMap.has(fragment.id)) {
      idMap.set(fragment.id, generateFragmentId(fragment.type))
    }
  }

  // Write branches.json (overwrite the default one from createStory)
  await storage.writeJson(join(storyDir, 'branches.json'), branchesIndex)

  // Write each branch
  for (const branch of branchesIndex.branches) {
    const branchPrefix = findBranchPrefix(Object.keys(extracted), branch.id)
    if (!branchPrefix) continue

    const bDir = join(storyDir, 'branches', branch.id)
    await storage.ensureDir(bDir)
    await storage.ensureDir(join(bDir, 'fragments'))

    // Track handled paths so we can copy remaining files verbatim
    const handled = new Set<string>()

    // Fragments (need ID remapping)
    await writeBranchFragments(extracted, decoder, branchPrefix, bDir, idMap, handled)

    // Prose chain (need ID remapping)
    await writeBranchProseChain(extracted, decoder, branchPrefix, bDir, idMap, handled)

    // Associations (need ID remapping)
    await writeBranchAssociations(extracted, decoder, branchPrefix, bDir, idMap, handled)

    // Generation logs (need fragmentId remapping)
    await writeBranchGenerationLogs(extracted, decoder, branchPrefix, bDir, idMap, handled)

    // Copy all remaining branch files verbatim (block-config, agent-blocks, librarian, etc.)
    await copyRemainingBranchFiles(extracted, branchPrefix, bDir, handled)
  }
}

function readStoryMetaFromArchive(
  paths: string[],
  extracted: Record<string, Uint8Array>,
  decoder: TextDecoder,
): StoryMeta {
  const legacyMetaKey = paths.find((p) => p.endsWith('meta.json') && !p.includes('fragments/') && !p.includes('branches/'))
  if (legacyMetaKey) {
    throw new Error('Invalid archive: only current Errata story archives are supported')
  }

  const storyMetaKey = paths.find((p) => {
    if (p.includes('/branches/')) return false
    return p.endsWith('/.errata/_story.md') || p.endsWith('/_story.md')
  })
  if (!storyMetaKey) {
    throw new Error('Invalid archive: missing story metadata')
  }

  const parsed = parseFrontmatter(decoder.decode(extracted[storyMetaKey]))
  const story = storyMetaFromMarkdown(parsed.attributes, parsed.body)
  if (!story) {
    throw new Error('Invalid archive: could not parse story metadata')
  }
  return story
}

function getArchiveRootPrefix(paths: string[]): string {
  const firstPath = paths[0]
  if (!firstPath) return ''

  const firstSeparator = firstPath.indexOf('/')
  return firstSeparator === -1 ? '' : firstPath.slice(0, firstSeparator + 1)
}

// --- Branch content helpers ---

function findBranchPrefix(paths: string[], branchId: string): string | null {
  for (const p of paths) {
    const marker = `/branches/${branchId}/`
    const idx = p.indexOf(marker)
    if (idx !== -1) return p.substring(0, idx + marker.length - 1)
  }
  return null
}

async function writeBranchFragments(
  extracted: Record<string, Uint8Array>,
  decoder: TextDecoder,
  branchPrefix: string,
  bDir: string,
  idMap: Map<string, string>,
  handled: Set<string>,
): Promise<void> {
  const storage = getStorageBackend()
  const fragPrefix = branchPrefix + '/fragments/'
  for (const [path, content] of Object.entries(extracted)) {
    if (!path.startsWith(fragPrefix) || !path.endsWith('.json')) continue
    handled.add(path)
    const fragment = JSON.parse(decoder.decode(content)) as Fragment
    const newId = idMap.get(fragment.id) ?? fragment.id
    const remapped: Fragment = {
      ...fragment,
      id: newId,
      refs: fragment.refs.map((ref) => idMap.get(ref) ?? ref),
      meta: remapMeta(fragment.meta, idMap),
    }
    await storage.writeJson(
      join(bDir, 'fragments', `${newId}.json`),
      remapped,
    )
  }
}

async function writeBranchProseChain(
  extracted: Record<string, Uint8Array>,
  decoder: TextDecoder,
  branchPrefix: string,
  bDir: string,
  idMap: Map<string, string>,
  handled: Set<string>,
): Promise<void> {
  const storage = getStorageBackend()
  const key = `${branchPrefix}/prose-chain.json`
  if (!extracted[key]) return
  handled.add(key)
  const chain = JSON.parse(decoder.decode(extracted[key])) as ProseChain
  const remapped: ProseChain = {
    entries: chain.entries.map((entry) => ({
      proseFragments: entry.proseFragments.map((id) => idMap.get(id) ?? id),
      active: idMap.get(entry.active) ?? entry.active,
    })),
  }
  await storage.writeJson(join(bDir, 'prose-chain.json'), remapped)
}

async function writeBranchAssociations(
  extracted: Record<string, Uint8Array>,
  decoder: TextDecoder,
  branchPrefix: string,
  bDir: string,
  idMap: Map<string, string>,
  handled: Set<string>,
): Promise<void> {
  const storage = getStorageBackend()
  const key = `${branchPrefix}/associations.json`
  if (!extracted[key]) return
  handled.add(key)
  const assoc = JSON.parse(decoder.decode(extracted[key])) as Associations
  const remapped = remapAssociations(assoc, idMap)
  await storage.writeJson(join(bDir, 'associations.json'), remapped)
}

async function writeBranchGenerationLogs(
  extracted: Record<string, Uint8Array>,
  decoder: TextDecoder,
  branchPrefix: string,
  bDir: string,
  idMap: Map<string, string>,
  handled: Set<string>,
): Promise<void> {
  const storage = getStorageBackend()
  const prefix = `${branchPrefix}/generation-logs/`
  for (const [path, content] of Object.entries(extracted)) {
    if (!path.startsWith(prefix) || !path.endsWith('.json')) continue
    handled.add(path)
    const logData = JSON.parse(decoder.decode(content))
    if (logData.fragmentId && idMap.has(logData.fragmentId)) {
      logData.fragmentId = idMap.get(logData.fragmentId)
    }
    const logsDir = join(bDir, 'generation-logs')
    await storage.ensureDir(logsDir)
    const filename = path.split('/').pop()!
    await storage.writeJson(join(logsDir, filename), logData)
  }
}

/** Copy all branch files that weren't handled by the specific importers above. */
async function copyRemainingBranchFiles(
  extracted: Record<string, Uint8Array>,
  branchPrefix: string,
  bDir: string,
  handled: Set<string>,
): Promise<void> {
  const storage = getStorageBackend()
  const prefix = branchPrefix + '/'
  for (const [path, content] of Object.entries(extracted)) {
    if (!path.startsWith(prefix) || handled.has(path)) continue
    const relativePath = path.slice(prefix.length)
    const targetPath = join(bDir, relativePath)
    await storage.writeBytes(targetPath, content)
  }
}

// --- ID remapping helpers ---

function remapMeta(
  meta: Record<string, unknown>,
  idMap: Map<string, string>,
): Record<string, unknown> {
  const result = { ...meta }

  // Remap visualRefs[].fragmentId
  if (Array.isArray(result.visualRefs)) {
    result.visualRefs = (result.visualRefs as Array<Record<string, unknown>>).map((ref) => ({
      ...ref,
      fragmentId: idMap.get(ref.fragmentId as string) ?? ref.fragmentId,
    }))
  }

  // Remap previousFragmentId
  if (typeof result.previousFragmentId === 'string' && idMap.has(result.previousFragmentId)) {
    result.previousFragmentId = idMap.get(result.previousFragmentId)
  }

  // Remap variationOf
  if (typeof result.variationOf === 'string' && idMap.has(result.variationOf)) {
    result.variationOf = idMap.get(result.variationOf)
  }

  return result
}

function remapAssociations(
  assoc: Associations,
  idMap: Map<string, string>,
): Associations {
  const newTagIndex: Record<string, string[]> = {}
  for (const [tag, ids] of Object.entries(assoc.tagIndex)) {
    newTagIndex[tag] = ids.map((id) => idMap.get(id) ?? id)
  }

  const newRefIndex: Record<string, string[]> = {}
  for (const [key, ids] of Object.entries(assoc.refIndex)) {
    let newKey = key
    // Remap __backref: keys
    if (key.startsWith('__backref:')) {
      const oldId = key.slice('__backref:'.length)
      const newId = idMap.get(oldId) ?? oldId
      newKey = `__backref:${newId}`
    } else if (idMap.has(key)) {
      newKey = idMap.get(key)!
    }
    newRefIndex[newKey] = ids.map((id) => idMap.get(id) ?? id)
  }

  return { tagIndex: newTagIndex, refIndex: newRefIndex }
}
