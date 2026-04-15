import * as chaptersAgents from '../chapters/agents'
import * as characterChatAgents from '../character-chat/agents'
import * as directionsAgents from '../directions/agents'
import * as librarianAgents from '../librarian/agents'
import * as llmAgents from '../llm/agents'

// Auto-discover agent modules from src/server/*/agents.ts
// Adding a new agent only requires creating src/server/<name>/agents.ts with a `register` export.
type AgentModule = { register?: () => void }

type ImportMetaWithGlob = ImportMeta & {
  glob?: <T>(pattern: string, options: { eager: true }) => Record<string, T>
}

const fallbackAgentModules: Record<string, AgentModule> = {
  '../chapters/agents.ts': chaptersAgents,
  '../character-chat/agents.ts': characterChatAgents,
  '../directions/agents.ts': directionsAgents,
  '../librarian/agents.ts': librarianAgents,
  '../llm/agents.ts': llmAgents,
}

function getAgentModules(): Record<string, AgentModule> {
  const viteImportMeta = import.meta as ImportMetaWithGlob
  if (typeof import.meta.glob === 'function') {
    return import.meta.glob<AgentModule>('../*/agents.ts', { eager: true })
  }

  return viteImportMeta.glob?.<AgentModule>('../*/agents.ts', { eager: true }) ?? fallbackAgentModules
}

const agentModules = getAgentModules()

let registered = false

export function ensureCoreAgentsRegistered(): void {
  if (registered) return
  for (const [, mod] of Object.entries(agentModules)) {
    if (typeof mod.register === 'function') {
      mod.register()
    }
  }
  registered = true
}
