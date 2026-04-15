import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTempDir, makeTestSettings } from '../setup'
import { createStory, createFragment } from '@/server/fragments/storage'
import {
  expandFragmentTags,
  expandMessagesFragmentTags,
  type ContextMessage,
} from '@/server/llm/context-builder'
import type { StoryMeta, Fragment } from '@/server/fragments/schema'

const MAPEPO_ID = 'ch-mapepo'
const DEKUVA_ID = 'ch-dekuva'
const THIRD_ID = 'ch-c'
const TONE_GUIDE_ID = 'gl-tone-guide'
const WORLD_LORE_ID = 'kn-world-lore'

function makeStory(overrides: Partial<StoryMeta> = {}): StoryMeta {
  const now = new Date().toISOString()
  return {
    id: 'story-test',
    name: 'Test Story',
    description: 'A test story',
    coverImage: null,
    summary: '',
    createdAt: now,
    updatedAt: now,
    settings: makeTestSettings(),
    ...overrides,
  }
}

function makeFragment(overrides: Partial<Fragment>): Fragment {
  const now = new Date().toISOString()
  return {
    id: 'ch-fakeid',
    type: 'character',
    name: 'Mapepo',
    description: 'A mischievous spirit',
    content: 'Mapepo is a trickster spirit who haunts the old forest.',
    tags: [],
    refs: [],
    sticky: false,
    placement: 'user' as const,
    createdAt: now,
    updatedAt: now,
    order: 0,
    meta: {},
    ...overrides,
  }
}

