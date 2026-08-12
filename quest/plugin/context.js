export const ACTIVE_QUEST_PREFIX = "ACTIVE QUEST"

export function activeQuestContext(quest) {
  return `${ACTIVE_QUEST_PREFIX}\n\n${quest.objective}\n\nTreat this as the persistent high-level objective for the current project. The user's current message is the immediate task, but decisions should remain consistent with this Quest unless the user explicitly changes or clears it.`
}
