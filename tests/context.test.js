import assert from "node:assert/strict"
import test from "node:test"

import { activeQuestContext } from "../quest/plugin/context.js"

test("context contains only the objective and constraint", () => {
  const context = activeQuestContext({
    id: "hidden",
    objective: "Preserve behavior",
    status: "active",
    progress: "hidden",
    originalObjective: "also hidden",
  })
  assert.match(context, /^ACTIVE QUEST\n\nPreserve behavior\n\nTreat this as/)
  assert.doesNotMatch(context, /hidden/)
})
