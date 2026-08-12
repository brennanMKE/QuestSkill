import { resolve } from "node:path"

export function resolveProjectRoot({ worktree, directory }) {
  const selected = worktree?.trim() || directory?.trim()
  if (!selected) throw new Error("OpenCode did not provide a project directory or worktree.")
  return resolve(selected)
}
