import { randomUUID } from "node:crypto"
import { mkdir, open, readFile, rename, rm } from "node:fs/promises"
import { dirname, join } from "node:path"

const REQUIRED_FIELDS = ["id", "objective", "status", "createdAt", "updatedAt"]
const ALLOWED_FIELDS = new Set([
  ...REQUIRED_FIELDS,
  "originalObjective",
  "objectiveRevisions",
  "progress",
  "completedAt",
])

export class QuestValidationError extends Error {
  constructor(message) {
    super(`Invalid .opencode/quest.json: ${message}`)
    this.name = "QuestValidationError"
  }
}

function isTimestamp(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value))
}

export function validateObjective(objective) {
  if (typeof objective !== "string" || objective.trim().length === 0) {
    throw new QuestValidationError("objective must contain non-whitespace text")
  }
  return objective.trim()
}

export function validateQuest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new QuestValidationError("expected a JSON object")
  }
  for (const field of REQUIRED_FIELDS) {
    if (!(field in value)) throw new QuestValidationError(`missing required field ${field}`)
  }
  for (const field of Object.keys(value)) {
    if (!ALLOWED_FIELDS.has(field)) throw new QuestValidationError(`unknown field ${field}`)
  }
  if (typeof value.id !== "string" || value.id.trim() === "") {
    throw new QuestValidationError("id must be a non-empty string")
  }
  validateObjective(value.objective)
  if (value.originalObjective !== undefined) validateObjective(value.originalObjective)
  if (!new Set(["active", "completed"]).has(value.status)) {
    throw new QuestValidationError('status must be "active" or "completed"')
  }
  for (const field of ["createdAt", "updatedAt"]) {
    if (!isTimestamp(value[field])) throw new QuestValidationError(`${field} must be an ISO-8601 timestamp`)
  }
  if (value.completedAt !== undefined && !isTimestamp(value.completedAt)) {
    throw new QuestValidationError("completedAt must be an ISO-8601 timestamp")
  }
  if (value.progress !== undefined && typeof value.progress !== "string") {
    throw new QuestValidationError("progress must be a string")
  }
  if (value.objectiveRevisions !== undefined) {
    if (!Array.isArray(value.objectiveRevisions)) throw new QuestValidationError("objectiveRevisions must be an array")
    for (const revision of value.objectiveRevisions) {
      if (!revision || typeof revision !== "object") throw new QuestValidationError("objective revision must be an object")
      validateObjective(revision.objective)
      if (!isTimestamp(revision.replacedAt)) throw new QuestValidationError("revision replacedAt must be an ISO-8601 timestamp")
    }
  }
  return value
}

export function questPath(projectRoot) {
  return join(projectRoot, ".opencode", "quest.json")
}

export async function readQuest(projectRoot) {
  try {
    return validateQuest(JSON.parse(await readFile(questPath(projectRoot), "utf8")))
  } catch (error) {
    if (error?.code === "ENOENT") return undefined
    throw error
  }
}

export async function writeQuest(projectRoot, quest) {
  validateQuest(quest)
  const destination = questPath(projectRoot)
  const directory = dirname(destination)
  const temporary = join(directory, `.quest.${process.pid}.${randomUUID()}.tmp`)
  await mkdir(directory, { recursive: true })

  let handle
  try {
    handle = await open(temporary, "wx", 0o600)
    await handle.writeFile(`${JSON.stringify(quest, null, 2)}\n`, "utf8")
    await handle.sync()
    await handle.close()
    handle = undefined
    await rename(temporary, destination)
  } catch (error) {
    await handle?.close().catch(() => {})
    await rm(temporary, { force: true }).catch(() => {})
    throw error
  }
}

export async function clearQuest(projectRoot) {
  await rm(questPath(projectRoot), { force: true })
}
