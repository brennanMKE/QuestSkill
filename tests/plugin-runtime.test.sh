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
NODE
