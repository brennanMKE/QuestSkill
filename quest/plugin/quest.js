import { readFile } from "node:fs/promises"
import { join } from "node:path"

const ACTIVE_QUEST_PREFIX = "ACTIVE QUEST"

export function questPath(projectRoot) {
  return join(projectRoot, ".opencode", "quest.json")
}

export async function loadQuest(projectRoot) {
  try {
    const value = JSON.parse(await readFile(questPath(projectRoot), "utf8"))
    if (
      typeof value === "object" &&
      value !== null &&
      typeof value.objective === "string" &&
      value.status === "active"
    ) {
      return value
    }
    return undefined
  } catch (error) {
    if (error?.code === "ENOENT") return undefined
    // Do not break every OpenCode response because local Quest state is invalid.
    // Command handling reports detailed, actionable storage errors.
    return undefined
  }
}

export function activeQuestContext(quest) {
  return `${ACTIVE_QUEST_PREFIX}\n\n${quest.objective}\n\nTreat this as the persistent high-level objective for the current project. The user's current message is the immediate task, but decisions should remain consistent with this Quest unless the user explicitly changes or clears it.`
}

export default async function questPlugin({ directory, worktree }) {
  const projectRoot = worktree || directory

  return {
    "experimental.chat.system.transform": async (_input, output) => {
      const quest = await loadQuest(projectRoot)
      if (quest) output.system.push(activeQuestContext(quest))
    },
  }
}
