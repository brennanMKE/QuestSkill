import assert from "node:assert/strict"
import { mkdtemp, readdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import { clearQuest, questPath, readQuest, writeQuest } from "../quest/plugin/store.js"

async function project() {
  return mkdtemp(join(tmpdir(), "quest-test-"))
}

function quest(objective = "Ship it") {
  return {
    id: "id",
    objective,
    status: "active",
    createdAt: "2026-08-11T00:00:00.000Z",
    updatedAt: "2026-08-11T00:00:00.000Z",
  }
}

test("state persists across independent reads", async () => {
  const root = await project()
  const value = quest()
  await writeQuest(root, value)
  assert.deepEqual(await readQuest(root), value)
})

test("atomic replacement leaves no temporary file", async () => {
  const root = await project()
  await writeQuest(root, quest("first"))
  await writeQuest(root, quest("second"))
  assert.equal((await readQuest(root)).objective, "second")
  assert.deepEqual(await readdir(join(root, ".opencode")), ["quest.json"])
})

test("corrupt JSON is surfaced and never overwritten by a read", async () => {
  const root = await project()
  await writeFile(questPath(root), "{broken", "utf8").catch(async () => {
    await writeQuest(root, quest("setup"))
    await writeFile(questPath(root), "{broken", "utf8")
  })
  await assert.rejects(readQuest(root), SyntaxError)
})

test("clear removes persisted state", async () => {
  const root = await project()
  await writeQuest(root, quest("x"))
  await clearQuest(root)
  assert.equal(await readQuest(root), undefined)
})

test("rejects empty objectives and unknown fields", async () => {
  const root = await project()
  await assert.rejects(writeQuest(root, quest("  ")), /non-whitespace/)
  await assert.rejects(writeQuest(root, { ...quest(), surprise: true }), /unknown field surprise/)
})

test("rejects invalid status and timestamps", async () => {
  const root = await project()
  await assert.rejects(writeQuest(root, { ...quest(), status: "paused" }), /status/)
  await assert.rejects(writeQuest(root, { ...quest(), updatedAt: "yesterday" }), /updatedAt/)
})

test("persists and validates a durable execution checkpoint", async () => {
  const root = await project()
  const value = {
    ...quest(),
    checkpoint: {
      summary: "Implemented storage",
      completed: ["Added schema"],
      currentStep: "Add tests",
      remaining: ["Add tests", "Run verification"],
      blockers: [],
      verification: ["npm test passed"],
      nextAction: "Edit tests/store.test.js",
      updatedAt: "2026-08-12T00:00:00.000Z",
    },
  }
  await writeQuest(root, value)
  assert.deepEqual((await readQuest(root)).checkpoint, value.checkpoint)
})

test("rejects incomplete or malformed checkpoints", async () => {
  const root = await project()
  await assert.rejects(
    writeQuest(root, { ...quest(), checkpoint: { summary: "partial" } }),
    /checkpoint currentStep/,
  )
  await assert.rejects(
    writeQuest(root, {
      ...quest(),
      checkpoint: {
        summary: "x",
        completed: [],
        currentStep: "y",
        remaining: "not-an-array",
        blockers: [],
        nextAction: "z",
        updatedAt: "2026-08-12T00:00:00.000Z",
      },
    }),
    /checkpoint remaining/,
  )
})

test("persists an instruction preflight audit", async () => {
  const root = await project()
  const instructionAudit = {
    readiness: "warning",
    reviewedSources: ["AGENTS.md", "CLAUDE.md"],
    risks: [{
      source: "CLAUDE.md",
      trigger: "Tool failure",
      effect: "Stop work",
      mitigation: "Use an allowed fallback and checkpoint before a mandatory stop",
      severity: "warning",
    }],
    instructionFilesFingerprint: "a".repeat(64),
    updatedAt: "2026-08-12T00:00:00.000Z",
  }
  await writeQuest(root, { ...quest(), instructionAudit })
  assert.deepEqual((await readQuest(root)).instructionAudit, instructionAudit)
})

test("rejects inconsistent instruction audit readiness", async () => {
  const root = await project()
  const risk = {
    source: "AGENTS.md",
    trigger: "Question arises",
    effect: "Stop and ask",
    mitigation: "Ask required questions during preflight",
    severity: "warning",
  }
  await assert.rejects(writeQuest(root, {
    ...quest(),
    instructionAudit: {
      readiness: "clear",
      reviewedSources: ["AGENTS.md"],
      risks: [risk],
      instructionFilesFingerprint: "a".repeat(64),
      updatedAt: "2026-08-12T00:00:00.000Z",
    },
  }), /clear instructionAudit cannot contain risks/)
  await assert.rejects(writeQuest(root, {
    ...quest(),
    instructionAudit: {
      readiness: "blocked",
      reviewedSources: ["AGENTS.md"],
      risks: [risk],
      instructionFilesFingerprint: "a".repeat(64),
      updatedAt: "2026-08-12T00:00:00.000Z",
    },
  }), /requires a blocking risk/)
})

test("blocking risks cannot be mislabeled as warning readiness", async () => {
  const root = await project()
  await assert.rejects(writeQuest(root, {
    ...quest(),
    instructionAudit: {
      readiness: "warning",
      reviewedSources: ["AGENTS.md"],
      risks: [{
        source: "AGENTS.md",
        trigger: "Tool failure",
        effect: "Stop",
        mitigation: "Ask user to reconcile the rule",
        severity: "blocking",
      }],
      instructionFilesFingerprint: "a".repeat(64),
      updatedAt: "2026-08-12T00:00:00.000Z",
    },
  }), /warning-only risks/)
})
