import { randomUUID } from "node:crypto"
import { mkdir, open, readFile, rename, rm } from "node:fs/promises"
import { dirname, join } from "node:path"

const REQUIRED_FIELDS = ["id", "objective", "status", "createdAt", "updatedAt"]
const ALLOWED_FIELDS = new Set([
  ...REQUIRED_FIELDS,
  "originalObjective",
  "objectiveRevisions",
  "progress",
  "checkpoint",
  "instructionAudit",
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
  if (value.checkpoint !== undefined) {
    const checkpoint = value.checkpoint
    if (!checkpoint || typeof checkpoint !== "object" || Array.isArray(checkpoint)) {
      throw new QuestValidationError("checkpoint must be an object")
    }
    const allowedCheckpointFields = new Set([
      "summary",
      "completed",
      "currentStep",
      "remaining",
      "blockers",
      "verification",
      "nextAction",
      "updatedAt",
    ])
    for (const field of Object.keys(checkpoint)) {
      if (!allowedCheckpointFields.has(field)) throw new QuestValidationError(`unknown checkpoint field ${field}`)
    }
    for (const field of ["summary", "currentStep", "nextAction"]) {
      if (typeof checkpoint[field] !== "string" || checkpoint[field].trim() === "") {
        throw new QuestValidationError(`checkpoint ${field} must contain text`)
      }
    }
    for (const field of ["completed", "remaining", "blockers"]) {
      if (!Array.isArray(checkpoint[field]) || checkpoint[field].some((item) => typeof item !== "string")) {
        throw new QuestValidationError(`checkpoint ${field} must be an array of strings`)
      }
    }
    if (checkpoint.verification !== undefined && (!Array.isArray(checkpoint.verification) || checkpoint.verification.some((item) => typeof item !== "string"))) {
      throw new QuestValidationError("checkpoint verification must be an array of strings")
    }
    if (!isTimestamp(checkpoint.updatedAt)) {
      throw new QuestValidationError("checkpoint updatedAt must be an ISO-8601 timestamp")
    }
  }
  if (value.instructionAudit !== undefined) {
    const audit = value.instructionAudit
    if (!audit || typeof audit !== "object" || Array.isArray(audit)) {
      throw new QuestValidationError("instructionAudit must be an object")
    }
    const allowedAuditFields = new Set(["readiness", "reviewedSources", "risks", "instructionFilesFingerprint", "updatedAt"])
    for (const field of Object.keys(audit)) {
      if (!allowedAuditFields.has(field)) throw new QuestValidationError(`unknown instructionAudit field ${field}`)
    }
    if (!new Set(["clear", "warning", "blocked"]).has(audit.readiness)) {
      throw new QuestValidationError('instructionAudit readiness must be "clear", "warning", or "blocked"')
    }
    if (!Array.isArray(audit.reviewedSources) || audit.reviewedSources.length === 0 || audit.reviewedSources.some((item) => typeof item !== "string" || item.trim() === "")) {
      throw new QuestValidationError("instructionAudit reviewedSources must contain non-empty source names")
    }
    if (!Array.isArray(audit.risks)) throw new QuestValidationError("instructionAudit risks must be an array")
    for (const risk of audit.risks) {
      if (!risk || typeof risk !== "object" || Array.isArray(risk)) {
        throw new QuestValidationError("instructionAudit risk must be an object")
      }
      const allowedRiskFields = new Set(["source", "trigger", "effect", "mitigation", "severity"])
      for (const field of Object.keys(risk)) {
        if (!allowedRiskFields.has(field)) throw new QuestValidationError(`unknown instructionAudit risk field ${field}`)
      }
      for (const field of ["source", "trigger", "effect", "mitigation"]) {
        if (typeof risk[field] !== "string" || risk[field].trim() === "") {
          throw new QuestValidationError(`instructionAudit risk ${field} must contain text`)
        }
      }
      if (!new Set(["warning", "blocking"]).has(risk.severity)) {
        throw new QuestValidationError('instructionAudit risk severity must be "warning" or "blocking"')
      }
    }
    if (audit.readiness === "clear" && audit.risks.length !== 0) {
      throw new QuestValidationError("a clear instructionAudit cannot contain risks")
    }
    if (audit.readiness === "warning" && (audit.risks.length === 0 || audit.risks.some((risk) => risk.severity !== "warning"))) {
      throw new QuestValidationError("a warning instructionAudit requires one or more warning-only risks")
    }
    if (audit.risks.some((risk) => risk.severity === "blocking") && audit.readiness !== "blocked") {
      throw new QuestValidationError("any blocking instruction risk requires blocked readiness")
    }
    if (audit.readiness === "blocked" && !audit.risks.some((risk) => risk.severity === "blocking")) {
      throw new QuestValidationError("a blocked instructionAudit requires a blocking risk")
    }
    if (!isTimestamp(audit.updatedAt)) {
      throw new QuestValidationError("instructionAudit updatedAt must be an ISO-8601 timestamp")
    }
    if (typeof audit.instructionFilesFingerprint !== "string" || !/^[a-f0-9]{64}$/.test(audit.instructionFilesFingerprint)) {
      throw new QuestValidationError("instructionAudit instructionFilesFingerprint must be a SHA-256 hex string")
    }
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
