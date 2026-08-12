---
name: quest
description: Persistent objective tracking across agent turns and session boundaries. When triggered, read .opencode/quest.json from the project root to discover any active quest, inject its objective as an ACTIVE QUEST block into every relevant response, and respond to /quest commands (show, status, update, complete, clear). Use this skill whenever the user wants to set a high-level objective for the current project, ask "what are we trying to accomplish?", runs /quest show|status|update|complete|clear, or when the agent detects drift from a stated goal across many turns.
---

# QuestSkill — persistent objective tracking

A project-local quest tracker stored as `.opencode/quest.json`. The companion OpenCode plugin re-reads this file and injects an active objective into system context on every model turn. Use this skill for command semantics and repository-aware status and completion audits.

## State file location

```
<projectRoot>/.opencode/quest.json
```

The project root is the current working directory or git worktree. If `.opencode/` doesn't exist, create it (directory + parent if needed) before writing the file.

## Quest model

```json
{
  "id": "<uuid>",
  "objective": "...",
  "status": "active" | "completed",
  "createdAt": "<ISO-8601>",
  "updatedAt": "<ISO-8601>",
  "progress": "...",
  "completedAt": "<ISO-8601>"
}
```

| Field | Type | Description |
|---|---|---|
| `id` | string | Stable UUID, never changed unless the user explicitly starts over after completion. Generated at creation time. |
| `objective` | string | The user's stated goal, updated only via `/quest update`. This is the text that gets injected into context on every turn. |
| `status` | `"active"` or `"completed"` | Controlled by the agent via the `/quest complete` audit (see Phase 5) or `/quest clear`. |
| `createdAt` | ISO-8601 | Timestamp of creation. Set once, never modified. |
| `updatedAt` | ISO-8601 | Updated whenever the objective or status changes. |
| `progress` | string (optional) | Short human-readable summary of progress notes accumulated during work. The agent updates this incrementally as it makes meaningful headway on the quest — not every message, only substantive advances. |
| `completedAt` | ISO-8601 (optional) | Set when the agent marks the quest as completed. Leave blank while status is `"active"`. |

## FILE MANAGEMENT PROTOCOL

This is the foundation of everything. The agent must follow this strictly — no exceptions, no shortcuts.

1. **Always re-read before mutate.** Never cache quest state in session memory across turns without a corresponding file read. Before every action (show, update, complete, clear), the agent MUST `Read` the file to get current state.
2. **Atomic write.** Read → validate → mutate → write back the entire file. Never overwrite with empty or partial data.
3. **Validate on read.** After reading, check that the file contains valid JSON with at least `id`, `objective`, and `status` fields. If parsing fails, emit a clear error: "Could not parse `.opencode/quest.json` — contents appear corrupted. What would you like to do?" Don't silently discard or overwrite.
4. **Check directory existence first.** If `.opencode/` doesn't exist, create it before writing quest.json. Use mkdir -p if supported, or the File tool's parent directory handling.
5. **No quest state in history.** Quest context lives exclusively in the file on disk, not in chat messages. The ACTIVE QUEST block is injected fresh each turn from the file contents.

## Active quest context injection (MOST IMPORTANT)

The OpenCode plugin injects an ACTIVE QUEST block into effective system context whenever `status === "active"`. Treat that block as persistent context; do not duplicate it in visible response text unless the user asks to see the Quest.

The block format is literal — copy exactly:

```
ACTIVE QUEST

<quest objective>

Treat this as the persistent high-level objective for the current project. The user's current message is the immediate task, but decisions should remain consistent with this Quest unless the user explicitly changes or clears it.
```

Replace `<quest objective>` with the exact `objective` text from quest.json — do NOT modify, summarize, or paraphrase it.

### When to inject
- The quest file exists and `status === "active"`.
- The user's message is related to project work (coding, architecture, debugging, design — almost everything in this project).

### When NOT to inject
- No quest file exists or the quest has been cleared.
- `status === "completed"` — do not inject completed quests; the agent should note completion is recorded but move on.
- The user's message is a quest command itself (`/quest show`, `/quest status`, etc.) — respond directly to the command without the block.
- The user explicitly asks about quest state in plain language ("What's our goal?", "Show me the quest") — respond without the block.
- The user sends a short greeting unrelated to project work (e.g., "hey", "thanks") — respond naturally without the block.

### Compactness
Inject ONLY the objective text and the constraint paragraph above it. Do NOT inject timestamps, IDs, progress summaries, audit history, or any other metadata into the block on every turn.

### Fresh reads
Always re-read `.opencode/quest.json` at the top of your response processing — never rely on previously cached quest context. After any `/quest` command that mutates the file (update, complete, clear), re-read to confirm the write succeeded.

## /quest commands

The agent MUST recognize and handle these exact `/quest` command patterns. If the user writes `/quest` without a recognized subcommand, show them the help text (shown in Phase 2 step below).

### `/quest <objective>` — create or set a quest

