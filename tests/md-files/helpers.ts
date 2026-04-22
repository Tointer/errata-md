import { makeTestSettings } from '../setup'
import type { Fragment, StoryMeta } from '@/server/fragments/schema'

export function makeStory(id: string): StoryMeta {
  const now = new Date().toISOString()
  return {
    id,
    name: 'Markdown Story',
    description: 'Story synced to markdown files.',
    coverImage: null,
    summary: '',
    createdAt: now,
    updatedAt: now,
    settings: makeTestSettings(),
  }
}

export function makeFragment(id: string, overrides?: Partial<Fragment>): Fragment {
  const now = new Date().toISOString()
  return {
    id,
    type: 'prose',
    name: 'Opening',
    description: 'The first beat',
    content: 'It was raining over the station.',
    tags: [],
    refs: [],
    sticky: false,
    placement: 'user',
    createdAt: now,
    updatedAt: now,
    order: 0,
    meta: {},
    version: 1,
    versions: [],
    ...overrides,
  }
}