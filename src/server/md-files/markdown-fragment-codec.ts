import type { Fragment } from '@/server/fragments/schema'
import { getFrozenSections, type FrozenSection } from '../fragments/protection'
import { registry } from '../fragments/registry'
import { serializeFrontmatter } from './frontmatter'
import { getFilenameDerivedFragmentId, isVisibleFilenameDerivedType } from './paths'
import { splitProseInternalMeta } from './prose-metadata'
import { resolveFragmentTimestamps, type FragmentInternalRecord } from './fragment-internals'

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

export function serializeFragment(fragment: Fragment): string {
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

export function fragmentFromLegacyMarkdown(
  attributes: Record<string, unknown>,
  body: string,
  internalRecord?: FragmentInternalRecord,
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

export function visibleFragmentFromMarkdown(
  type: string,
  fileName: string,
  attributes: Record<string, unknown>,
  body: string,
  internalRecord?: FragmentInternalRecord,
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