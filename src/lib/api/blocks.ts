import { apiFetch } from './client'
import type { ExportedConfigs, ImportConfigsPayload } from './types'

/**
 * Block-related endpoints that aren't scoped to a specific agent.
 * Per-agent block configuration lives in `agentBlocks` (see agent-blocks.ts).
 *
 * Historical note: this module used to expose a second block-config storage
 * (get/updateConfig/createCustom/updateCustom/deleteCustom/preview) for the
 * legacy "Block Editor". Those endpoints were deleted when the Agent tab
 * became the single source of truth for generation-writer blocks. The
 * remaining exports are shared utilities (script eval, config import/export).
 */
export const blocks = {
  evalScript: (storyId: string, content: string) =>
    apiFetch<{ result: string | null; error: string | null }>(
      `/stories/${storyId}/blocks/eval-script`,
      { method: 'POST', body: JSON.stringify({ content }) },
    ),

  exportConfigs: (storyId: string) =>
    apiFetch<ExportedConfigs>(`/stories/${storyId}/export-configs`),

  importConfigs: (storyId: string, data: ImportConfigsPayload) =>
    apiFetch<{ ok: boolean }>(`/stories/${storyId}/import-configs`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
}
