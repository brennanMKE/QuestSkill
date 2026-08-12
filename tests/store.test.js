import assert from "node:assert/strict"
import { mkdtemp, readdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import { clearQuest, questPath, readQuest, writeQuest } from "../quest/plugin/store.js"

async function project() {
  return mkdtemp(join(tmpdir(), "quest-test-"))
}

test("state persists across independent reads", async () => {
  const root = await project()
  const quest = { id: "id", objective: "Ship it", status: "active" }
  await writeQuest(root, quest)
  assert.deepEqual(await readQuest(root), quest)
})

test("atomic replacement leaves no temporary file", async () => {
  const root = await project()
  await writeQuest(root, { id: "1", objective: "first", status: "active" })
  await writeQuest(root, { id: "1", objective: "second", status: "active" })
  assert.equal((await readQuest(root)).objective, "second")
  assert.deepEqual(await readdir(join(root, ".opencode")), ["quest.json"])
})

test("corrupt JSON is surfaced and never overwritten by a read", async () => {
  const root = await project()
  await writeFile(questPath(root), "{broken", "utf8").catch(async () => {
    await writeQuest(root, { id: "setup", objective: "setup", status: "active" })
    await writeFile(questPath(root), "{broken", "utf8")
  })
  await assert.rejects(readQuest(root), SyntaxError)
})

test("clear removes persisted state", async () => {
  const root = await project()
  await writeQuest(root, { id: "1", objective: "x", status: "active" })
  await clearQuest(root)
  assert.equal(await readQuest(root), undefined)
})
