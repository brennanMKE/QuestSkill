import assert from "node:assert/strict"
import test from "node:test"

import { resolveProjectRoot } from "../quest/plugin/project-root.js"

test("uses OpenCode worktree even when invocation directory is nested", () => {
  assert.equal(
    resolveProjectRoot({ worktree: "/repo", directory: "/repo/packages/app" }),
    "/repo",
  )
})

test("falls back to OpenCode directory outside a worktree", () => {
  assert.equal(resolveProjectRoot({ worktree: "", directory: "/scratch/project" }), "/scratch/project")
})

test("rejects missing OpenCode project context", () => {
  assert.throws(() => resolveProjectRoot({}), /project directory or worktree/)
})
