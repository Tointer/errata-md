import type { Fragment } from '@/server/fragments/schema'
import { getFrozenSections, type FrozenSection } from '../fragments/protection'
import { registry } from '../fragments/registry'
import { normalizeLineEndings, serializeFrontmatter } from './frontmatter'
import { getFilenameDerivedFragmentId, isVisibleFilenameDerivedType } from './fragment-layout'
import { splitProseInternalMeta } from './prose-metadata'
import { resolveFragmentTimestamps, type FragmentInternalRecord } from '../storage/stores/fragment-internals'
import { deriveFragmentIdFromName } from '@/lib/fragment-ids'

const MARKDOWN_EDITABLE_DELIMITER = '<!-- editable -->'
const MARKDOWN_LEADING_FROZEN_SECTION_ID = 'fs-md-leading'

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

function readRawMeta(attributes: Record<string, unknown>): Record<string, unknown> {
  return typeof attributes.meta === 'object' && attributes.meta !== null
    ? attributes.meta as Record<string, unknown>
    : {}
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : []
}

function buildFragmentFromParsedMarkdown(
  id: string,
  type: string,
  name: string,
  attributes: Record<string, unknown>,
  body: string,
  internalRecord?: FragmentInternalRecord,
): Fragment {
  const timestamps = resolveFragmentTimestamps(attributes, internalRecord)
  const bodyFreeze = extractMarkdownFrozenMeta(
    type,
    body,
    readRawMeta(attributes),
    attributes.editable !== true,
  )

  return {
    id,
    type,
    name,
    description: typeof attributes.description === 'string' ? attributes.description : '',
    content: bodyFreeze.content,
    tags: readStringArray(attributes.tags),
    refs: readStringArray(attributes.refs),
    sticky: resolveSticky(type, attributes),
    placement: attributes.placement === 'system' ? 'system' : 'user',
    createdAt: timestamps.createdAt,
    updatedAt: timestamps.updatedAt,
    order: typeof attributes.order === 'number' ? attributes.order : 0,
    meta: bodyFreeze.meta,
    version: internalRecord?.version ?? 1,
    versions: internalRecord?.versions ?? [],
  }
}

function splitMarkdownEditableBody(body: string): {
  content: string
  leadingFrozenText: string | null
} {
  const normalized = normalizeLineEndings(body)
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

function extractMarkdownFrozenMeta(
  type: string,
  body: string,
  meta: Record<string, unknown>,
  freezeBareBody: boolean,
): {
  content: string
  meta: Record<string, unknown>
} {
  if (!supportsMarkdownLeadingFreeze(type) || !freezeBareBody) {
    return { content: body, meta }
  }

  const { content, leadingFrozenText } = splitMarkdownEditableBody(body)
  const normalizedContent = normalizeLineEndings(content)
  const leadingSection = (leadingFrozenText ?? normalizedContent).trim().length > 0
    ? [{ id: MARKDOWN_LEADING_FROZEN_SECTION_ID, text: leadingFrozenText ?? normalizedContent } satisfies FrozenSection]
    : []
  const existingSections = getFrozenSections(meta)
  const frozenSections = dedupeFrozenSections([
    ...leadingSection,
    ...existingSections.filter((section) => section.id !== MARKDOWN_LEADING_FROZEN_SECTION_ID),
  ])

  return {
    content,
    meta: frozenSections.length > 0
      ? { ...meta, frozenSections }
      : { ...meta, frozenSections: undefined },
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
    // Normally the filename is the identity. Keep an explicit id only when a
    // rename would otherwise silently turn the fragment into a new one.
    const stableId = deriveFragmentIdFromName(fragment.type, fragment.name) === fragment.id
      ? undefined
      : fragment.id
    return serializeFrontmatter(
      {
        id: stableId,
        editable: findLeadingFrozenSection(fragment.type, fragment) ? undefined : true,
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

export function fragmentFromExplicitMarkdown(
  attributes: Record<string, unknown>,
  body: string,
  internalRecord?: FragmentInternalRecord,
): Fragment | null {
  if (typeof attributes.id !== 'string' || typeof attributes.type !== 'string') return null
  return buildFragmentFromParsedMarkdown(
    attributes.id,
    attributes.type,
    typeof attributes.name === 'string' ? attributes.name : attributes.id,
    attributes,
    body,
    internalRecord,
  )
}

export function visibleFragmentFromMarkdown(
  type: string,
  fileName: string,
  attributes: Record<string, unknown>,
  body: string,
  internalRecord?: FragmentInternalRecord,
): Fragment {
  const baseName = fileName.replace(/\.md$/i, '')
  return buildFragmentFromParsedMarkdown(
    typeof attributes.id === 'string'
      ? attributes.id
      : getFilenameDerivedFragmentId(type, fileName),
    type,
    baseName,
    attributes,
    body,
    internalRecord,
  )
}