describe('expandFragmentTags', () => {
  let dataDir: string
  let cleanup: () => Promise<void>
  const storyId = 'story-test'

  beforeEach(async () => {
    const tmp = await createTempDir()
    dataDir = tmp.path
    cleanup = tmp.cleanup

    await createStory(dataDir, makeStory())
  })

  afterEach(async () => {
    await cleanup()
  })

  it('expands a full fragment tag with rendered content', async () => {
    const character = makeFragment({
      id: MAPEPO_ID,
      name: 'Mapepo',
      content: 'Mapepo is a trickster spirit who haunts the old forest.',
    })
    await createFragment(dataDir, storyId, character)

    const result = await expandFragmentTags(
      `The author references <@${MAPEPO_ID}> in context.`,
      dataDir,
      storyId,
    )

    // character contextRenderer produces: ## Name\nContent
    expect(result).toContain('## Mapepo')
    expect(result).toContain('Mapepo is a trickster spirit who haunts the old forest.')
    expect(result).not.toContain(`<@${MAPEPO_ID}>`)
  })

  it('expands a :short tag with name and description', async () => {
    const character = makeFragment({
      id: MAPEPO_ID,
      name: 'Mapepo',
      description: 'A mischievous spirit',
      content: 'Full character sheet content that should not appear.',
    })
    await createFragment(dataDir, storyId, character)

    const result = await expandFragmentTags(
      `Mention <@${MAPEPO_ID}:short> briefly.`,
      dataDir,
      storyId,
    )

    expect(result).toBe('Mention Mapepo: A mischievous spirit briefly.')
  })

  it('replaces unknown fragment with error marker', async () => {
    const result = await expandFragmentTags(
      'Reference <@ch-notfou> here.',
      dataDir,
      storyId,
    )

    expect(result).toBe('Reference [unknown fragment: ch-notfou] here.')
  })

  it('expands multiple tags in one string', async () => {
    const char1 = makeFragment({
      id: MAPEPO_ID,
      name: 'Mapepo',
      description: 'A spirit',
      content: 'Spirit content',
    })
    const char2 = makeFragment({
      id: TONE_GUIDE_ID,
      type: 'guideline',
      name: 'Tone Guide',
      description: 'Keep it dark',
      content: 'Write in a dark, foreboding tone.',
    })
    await createFragment(dataDir, storyId, char1)
    await createFragment(dataDir, storyId, char2)

    const result = await expandFragmentTags(
      `Use <@${MAPEPO_ID}:short> and follow <@${TONE_GUIDE_ID}:short>.`,
      dataDir,
      storyId,
    )

    expect(result).toBe('Use Mapepo: A spirit and follow Tone Guide: Keep it dark.')
  })

  it('does not recursively expand tags in expanded content by default', async () => {
    // Create a fragment whose content itself contains a tag
    const char1 = makeFragment({
      id: MAPEPO_ID,
      name: 'Mapepo',
      description: 'Refers to another',
      content: `Mapepo is friends with <@${DEKUVA_ID}>.`,
    })
    const char2 = makeFragment({
      id: DEKUVA_ID,
      name: 'Dekuva',
      description: 'Another character',
      content: 'Dekuva is wise.',
    })
    await createFragment(dataDir, storyId, char1)
    await createFragment(dataDir, storyId, char2)

    const result = await expandFragmentTags(
      `Expand <@${MAPEPO_ID}> here.`,
      dataDir,
      storyId,
    )

    // The expanded content of ch-bafego contains <@ch-dekuva> — it should NOT be expanded
    expect(result).toContain(`<@${DEKUVA_ID}>`)
    expect(result).not.toContain('Dekuva is wise.')
  })

  it('recursively expands tags when maxDepth > 0', async () => {
    const char1 = makeFragment({
      id: MAPEPO_ID,
      name: 'Mapepo',
      description: 'Refers to another',
      content: `Mapepo is friends with <@${DEKUVA_ID}>.`,
    })
    const char2 = makeFragment({
      id: DEKUVA_ID,
      name: 'Dekuva',
      description: 'Another character',
      content: 'Dekuva is wise.',
    })
    await createFragment(dataDir, storyId, char1)
    await createFragment(dataDir, storyId, char2)

    const result = await expandFragmentTags(
      `Expand <@${MAPEPO_ID}> here.`,
      dataDir,
      storyId,
      { maxDepth: 1 },
    )

    // With depth 1, ch-bafego expands AND the nested <@ch-dekuva> also expands
    expect(result).not.toContain(`<@${DEKUVA_ID}>`)
    expect(result).toContain('Dekuva is wise.')
  })

  it('detects circular references and replaces with marker', async () => {
    // A references B, B references A
    const char1 = makeFragment({
      id: MAPEPO_ID,
      name: 'Mapepo',
      description: 'Refers to Dekuva',
      content: `Mapepo is enemies with <@${DEKUVA_ID}>.`,
    })
    const char2 = makeFragment({
      id: DEKUVA_ID,
      name: 'Dekuva',
      description: 'Refers to Mapepo',
      content: `Dekuva is enemies with <@${MAPEPO_ID}>.`,
    })
    await createFragment(dataDir, storyId, char1)
    await createFragment(dataDir, storyId, char2)

    const result = await expandFragmentTags(
      `Start with <@${MAPEPO_ID}>.`,
      dataDir,
      storyId,
      { maxDepth: 3 },
    )

    // ch-bafego expands, then ch-dekuva expands, but when it tries to expand ch-bafego again → circular
    expect(result).toContain(`[circular fragment: ${MAPEPO_ID}]`)
    expect(result).not.toContain(`<@${MAPEPO_ID}>`)
    expect(result).not.toContain(`<@${DEKUVA_ID}>`)
  })

  it('detects self-referencing circular fragments', async () => {
    const char = makeFragment({
      id: MAPEPO_ID,
      name: 'Mapepo',
      description: 'Self-referencing',
      content: `Mapepo references himself: <@${MAPEPO_ID}>.`,
    })
    await createFragment(dataDir, storyId, char)

    const result = await expandFragmentTags(
      `Expand <@${MAPEPO_ID}>.`,
      dataDir,
      storyId,
      { maxDepth: 2 },
    )

    expect(result).toContain(`[circular fragment: ${MAPEPO_ID}]`)
  })

  it('respects maxDepth limit even without circular references', async () => {
    // A → B → C (chain of 3), but maxDepth=1 so only 1 level of recursion
    const char1 = makeFragment({
      id: 'ch-a',
      name: 'A',
      description: 'First',
      content: 'A mentions <@ch-b>.',
    })
    const char2 = makeFragment({
      id: 'ch-b',
      name: 'B',
      description: 'Second',
      content: 'B mentions <@ch-c>.',
    })
    const char3 = makeFragment({
      id: 'ch-c',
      name: 'C',
      description: 'Third',
      content: 'C is the end.',
    })
    await createFragment(dataDir, storyId, char1)
    await createFragment(dataDir, storyId, char2)
    await createFragment(dataDir, storyId, char3)

    const result = await expandFragmentTags(
      'Start: <@ch-a>.',
      dataDir,
      storyId,
      { maxDepth: 1 },
    )

    // A expands (depth 0→1), B expands (depth 1→done), but C's tag is NOT expanded (no more depth)
    expect(result).not.toContain('<@ch-b>')
    expect(result).toContain('<@ch-c>')  // Not expanded — depth exhausted
    expect(result).not.toContain('C is the end.')
  })

  it('returns content unchanged when no tags present', async () => {
    const input = 'No fragment tags here at all.'
    const result = await expandFragmentTags(input, dataDir, storyId)
    expect(result).toBe(input)
  })

  it('handles different fragment types', async () => {
    const knowledge = makeFragment({
      id: WORLD_LORE_ID,
      type: 'knowledge',
      name: 'World Lore',
      description: 'Geography details',
      content: 'The continent has three major regions.',
    })
    await createFragment(dataDir, storyId, knowledge)

    const result = await expandFragmentTags(
      `See <@${WORLD_LORE_ID}> for details.`,
      dataDir,
      storyId,
    )

    // knowledge contextRenderer produces: ### Name\nContent
    expect(result).toContain('### World Lore')
    expect(result).toContain('The continent has three major regions.')
  })
})

