export const ACTIVE_QUEST_PREFIX = "ACTIVE QUEST"

export function activeQuestContext(quest) {
  const checkpoint = quest.checkpoint
    ? `\n\nIN-FLIGHT CHECKPOINT\n\nSummary: ${quest.checkpoint.summary}\nCompleted: ${quest.checkpoint.completed.join("; ") || "None recorded"}\nCurrent step: ${quest.checkpoint.currentStep}\nNext action: ${quest.checkpoint.nextAction}\nRemaining: ${quest.checkpoint.remaining.join("; ") || "None recorded"}\nBlockers: ${quest.checkpoint.blockers.join("; ") || "None"}\nVerification: ${quest.checkpoint.verification?.join("; ") || "None recorded"}\n\nResume from this checkpoint without asking the user to restate the task. Do not stop merely because context was compacted or a prior turn reached its context limit. On the next model turn, re-inspect repository state, continue the next action, and update or clear the checkpoint as work advances.`
    : ""

  const executionContract = `\n\nQUEST EXECUTION CONTRACT\n\nWhen working toward this Quest, verify the exact target path before editing and preserve recoverability before broad or structural changes. A compile/test failure, unfamiliar code, wrong edit, or context pressure is not by itself a blocker. Inspect the current file and diff, diagnose the first error from the current state, make the smallest reversible edit, and verify again. Never replace an existing source file wholesale to escape a local error.${quest.checkpoint ? " The Quest is in progress: continue until the current requested task is complete or a genuine blocker requires user input or new authority. Refresh the checkpoint after milestones and failures. Do not respond only with a failure report while safe recovery work remains." : " Before long or risky work, create an in-flight checkpoint with the exact next action."}`

  return `${ACTIVE_QUEST_PREFIX}\n\n${quest.objective}\n\nTreat this as the persistent high-level objective for the current project. The user's current message is the immediate task, but decisions should remain consistent with this Quest unless the user explicitly changes or clears it.${checkpoint}${executionContract}`
}
