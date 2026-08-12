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

test("context includes a compact in-flight resume checkpoint", () => {
  const context = activeQuestContext({
    objective: "Finish the migration",
    checkpoint: {
      summary: "Converted the data model",
      completed: ["Converted model"],
      currentStep: "Update service",
      remaining: ["Update service", "Run tests"],
      blockers: [],
      verification: ["Unit tests passed"],
      nextAction: "Open src/service.js and replace callback calls",
      updatedAt: "2026-08-12T00:00:00.000Z",
    },
  })
  assert.match(context, /IN-FLIGHT CHECKPOINT/)
  assert.match(context, /Completed: Converted model/)
  assert.match(context, /Current step: Update service/)
  assert.match(context, /Next action: Open src\/service\.js/)
  assert.match(context, /Verification: Unit tests passed/)
  assert.match(context, /Resume from this checkpoint without asking the user/)
  assert.doesNotMatch(context, /2026-08-12/)
})
