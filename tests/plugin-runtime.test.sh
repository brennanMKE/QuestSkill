#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OPENCODE_PLUGIN="${OPENCODE_PLUGIN_RUNTIME:-$HOME/.opencode/node_modules/@opencode-ai/plugin}"

if [ ! -d "$OPENCODE_PLUGIN" ]; then
  echo "OpenCode plugin runtime not found at $OPENCODE_PLUGIN" >&2
  exit 1
fi

RUNTIME_ROOT="$(mktemp -d /tmp/quest-plugin-test.XXXXXX)"
mkdir -p "$RUNTIME_ROOT/package" "$RUNTIME_ROOT/project" "$RUNTIME_ROOT/node_modules/@opencode-ai"
cp -R "$ROOT/quest/plugin" "$RUNTIME_ROOT/package/plugin"
ln -s "$OPENCODE_PLUGIN" "$RUNTIME_ROOT/node_modules/@opencode-ai/plugin"

RUNTIME_ROOT="$RUNTIME_ROOT" node --input-type=module <<'NODE'
const root = process.env.RUNTIME_ROOT
const mod = await import(`file://${root}/package/plugin/quest.js`)
const hooks = await mod.default({ directory: `${root}/project`, worktree: `${root}/project` })

await hooks.tool.quest_state.execute({ action: "create", objective: "Complete a long migration" }, {})
await hooks.tool.quest_checkpoint.execute({
  action: "save",
  summary: "Should not start",
  completed: [],
  currentStep: "Preflight",
  remaining: ["Work"],
  blockers: [],
  verification: [],
  nextAction: "Work",
}, {}).then(
  () => { throw new Error("checkpoint save bypassed missing instruction audit") },
  (error) => { if (!String(error).includes("missing or stale")) throw error },
)
await hooks.tool.quest_instruction_audit.execute({
  readiness: "warning",
  reviewedSources: ["AGENTS.md", "CLAUDE.md"],
  risks: [{
    source: "CLAUDE.md",
    trigger: "A tool fails",
    effect: "Stop and return",
    mitigation: "Checkpoint and use an allowed fallback first",
    severity: "warning",
  }],
}, {})
await import("node:fs/promises").then(({ writeFile }) => writeFile(`${root}/project/AGENTS.md`, "New stop rule\n"))
await hooks.tool.quest_checkpoint.execute({
  action: "save",
  summary: "Should not use stale audit",
  completed: [],
  currentStep: "Stale preflight",
  remaining: ["Work"],
  blockers: [],
  verification: [],
  nextAction: "Work",
}, {}).then(
  () => { throw new Error("checkpoint save bypassed stale instruction audit") },
  (error) => { if (!String(error).includes("missing or stale")) throw error },
)
await hooks.tool.quest_instruction_audit.execute({
  readiness: "warning",
  reviewedSources: ["AGENTS.md", "CLAUDE.md"],
  risks: [{
    source: "CLAUDE.md",
    trigger: "A tool fails",
    effect: "Stop and return",
    mitigation: "Checkpoint and use an allowed fallback first",
    severity: "warning",
  }],
}, {})
await hooks.tool.quest_checkpoint.execute({
  action: "save",
  summary: "Model migrated",
  completed: ["Model"],
  currentStep: "Service",
  remaining: ["Service", "Tests"],
  blockers: [],
  verification: ["Model tests passed"],
  nextAction: "Edit service.js",
}, {})

const system = { system: [] }
await hooks["experimental.chat.system.transform"]({}, system)
if (!system.system[0]?.includes("IN-FLIGHT CHECKPOINT")) throw new Error("checkpoint missing from system context")
if (!system.system[0]?.includes("Completed: Model")) throw new Error("completed work missing from system context")
if (!system.system[0]?.includes("Verification: Model tests passed")) throw new Error("verification missing from system context")
if (!system.system[0]?.includes("Readiness: WARNING")) throw new Error("instruction preflight missing from system context")
if (!system.system[0]?.includes("Checkpoint and use an allowed fallback first")) throw new Error("instruction mitigation missing from system context")

await hooks.tool.quest_instruction_audit.execute({
  readiness: "blocked",
  reviewedSources: ["AGENTS.md"],
  risks: [{
    source: "AGENTS.md",
    trigger: "Any question",
    effect: "Stop immediately",
    mitigation: "User must reconcile the rule",
    severity: "blocking",
  }],
}, {})
await hooks.tool.quest_checkpoint.execute({
  action: "save",
  summary: "Should remain blocked",
  completed: [],
  currentStep: "Blocked",
  remaining: ["Work"],
  blockers: ["Instruction conflict"],
  verification: [],
  nextAction: "Wait for user",
}, {}).then(
  () => { throw new Error("checkpoint save bypassed blocked instruction audit") },
  (error) => { if (!String(error).includes("preflight is blocked")) throw error },
)
await hooks.tool.quest_instruction_audit.execute({
  readiness: "warning",
  reviewedSources: ["AGENTS.md", "CLAUDE.md"],
  risks: [{
    source: "CLAUDE.md",
    trigger: "A tool fails",
    effect: "Stop and return",
    mitigation: "Checkpoint and use an allowed fallback first",
    severity: "warning",
  }],
}, {})

const compact = { context: [] }
await hooks["experimental.session.compacting"]({}, compact)
if (compact.context.length !== 2) throw new Error("compaction context incomplete")
if (!compact.context.join("\n").includes("next model turn")) throw new Error("compaction resume instruction missing")

await hooks.tool.quest_state.execute({ action: "complete" }, {})
const completed = JSON.parse(await hooks.tool.quest_state.execute({ action: "show" }, {}))
if (completed.status !== "completed" || completed.checkpoint !== undefined) {
  throw new Error("completion did not clear checkpoint")
}

await hooks.tool.quest_state.execute({ action: "create", objective: "Replacement quest" }, {})
await hooks.tool.quest_instruction_audit.execute({
  readiness: "clear",
  reviewedSources: ["AGENTS.md"],
  risks: [],
}, {})
await hooks.tool.quest_checkpoint.execute({
  action: "save",
  summary: "Started old scope",
  completed: [],
  currentStep: "Old step",
  remaining: ["Old step"],
  blockers: [],
  verification: [],
  nextAction: "Continue old scope",
}, {})
await hooks.tool.quest_state.execute({ action: "update", objective: "New scope" }, {})
const updated = JSON.parse(await hooks.tool.quest_state.execute({ action: "show" }, {}))
if (updated.checkpoint !== undefined) throw new Error("objective update retained stale checkpoint")
if (updated.instructionAudit !== undefined) throw new Error("objective update retained stale instruction audit")
NODE
