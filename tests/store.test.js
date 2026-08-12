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
