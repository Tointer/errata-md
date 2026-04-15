import { StoryMetaSchema, type StoryMeta } from '@/server/fragments/schema'
import { serializeFrontmatter } from './frontmatter'

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

export function storyMetaFromMarkdown(attributes: Record<string, unknown>, body: string): StoryMeta | null {
  const parsed = StoryMetaSchema.safeParse({
    id: attributes.id,
    name: attributes.name,
    description: body,
    coverImage: attributes.coverImage,
    summary: attributes.summary,
    createdAt: attributes.createdAt,
    updatedAt: attributes.updatedAt,
    settings: attributes.settings,
  })

  return parsed.success ? parsed.data : null
}