When the user invokes this pattern:
1. Read `.opencode/quest.json`. If it exists and `status === "active"`, warn the user: "There is already an active quest. What would you like to do? (a) replace it with a new quest, or (b) clear the existing one first?" Wait for user input before proceeding.
2. If no file exists, or status is `"completed"`: create a new quest object with the given objective text. Generate a UUID for `id`. Set `status: "active"`, fill `createdAt` and `updatedAt` with current ISO-8601 timestamp.
3. Write the new quest object to `.opencode/quest.json` using the FILE MANAGEMENT PROTOCOL above.
4. Confirm with the user: "Quest created: `<objective>`" — no verbose metadata, just confirmation that the objective is active.

### `/quest show` — display current quest

1. Read `.opencode/quest.json`. If no file exists, say: "No active quest. Run `/quest <objective>` to set one." and stop.
2. Display:
   - The objective (full text)
   - Status (`active` or `completed`)
   - Created timestamp
   - Last updated timestamp
   - Progress note (if present)

Do not include the `id` in the display — it's internal bookkeeping.

### `/quest status` — evaluate progress against the objective

This is NOT a metadata display — it's a real assessment. After reading quest.json:
1. Examine the current repo state (run `git status`, inspect recent git logs, look at modified files).
2. Evaluate the user's stated objective against what has actually changed in the repo.
3. Provide a concise assessment answering: What's done? What remains? Are there blockers? Is the quest actually complete based on real evidence?
4. Do NOT just regurgitate stored metadata — synthesize context from the repo and conversation to give a genuine progress evaluation.

### `/quest update <new-objective>` — change the objective

1. Read `.opencode/quest.json`. If no file exists, say "No active quest — run `/quest <objective>` first."
2. Replace only the `objective` field with the new text. Update `updatedAt` to current timestamp.
3. Write back via FILE MANAGEMENT PROTOCOL.
4. Confirm: "Objective updated to: `<new-objective>`" — next response will reflect the new objective.

### `/quest complete [--force]` — audit and close the quest

1. Read `.opencode/quest.json`. If no file exists or status is already `"completed"`, inform the user.
2. Run the **completion audit** (see Phase 5 instructions below). Present findings clearly — what was asked, what evidence shows it's done, and any gaps.
3. If the audit passes (objective genuinely satisfied): flip `status` to `"completed"`, set `completedAt` to current timestamp, write back. Present a concise completion summary.
4. If the audit finds incomplete work: explain what remains, do NOT flip status to completed. Leave quest active.
5. If `--force` flag is present (or user says "complete it anyway"): run audit, show findings, then unconditionally flip status to completed with a note that this was force-completed.

### `/quest clear` — remove the quest

1. Read `.opencode/quest.json`. If no file exists, say so and stop.
2. Delete the `.opencode/quest.json` file (using Bash rm or File tool delete).
3. Confirm: "Quest cleared." — subsequent responses will no longer inject the ACTIVE QUEST block.

### Help text (when `/quest` is invoked without subcommand or with unrecognized arg)
```
Available /quest commands:
  /quest <objective>     Create or set a new quest objective
  /quest show            Show the current quest details
  /quest status          Assess progress against the objective (real evaluation, not just metadata)
  /quest update <obj>    Change the quest objective
  /quest complete        Audit and mark the quest as completed (requires real evidence)
  /quest clear           Remove the active quest
```

## Completion audit (QuestAuditor logic)

When `/quest complete` is invoked, run the following audit sequence. Do NOT skip it — this is what distinguishes genuine completion from optimistic agreement.

### Audit steps
1. Re-read the quest's original objective from `.opencode/quest.json`. This is what needs to be evaluated.
2. Examine the current repo state: run `git status`, check modified/added/deleted files, look at git log for recent commits related to the quest.
3. Read any relevant source files that were changed during work on this quest — verify the changes actually implement what was requested, not just stubs or partial implementations.
4. Check for outstanding TODOs, FIXMEs, known errors, and compromises made during work (these are often visible in the conversation history or in code comments).
5. Consider all requirements explicitly or implicitly stated during work on this quest — if the conversation contains requests that weren't addressed, note them.
6. Evaluate: is the objective GENUINELY satisfied? Not "checklist done" — did the user's stated intent actually get achieved?

### Audit output
Present findings as a short summary:
- "What was asked:" — the original objective (verbatim)
- "Evidence of completion:" — what files were changed, what was implemented
- "Potential gaps:" — any incomplete work, open TODOs, known issues (or state none found)
- "Verdict:" — complete or incomplete

If the verdict is **incomplete**: explain what remains, leave status as `"active"`.
If the verdict is **complete** and no `--force`: flip status to `"completed"`, set `completedAt`.
If the verdict is **complete** with `--force`: flip status regardless of gaps, set `completedAt`, note force-complete.

## Compaction resilience

The companion plugin uses OpenCode's `experimental.session.compacting` hook to add the freshly loaded active Quest to compaction context. It also uses `experimental.chat.system.transform` to reload the file on subsequent turns. The persistent file remains the source of truth; never rely on the compaction summary or chat history as authoritative state.

## INSTALL INSTRUCTIONS (for the operator, not the agent)

This skill lives in `~/.config/opencode/skills/quest/` after installation via `./install.sh`. The install script creates a symlink from the repo's `quest/` folder into that directory, making it discoverable by OpenCode's skill loader.
