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

function questStateError(error) {
  return `QUEST STATE ERROR\n\nCould not load .opencode/quest.json: ${error.message}. The persisted Quest may still exist, but automatic continuity is unavailable until the file is repaired. Do not overwrite or discard it.`
}

export default async function questPlugin({ directory, worktree }) {
  const projectRoot = resolveProjectRoot({ worktree, directory })

  return {
    "experimental.chat.system.transform": async (_input, output) => {
      try {
        const quest = await readQuest(projectRoot)
        if (quest?.status === "active") output.system.push(activeQuestContext(quest))
      } catch (error) {
        output.system.push(questStateError(error))
      }
    },
    "experimental.session.compacting": async (_input, output) => {
      try {
        const quest = await readQuest(projectRoot)
        if (quest?.status === "active") {
          output.context.push(activeQuestContext(quest))
          output.context.push("Preserve the active Quest and its in-flight checkpoint in the compaction summary. Include completed work, current step, remaining work, blockers, verification state, and the exact next action so execution can continue on the next model turn after compaction.")
        }
      } catch (error) {
        output.context.push(questStateError(error))
      }
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
            const { checkpoint: _checkpoint, ...questWithoutCheckpoint } = current
            const next = {
              ...questWithoutCheckpoint,
              originalObjective: current.originalObjective ?? current.objective,
              objectiveRevisions: [...(current.objectiveRevisions ?? []), revision],
              objective: cleanObjective,
              updatedAt: now,
            }
            await writeQuest(projectRoot, next)
            return JSON.stringify(next, null, 2)
          }
          const { checkpoint: _checkpoint, ...questWithoutCheckpoint } = current
          const next = { ...questWithoutCheckpoint, status: "completed", updatedAt: now, completedAt: now }
          await writeQuest(projectRoot, next)
          return JSON.stringify(next, null, 2)
        },
      }),
      quest_checkpoint: tool({
        description: "Save or clear a durable in-flight Quest checkpoint so long-running work resumes after compaction, context exhaustion, failed verification, or a wrong edit. Save before broad/structural edits and after each milestone or failure; include the current diagnostic and exact safe recovery action.",
        args: {
          action: tool.schema.enum(["save", "clear"]),
          summary: tool.schema.string().optional(),
          completed: tool.schema.array(tool.schema.string()).optional(),
          currentStep: tool.schema.string().optional(),
          remaining: tool.schema.array(tool.schema.string()).optional(),
          blockers: tool.schema.array(tool.schema.string()).optional(),
          verification: tool.schema.array(tool.schema.string()).optional(),
          nextAction: tool.schema.string().optional(),
        },
        async execute({ action, summary, completed, currentStep, remaining, blockers, verification, nextAction }) {
          const current = await readQuest(projectRoot)
          if (!current || current.status !== "active") throw new Error("No active Quest exists; create one first.")
          const now = new Date().toISOString()
          if (action === "clear") {
            const { checkpoint: _checkpoint, ...next } = current
            await writeQuest(projectRoot, { ...next, updatedAt: now })
            return "Quest checkpoint cleared."
          }
          const checkpoint = {
            summary,
            completed: completed ?? [],
            currentStep,
            remaining: remaining ?? [],
            blockers: blockers ?? [],
            verification: verification ?? [],
            nextAction,
            updatedAt: now,
          }
          const next = { ...current, checkpoint, updatedAt: now }
          await writeQuest(projectRoot, next)
          return JSON.stringify(checkpoint, null, 2)
        },
      }),
    },
  }
}