describe('expandMessagesFragmentTags', () => {
  let dataDir: string
  let cleanup: () => Promise<void>
  const storyId = 'story-test'

  beforeEach(async () => {
    const tmp = await createTempDir()
    dataDir = tmp.path
    cleanup = tmp.cleanup

    await createStory(dataDir, makeStory())

    const character = makeFragment({
      id: MAPEPO_ID,
      name: 'Mapepo',
      description: 'A spirit',
      content: 'Mapepo is a trickster.',
    })
    await createFragment(dataDir, storyId, character)
  })

  afterEach(async () => {
    await cleanup()
  })

  it('expands tags in both system and user messages', async () => {
    const messages: ContextMessage[] = [
      { role: 'system', content: `You write about <@${MAPEPO_ID}:short>.` },
      { role: 'user', content: `Continue the story with <@${MAPEPO_ID}>.` },
    ]

    const expanded = await expandMessagesFragmentTags(messages, dataDir, storyId)

    expect(expanded[0].content).toBe('You write about Mapepo: A spirit.')
    expect(expanded[1].content).toContain('## Mapepo')
    expect(expanded[1].content).toContain('Mapepo is a trickster.')
  })

  it('preserves message roles', async () => {
    const messages: ContextMessage[] = [
      { role: 'system', content: 'No tags here.' },
      { role: 'user', content: 'Also no tags.' },
      { role: 'assistant', content: 'Response text.' },
    ]

    const expanded = await expandMessagesFragmentTags(messages, dataDir, storyId)

    expect(expanded[0].role).toBe('system')
    expect(expanded[1].role).toBe('user')
    expect(expanded[2].role).toBe('assistant')
    expect(expanded[0].content).toBe('No tags here.')
    expect(expanded[1].content).toBe('Also no tags.')
    expect(expanded[2].content).toBe('Response text.')
  })

  it('handles duplicate tags across messages', async () => {
    const messages: ContextMessage[] = [
      { role: 'system', content: `About <@${MAPEPO_ID}:short>.` },
      { role: 'user', content: `More about <@${MAPEPO_ID}:short>.` },
    ]

    const expanded = await expandMessagesFragmentTags(messages, dataDir, storyId)

    expect(expanded[0].content).toBe('About Mapepo: A spirit.')
    expect(expanded[1].content).toBe('More about Mapepo: A spirit.')
  })
})
