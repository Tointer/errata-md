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
import {
  collectDirectoryFiles,
  ensureArchiveDir,
  writeArchiveBytes,
  writeArchiveJson,
} from './story-archive-files'

export interface ExportResult {
  buffer: Uint8Array
  filename: string
}

// --- Export ---

export async function exportStoryAsZip(
  dataDir: string,
  storyId: string,
): Promise<ExportResult> {
  const storyDir = getStoryDir(dataDir, storyId)
  const story = await getStory(dataDir, storyId)
  if (!story) {
    throw new Error(`Story not found: ${storyId}`)
  }

  const zipRoot = 'errata-story-export'
  const files = await collectDirectoryFiles(storyDir, zipRoot)

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

  if (branchesKey && hasBranchedContent) {
    await importNewFormat(dataDir, newStoryId, extracted, decoder, branchesKey)
  } else if (hasMarkdownStoryTree) {
    await importMarkdownStoryFormat(dataDir, newStoryId, extracted, paths)
  } else {
    await importLegacyFormat(dataDir, newStoryId, extracted, paths, decoder)
  }

  return newMeta
}

async function importMarkdownStoryFormat(
  dataDir: string,
  storyId: string,
  extracted: Record<string, Uint8Array>,
  paths: string[],
): Promise<void> {
  const root = await getContentRoot(dataDir, storyId)
  const rootPrefix = getArchiveRootPrefix(paths)

  for (const [path, content] of Object.entries(extracted)) {
    if (rootPrefix && !path.startsWith(rootPrefix)) continue

    const relativePath = rootPrefix ? path.slice(rootPrefix.length) : path
    if (!relativePath || relativePath === 'branches.json' || relativePath === '.errata/_story.md') continue

    await writeArchiveBytes(join(root, relativePath), content)
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
  await writeArchiveJson(join(storyDir, 'branches.json'), branchesIndex)

  // Write each branch
  for (const branch of branchesIndex.branches) {
    const branchPrefix = findBranchPrefix(Object.keys(extracted), branch.id)
    if (!branchPrefix) continue

    const bDir = join(storyDir, 'branches', branch.id)
    await ensureArchiveDir(bDir)
    await ensureArchiveDir(join(bDir, 'fragments'))

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

// --- Legacy format import (root-level content) ---

async function importLegacyFormat(
  dataDir: string,
  storyId: string,
  extracted: Record<string, Uint8Array>,
  paths: string[],
  decoder: TextDecoder,
): Promise<void> {
  // Collect fragment IDs and build remap
  const idMap = new Map<string, string>()
  const fragmentFiles: Array<{ data: Fragment }> = []

  for (const [path, content] of Object.entries(extracted)) {
    if (!path.includes('fragments/') || !path.endsWith('.json')) continue
    if (path.includes('/branches/')) continue
    const fragment = JSON.parse(decoder.decode(content)) as Fragment
    const newId = generateFragmentId(fragment.type)
    idMap.set(fragment.id, newId)
    fragmentFiles.push({ data: fragment })
  }

  // Remap fragments
  const remappedFragments: Fragment[] = fragmentFiles.map(({ data }) => {
    const newId = idMap.get(data.id)!
    return {
      ...data,
      id: newId,
      refs: data.refs.map((ref) => idMap.get(ref) ?? ref),
      meta: remapMeta(data.meta, idMap),
    }
  })

  // Write fragments to the active branch (main)
  const root = await getContentRoot(dataDir, storyId)
  const internalRoot = getStoryInternalDir(dataDir, storyId)
  const fragmentsDir = join(internalRoot, 'fragments')
  await ensureArchiveDir(fragmentsDir)
  for (const fragment of remappedFragments) {
    await writeArchiveJson(
      join(fragmentsDir, `${fragment.id}.json`),
      fragment,
    )
  }

  // Prose chain
  const proseChainKey = paths.find((p) => p.endsWith('prose-chain.json') && !p.includes('fragments/') && !p.includes('branches/'))
  if (proseChainKey) {
    const proseChain = JSON.parse(decoder.decode(extracted[proseChainKey])) as ProseChain
    const remappedProseChain: ProseChain = {
      entries: proseChain.entries.map((entry) => ({
        proseFragments: entry.proseFragments.map((id) => idMap.get(id) ?? id),
        active: idMap.get(entry.active) ?? entry.active,
      })),
    }
    await saveProseChain(dataDir, storyId, remappedProseChain)
  }

  // Associations
  const assocKey = paths.find((p) => p.endsWith('associations.json') && !p.includes('fragments/') && !p.includes('branches/'))
  if (assocKey) {
    const assoc = JSON.parse(decoder.decode(extracted[assocKey])) as Associations
    await saveAssociations(dataDir, storyId, remapAssociations(assoc, idMap))
  }

  // Generation logs (remap fragmentId)
  const handledLegacy = new Set<string>()
  for (const [path, content] of Object.entries(extracted)) {
    if (!path.includes('generation-logs/') || !path.endsWith('.json')) continue
    if (path.includes('/branches/')) continue
    handledLegacy.add(path)
    const logsDir = join(internalRoot, 'generation-logs')
    await ensureArchiveDir(logsDir)
    const filename = path.split('/').pop()!
    const logData = JSON.parse(decoder.decode(content))
    if (logData.fragmentId && idMap.has(logData.fragmentId)) {
      logData.fragmentId = idMap.get(logData.fragmentId)
    }
    await writeArchiveJson(join(logsDir, filename), logData)
  }

  // Copy all remaining files verbatim (librarian, agent-blocks, block-config, etc.)
  // Find the export root prefix (e.g. "errata-story-export/")
  const rootPrefix = paths.find(p => p.endsWith('meta.json'))?.replace('meta.json', '') ?? ''
  for (const [path, content] of Object.entries(extracted)) {
    if (path.includes('/branches/')) continue
    if (!path.startsWith(rootPrefix)) continue
    const relativePath = path.slice(rootPrefix.length)
    // Skip files already handled above
    if (relativePath === 'meta.json' || relativePath === 'branches.json') continue
    if (relativePath.startsWith('fragments/')) continue
    if (relativePath === 'prose-chain.json' || relativePath === 'associations.json') continue
    if (handledLegacy.has(path)) continue
    const targetPath = join(root, normalizeLegacyStoryRelativePath(relativePath))
    await writeArchiveBytes(targetPath, content)
  }
}

function readStoryMetaFromArchive(
  paths: string[],
  extracted: Record<string, Uint8Array>,
  decoder: TextDecoder,
): StoryMeta {
  const metaKey = paths.find((p) => p.endsWith('meta.json') && !p.includes('fragments/') && !p.includes('branches/'))
  if (metaKey) {
    return JSON.parse(decoder.decode(extracted[metaKey])) as StoryMeta
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

function normalizeLegacyStoryRelativePath(relativePath: string): string {
  if (
    relativePath === '_story.md'
    || relativePath === 'block-config.json'
    || relativePath === 'token-usage.json'
    || relativePath.startsWith('agent-blocks/')
    || relativePath.startsWith('character-chat/')
    || relativePath.startsWith('Fragments/')
    || relativePath.startsWith('Icons/')
    || relativePath.startsWith('Images/')
    || relativePath.startsWith('Markers/')
    || relativePath.startsWith('librarian/')
  ) {
    return join('.errata', relativePath)
  }

  return relativePath
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
    await writeArchiveJson(
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
  await writeArchiveJson(join(bDir, 'prose-chain.json'), remapped)
}

async function writeBranchAssociations(
  extracted: Record<string, Uint8Array>,
  decoder: TextDecoder,
  branchPrefix: string,
  bDir: string,
  idMap: Map<string, string>,
  handled: Set<string>,
): Promise<void> {
  const key = `${branchPrefix}/associations.json`
  if (!extracted[key]) return
  handled.add(key)
  const assoc = JSON.parse(decoder.decode(extracted[key])) as Associations
  const remapped = remapAssociations(assoc, idMap)
  await writeArchiveJson(join(bDir, 'associations.json'), remapped)
}

async function writeBranchGenerationLogs(
  extracted: Record<string, Uint8Array>,
  decoder: TextDecoder,
  branchPrefix: string,
  bDir: string,
  idMap: Map<string, string>,
  handled: Set<string>,
): Promise<void> {
  const prefix = `${branchPrefix}/generation-logs/`
  for (const [path, content] of Object.entries(extracted)) {
    if (!path.startsWith(prefix) || !path.endsWith('.json')) continue
    handled.add(path)
    const logData = JSON.parse(decoder.decode(content))
    if (logData.fragmentId && idMap.has(logData.fragmentId)) {
      logData.fragmentId = idMap.get(logData.fragmentId)
    }
    const logsDir = join(bDir, 'generation-logs')
    await ensureArchiveDir(logsDir)
    const filename = path.split('/').pop()!
    await writeArchiveJson(join(logsDir, filename), logData)
  }
}

/** Copy all branch files that weren't handled by the specific importers above. */
async function copyRemainingBranchFiles(
  extracted: Record<string, Uint8Array>,
  branchPrefix: string,
  bDir: string,
  handled: Set<string>,
): Promise<void> {
  const prefix = branchPrefix + '/'
  for (const [path, content] of Object.entries(extracted)) {
    if (!path.startsWith(prefix) || handled.has(path)) continue
    const relativePath = path.slice(prefix.length)
    const targetPath = join(bDir, relativePath)
    await writeArchiveBytes(targetPath, content)
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
