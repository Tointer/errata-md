import { StoryMetaSchema, type StoryMeta } from '@/server/fragments/schema'
import { serializeFrontmatter } from './frontmatter'

const defaultStorySettings = StoryMetaSchema.shape.settings.parse({})

export function serializeStoryMeta(story: StoryMeta): string {
  return serializeFrontmatter(
    {
      id: story.id,
      name: story.name,
      coverImage: story.coverImage,
      summary: story.summary,
      createdAt: story.createdAt,
      updatedAt: story.updatedAt,
      settings: story.settings,
    },
    story.description,
  )
}

export function storyMetaFromMarkdown(
  attributes: Record<string, unknown>,
  body: string,
): StoryMeta | null {
  const settingsResult = StoryMetaSchema.shape.settings.safeParse(attributes.settings ?? defaultStorySettings)
  if (!settingsResult.success) return null

  const parsed = StoryMetaSchema.safeParse({
    id: attributes.id,
    name: attributes.name,
    description: body,
    coverImage: attributes.coverImage ?? null,
    summary: attributes.summary ?? '',
    createdAt: attributes.createdAt ?? new Date(0).toISOString(),
    updatedAt: attributes.updatedAt ?? new Date(0).toISOString(),
    settings: settingsResult.data,
  })

  return parsed.success ? parsed.data : null
}