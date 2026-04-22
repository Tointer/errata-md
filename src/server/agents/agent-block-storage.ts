import { z } from 'zod/v4'
import { BlockConfigSchema, type CustomBlockDefinition, type BlockOverride } from '../blocks/schema'
import { getStoryInternalDir } from '../storage/paths'
import { getStorageBackend } from '../storage/runtime'

export const AgentBlockConfigSchema = BlockConfigSchema.extend({
  disabledTools: z.array(z.string()).default([]),
  disableAutoAnalysis: z.boolean().default(false),
})

export type AgentBlockConfig = z.infer<typeof AgentBlockConfigSchema>

function emptyConfig(): AgentBlockConfig {
  return { customBlocks: [], overrides: {}, blockOrder: [], disabledTools: [], disableAutoAnalysis: false }
}

export async function getAgentBlockConfig(dataDir: string, storyId: string, agentName: string): Promise<AgentBlockConfig> {
  const storage = getStorageBackend()
  const config = await storage.readJsonOrDefault(
    getStoryInternalDir(dataDir, storyId, 'agent-blocks', `${agentName}.json`),
    emptyConfig(),
  )

  try {
    return AgentBlockConfigSchema.parse(config)
  } catch {
    return emptyConfig()
  }
}

export async function saveAgentBlockConfig(dataDir: string, storyId: string, agentName: string, config: AgentBlockConfig): Promise<void> {
  const storage = getStorageBackend()
  await storage.writeJson(getStoryInternalDir(dataDir, storyId, 'agent-blocks', `${agentName}.json`), config)
}

export async function addAgentCustomBlock(
  dataDir: string,
  storyId: string,
  agentName: string,
  block: CustomBlockDefinition,
): Promise<AgentBlockConfig> {
  const config = await getAgentBlockConfig(dataDir, storyId, agentName)
  config.customBlocks.push(block)
  config.blockOrder.push(block.id)
  await saveAgentBlockConfig(dataDir, storyId, agentName, config)
  return config
}

export async function updateAgentCustomBlock(
  dataDir: string,
  storyId: string,
  agentName: string,
  blockId: string,
  updates: Partial<Omit<CustomBlockDefinition, 'id'>>,
): Promise<AgentBlockConfig | null> {
  const config = await getAgentBlockConfig(dataDir, storyId, agentName)
  const idx = config.customBlocks.findIndex(b => b.id === blockId)
  if (idx === -1) return null

  config.customBlocks[idx] = { ...config.customBlocks[idx], ...updates }
  await saveAgentBlockConfig(dataDir, storyId, agentName, config)
  return config
}

export async function deleteAgentCustomBlock(
  dataDir: string,
  storyId: string,
  agentName: string,
  blockId: string,
): Promise<AgentBlockConfig> {
  const config = await getAgentBlockConfig(dataDir, storyId, agentName)
  config.customBlocks = config.customBlocks.filter(b => b.id !== blockId)
  config.blockOrder = config.blockOrder.filter(id => id !== blockId)
  delete config.overrides[blockId]
  await saveAgentBlockConfig(dataDir, storyId, agentName, config)
  return config
}

export async function updateAgentBlockOverrides(
  dataDir: string,
  storyId: string,
  agentName: string,
  overrides: Record<string, BlockOverride>,
  blockOrder?: string[],
): Promise<AgentBlockConfig> {
  const config = await getAgentBlockConfig(dataDir, storyId, agentName)
  for (const [id, override] of Object.entries(overrides)) {
    config.overrides[id] = { ...config.overrides[id], ...override }
  }
  if (blockOrder !== undefined) {
    config.blockOrder = blockOrder
  }
  await saveAgentBlockConfig(dataDir, storyId, agentName, config)
  return config
}

export async function updateAgentDisabledTools(
  dataDir: string,
  storyId: string,
  agentName: string,
  disabledTools: string[],
): Promise<AgentBlockConfig> {
  const config = await getAgentBlockConfig(dataDir, storyId, agentName)
  config.disabledTools = disabledTools
  await saveAgentBlockConfig(dataDir, storyId, agentName, config)
  return config
}
