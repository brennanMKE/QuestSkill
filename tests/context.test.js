import assert from "node:assert/strict"
import test from "node:test"

import { activeQuestContext } from "../quest/plugin/context.js"

test("active context contains the objective and baseline recovery contract", () => {
  const context = activeQuestContext({
    id: "hidden",
    objective: "Preserve behavior",
    status: "active",
    progress: "hidden",
    originalObjective: "also hidden",
  })
  assert.match(context, /^ACTIVE QUEST\n\nPreserve behavior\n\nTreat this as/)
  assert.match(context, /QUEST EXECUTION CONTRACT/)
  assert.match(context, /verify the exact target path before editing/)
  assert.match(context, /create an in-flight checkpoint/)
  assert.match(context, /QUEST PREFLIGHT REQUIRED/)
  assert.match(context, /QUEST PLAN REQUIRED/)
  assert.doesNotMatch(context, /hidden/)
})

test("instruction preflight warnings are injected with mitigations", () => {
  const context = activeQuestContext({
    objective: "Complete every migration task",
    instructionAudit: {
      readiness: "warning",
      reviewedSources: ["AGENTS.md", "CLAUDE.md"],
      risks: [{
        source: "CLAUDE.md",
        trigger: "A tool fails",
        effect: "Stop and report",
        mitigation: "Checkpoint first and use an allowed fallback when available",
        severity: "warning",
      }],
      instructionFilesFingerprint: "a".repeat(64),
      updatedAt: "2026-08-12T00:00:00.000Z",
    },
  })
  assert.match(context, /QUEST INSTRUCTION PREFLIGHT/)
  assert.match(context, /Readiness: WARNING/)
  assert.match(context, /CLAUDE\.md: A tool fails → Stop and report/)
  assert.match(context, /Checkpoint first and use an allowed fallback/)
  assert.match(context, /does not override them/)
})

test("blocking instruction conflict gates implementation", () => {
  const context = activeQuestContext({
    objective: "Complete every migration task",
    instructionAudit: {
      readiness: "blocked",
      reviewedSources: ["AGENTS.md"],
      risks: [{
        source: "AGENTS.md",
        trigger: "Any test fails",
        effect: "Return immediately",
        mitigation: "User must revise or explicitly reconcile the project rule",
        severity: "blocking",
      }],
      instructionFilesFingerprint: "a".repeat(64),
      updatedAt: "2026-08-12T00:00:00.000Z",
    },
  })
  assert.match(context, /Readiness: BLOCKED/)
  assert.match(context, /Do not begin or resume implementation/)
})

test("stale instruction audit restores the preflight gate", () => {
  const context = activeQuestContext({
    objective: "Finish safely",
    instructionAudit: {
      readiness: "clear",
      reviewedSources: ["AGENTS.md"],
      risks: [],
      instructionFilesFingerprint: "a".repeat(64),
      updatedAt: "2026-08-12T00:00:00.000Z",
    },
  }, { instructionAuditCurrent: false })
  assert.match(context, /QUEST PREFLIGHT REQUIRED/)
  assert.match(context, /files changed since the saved audit/)
  assert.doesNotMatch(context, /Readiness: CLEAR/)
})

test("durable Quest plan instructs sidebar synchronization", () => {
  const context = activeQuestContext({
    objective: "Ship the feature",
    instructionAudit: {
      readiness: "clear",
      reviewedSources: ["AGENTS.md"],
      risks: [],
      instructionFilesFingerprint: "a".repeat(64),
      updatedAt: "2026-08-12T00:00:00.000Z",
    },
    plan: [
      { id: "step-1", content: "Implement storage", status: "completed", priority: "high" },
      { id: "step-2", content: "Add tests", status: "in_progress", priority: "high" },
      { id: "step-3", content: "Run verification", status: "pending", priority: "medium" },
    ],
  })
  assert.match(context, /QUEST PLAN/)
  assert.match(context, /\[completed\] \(high\) step-1: Implement storage/)
  assert.match(context, /\[in_progress\] \(high\) step-2: Add tests/)
  assert.match(context, /OpenCode's visible sidebar with the todowrite tool/)
  assert.match(context, /Maintain at most one in_progress item/)
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
  assert.match(context, /QUEST EXECUTION CONTRACT/)
  assert.match(context, /compile\/test failure.*is not by itself a blocker/)
  assert.match(context, /Never replace an existing source file wholesale/)
  assert.doesNotMatch(context, /2026-08-12/)
})
