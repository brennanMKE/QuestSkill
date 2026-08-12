export const ACTIVE_QUEST_PREFIX = "ACTIVE QUEST"

export function activeQuestContext(quest) {
  const checkpoint = quest.checkpoint
    ? `\n\nIN-FLIGHT CHECKPOINT\n\nSummary: ${quest.checkpoint.summary}\nCompleted: ${quest.checkpoint.completed.join("; ") || "None recorded"}\nCurrent step: ${quest.checkpoint.currentStep}\nNext action: ${quest.checkpoint.nextAction}\nRemaining: ${quest.checkpoint.remaining.join("; ") || "None recorded"}\nBlockers: ${quest.checkpoint.blockers.join("; ") || "None"}\nVerification: ${quest.checkpoint.verification?.join("; ") || "None recorded"}\n\nResume from this checkpoint without asking the user to restate the task. Do not stop merely because context was compacted or a prior turn reached its context limit. On the next model turn, re-inspect repository state, continue the next action, and update or clear the checkpoint as work advances.`
    : ""

  return `${ACTIVE_QUEST_PREFIX}\n\n${quest.objective}\n\nTreat this as the persistent high-level objective for the current project. The user's current message is the immediate task, but decisions should remain consistent with this Quest unless the user explicitly changes or clears it.${checkpoint}`
}
