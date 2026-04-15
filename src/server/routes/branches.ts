import { Elysia, t } from 'elysia'
import { getStory } from '../fragments/storage'
import {
  getBranchesIndex,
} from '../fragments/branches'

export function branchRoutes(dataDir: string) {
  return new Elysia({ detail: { tags: ['Branches'] } })
    .get('/stories/:storyId/branches', async ({ params, set }) => {
      const story = await getStory(dataDir, params.storyId)
      if (!story) {
        set.status = 404
        return { error: 'Story not found' }
      }
      return getBranchesIndex(dataDir, params.storyId)
    }, {
      detail: { summary: 'List all branches' },
    })

    .post('/stories/:storyId/branches', async ({ params, body, set }) => {
      const story = await getStory(dataDir, params.storyId)
      if (!story) {
        set.status = 404
        return { error: 'Story not found' }
      }
      void body
      set.status = 410
      return { error: 'Timelines have been removed from Errata.' }
    }, {
      body: t.Object({
        name: t.String(),
        parentBranchId: t.String(),
        forkAfterIndex: t.Optional(t.Number()),
      }),
      detail: { summary: 'Create a new branch' },
    })

    .patch('/stories/:storyId/branches/active', async ({ params, body, set }) => {
      const story = await getStory(dataDir, params.storyId)
      if (!story) {
        set.status = 404
        return { error: 'Story not found' }
      }

      if (body.branchId === 'main') {
        return { ok: true }
      }

      set.status = 410
      return { error: 'Timelines have been removed from Errata.' }
    }, {
      body: t.Object({
        branchId: t.String(),
      }),
      detail: { summary: 'Switch the active branch' },
    })

    .put('/stories/:storyId/branches/:branchId', async ({ params, body, set }) => {
      const story = await getStory(dataDir, params.storyId)
      if (!story) {
        set.status = 404
        return { error: 'Story not found' }
      }

      if (params.branchId === 'main' && body.name === 'Main') {
        return (await getBranchesIndex(dataDir, params.storyId)).branches[0]
      }

      set.status = 410
      return { error: 'Timelines have been removed from Errata.' }
    }, {
      body: t.Object({
        name: t.String(),
      }),
      detail: { summary: 'Rename a branch' },
    })

    .delete('/stories/:storyId/branches/:branchId', async ({ params, set }) => {
      const story = await getStory(dataDir, params.storyId)
      if (!story) {
        set.status = 404
        return { error: 'Story not found' }
      }

      set.status = 410
      return { error: 'Timelines have been removed from Errata.' }
    }, {
      detail: { summary: 'Delete a branch' },
    })
}
