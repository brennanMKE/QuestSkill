import { randomUUID } from "node:crypto"
import { tool } from "@opencode-ai/plugin"
import { activeQuestContext } from "./context.js"
import { resolveProjectRoot } from "./project-root.js"
import { clearQuest, readQuest, validateObjective, writeQuest } from "./store.js"

export async function loadQuest(projectRoot) {
  try {
    const value = await readQuest(projectRoot)
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

export default async function questPlugin({ directory, worktree }) {
  const projectRoot = resolveProjectRoot({ worktree, directory })

  return {
    "experimental.chat.system.transform": async (_input, output) => {
      const quest = await loadQuest(projectRoot)
      if (quest) output.system.push(activeQuestContext(quest))
    },
    "experimental.session.compacting": async (_input, output) => {
      const quest = await loadQuest(projectRoot)
      if (quest) output.context.push(activeQuestContext(quest))
    },
    tool: {
      quest_state: tool({
        description: "Read or atomically mutate the current project's persistent Quest. Run the quest skill's audit before action=complete.",
        args: {
          action: tool.schema.enum(["show", "create", "update", "complete", "clear"]),
          objective: tool.schema.string().optional(),
        },
        async execute({ action, objective }) {
          const current = await readQuest(projectRoot)
          if (action === "show") return JSON.stringify(current ?? null, null, 2)
          if (action === "clear") {
            await clearQuest(projectRoot)
            return "Quest cleared."
          }

          const now = new Date().toISOString()
          if (action === "create") {
            if (current?.status === "active") throw new Error("An active Quest already exists; update or clear it first.")
            const cleanObjective = validateObjective(objective)
            const next = {
              id: randomUUID(),
              objective: cleanObjective,
              originalObjective: cleanObjective,
              objectiveRevisions: [],
              status: "active",
              createdAt: now,
              updatedAt: now,
            }
            await writeQuest(projectRoot, next)
            return JSON.stringify(next, null, 2)
          }
          if (!current) throw new Error("No Quest exists; create one first.")
          if (action === "update") {
            const cleanObjective = validateObjective(objective)
            const revision = { objective: current.objective, replacedAt: now }
            const next = {
              ...current,
              originalObjective: current.originalObjective ?? current.objective,
              objectiveRevisions: [...(current.objectiveRevisions ?? []), revision],
              objective: cleanObjective,
              updatedAt: now,
            }
            await writeQuest(projectRoot, next)
            return JSON.stringify(next, null, 2)
          }
          const next = { ...current, status: "completed", updatedAt: now, completedAt: now }
          await writeQuest(projectRoot, next)
          return JSON.stringify(next, null, 2)
        },
      }),
    },
  }
}
