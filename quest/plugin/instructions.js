import { createHash } from "node:crypto"
import { readdir, readFile } from "node:fs/promises"
import { join, relative } from "node:path"

const INSTRUCTION_FILES = new Set(["AGENTS.md", "CLAUDE.md"])
const EXCLUDED_DIRECTORIES = new Set([".git", ".build", ".next", ".opencode", "build", "dist", "node_modules", "vendor"])

async function discover(directory, projectRoot, found) {
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "EACCES") return
    throw error
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      if (!EXCLUDED_DIRECTORIES.has(entry.name)) await discover(path, projectRoot, found)
    } else if (entry.isFile() && INSTRUCTION_FILES.has(entry.name)) {
      found.push({ path: relative(projectRoot, path), content: await readFile(path) })
    }
  }
}

export async function instructionFingerprint(projectRoot) {
  const found = []
  await discover(projectRoot, projectRoot, found)
  const hash = createHash("sha256")
  for (const source of found) {
    hash.update(source.path)
    hash.update("\0")
    hash.update(source.content)
    hash.update("\0")
  }
  return {
    fingerprint: hash.digest("hex"),
    files: found.map((source) => source.path),
  }
}

export async function currentInstructionAudit(quest, projectRoot) {
  if (!quest.instructionAudit) return { current: false, reason: "missing" }
  const discovered = await instructionFingerprint(projectRoot)
  if (quest.instructionAudit.instructionFilesFingerprint !== discovered.fingerprint) {
    return { current: false, reason: "instruction-files-changed", discovered }
  }
  return { current: true, discovered }
}
