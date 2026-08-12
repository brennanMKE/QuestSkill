import assert from "node:assert/strict"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import { currentInstructionAudit, instructionFingerprint } from "../quest/plugin/instructions.js"

test("instruction fingerprint changes when applicable files change", async () => {
  const root = await mkdtemp(join(tmpdir(), "quest-instructions-"))
  await writeFile(join(root, "AGENTS.md"), "Keep working\n")
  const first = await instructionFingerprint(root)
  await writeFile(join(root, "AGENTS.md"), "Stop after a tool failure\n")
  const second = await instructionFingerprint(root)
  assert.notEqual(first.fingerprint, second.fingerprint)
  assert.deepEqual(second.files, ["AGENTS.md"])
})

test("instruction fingerprint detects newly added nested CLAUDE.md", async () => {
  const root = await mkdtemp(join(tmpdir(), "quest-instructions-"))
  const first = await instructionFingerprint(root)
  await mkdir(join(root, "Sources"))
  await writeFile(join(root, "Sources", "CLAUDE.md"), "Ask before editing\n")
  const second = await instructionFingerprint(root)
  assert.notEqual(first.fingerprint, second.fingerprint)
  assert.deepEqual(second.files, ["Sources/CLAUDE.md"])
})

test("saved audit becomes stale when instruction fingerprint changes", async () => {
  const root = await mkdtemp(join(tmpdir(), "quest-instructions-"))
  await writeFile(join(root, "AGENTS.md"), "Initial\n")
  const initial = await instructionFingerprint(root)
  const quest = { instructionAudit: { instructionFilesFingerprint: initial.fingerprint } }
  assert.equal((await currentInstructionAudit(quest, root)).current, true)
  await writeFile(join(root, "AGENTS.md"), "Changed\n")
  assert.deepEqual((await currentInstructionAudit(quest, root)).current, false)
})
