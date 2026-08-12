---
name: quest
description: Persistent objective and in-flight execution tracking across agent turns, context compaction, context exhaustion, and session boundaries. Use when the user sets or works on a high-level project objective, asks what is being accomplished, runs /quest show|status|update|complete|clear, resumes work after compaction, or needs a long multi-step task to continue without losing completed steps and the next action.
---

# QuestSkill — persistent objective tracking

A project-local quest tracker stored as `.opencode/quest.json`. The companion OpenCode plugin re-reads this file and injects an active objective into system context on every model turn. Use this skill for command semantics and repository-aware status and completion audits.

## State file location

```
<projectRoot>/.opencode/quest.json
```

The plugin deterministically uses OpenCode's `worktree` as the project root. Outside a Git worktree, it falls back to OpenCode's `directory`. Do not substitute a shell tool's incidental working directory. If `.opencode/` doesn't exist, the state tool creates it before writing.

## Quest model

```json
{
  "id": "<uuid>",
  "objective": "...",
  "originalObjective": "...",
  "objectiveRevisions": [],
  "status": "active" | "completed",
  "createdAt": "<ISO-8601>",
  "updatedAt": "<ISO-8601>",
  "progress": "...",
  "instructionAudit": {
    "readiness": "clear" | "warning" | "blocked",
    "reviewedSources": [],
    "risks": [],
    "instructionFilesFingerprint": "<SHA-256>",
    "updatedAt": "<ISO-8601>"
  },
  "checkpoint": {
    "summary": "...",
    "completed": [],
    "currentStep": "...",
    "remaining": [],
    "blockers": [],
    "verification": [],
    "nextAction": "...",
    "updatedAt": "<ISO-8601>"
  },
  "completedAt": "<ISO-8601>"
}
```

| Field | Type | Description |
|---|---|---|
| `id` | string | Stable UUID, never changed unless the user explicitly starts over after completion. Generated at creation time. |
| `objective` | string | The user's stated goal, updated only via `/quest update`. This is the text that gets injected into context on every turn. |
| `originalObjective` | string | Immutable objective captured when this Quest identity was created. |
| `objectiveRevisions` | array (optional) | Prior objective text and replacement timestamp, appended by `/quest update`. Do not inject this history on ordinary turns. |
| `status` | `"active"` or `"completed"` | Controlled by the agent via the `/quest complete` audit (see Phase 5) or `/quest clear`. |
| `createdAt` | ISO-8601 | Timestamp of creation. Set once, never modified. |
| `updatedAt` | ISO-8601 | Updated whenever the objective or status changes. |
| `progress` | string (optional) | User-authored or legacy progress text. Display it when present, but do not mutate it automatically during ordinary work. Repository evidence remains authoritative. |
| `instructionAudit` | object | Startup evaluation of applicable instructions that may force the agent to stop, ask, wait, or return before the Quest work is complete. |
| `checkpoint` | object (optional) | Durable execution handoff for an actively running multi-step task. It records completed work, current step, remaining work, blockers, verification evidence, and the exact next action. |
| `completedAt` | ISO-8601 (optional) | Set when the agent marks the quest as completed. Leave blank while status is `"active"`. |

## FILE MANAGEMENT PROTOCOL

This is the foundation of everything. The agent must follow this strictly — no exceptions, no shortcuts.

1. **Always re-read before mutate.** Never cache quest state in session memory across turns without a corresponding file read. Before every action (show, update, complete, clear), the agent MUST `Read` the file to get current state.
2. **Atomic write.** Use the plugin's `quest_state` tool for mutations. It writes a sibling temporary file, flushes it, and atomically renames it over `quest.json`. Never implement a direct truncate-and-write replacement in shell commands.
3. **Validate on read.** The state tool enforces the documented fields, non-empty objectives, allowed statuses, timestamps, revision shape, and rejects unknown fields. Relay its actionable error and do not discard or overwrite invalid state.
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

The plugin injects effective system context on every model turn while the Quest is active. This unconditional internal injection is intentional: it guarantees rediscovery after a new session or compaction. Do not repeat the block in visible response text for Quest commands, greetings, or unrelated requests. Completed, cleared, and missing Quests are not injected.

### Compactness
Inject the objective and constraint paragraph. When an in-flight checkpoint exists, also inject its compact resume fields. Do NOT inject timestamps, IDs, objective history, or audit logs.

### Fresh reads
Always re-read `.opencode/quest.json` at the top of your response processing — never rely on previously cached quest context. After any `/quest` command that mutates the file (update, complete, clear), re-read to confirm the write succeeded.

## /quest commands

The agent MUST recognize and handle these exact `/quest` command patterns. If the user writes `/quest` without a recognized subcommand, show them the help text below.

Reject empty or whitespace-only objectives for create and update. If persistence fails, report the filesystem error and leave the prior Quest unchanged; never claim success before the state tool returns successfully.

### `/quest <objective>` — create or set a quest

When the user invokes this pattern:
1. Read `.opencode/quest.json`. If it exists and `status === "active"`, warn the user: "There is already an active quest. What would you like to do? (a) replace it with a new quest, or (b) clear the existing one first?" Wait for user input before proceeding.
2. If no file exists, or status is `"completed"`: create a new quest object with the given objective text. Generate a UUID for `id`. Set `status: "active"`, fill `createdAt` and `updatedAt` with current ISO-8601 timestamp.
3. Write the new quest object to `.opencode/quest.json` using the FILE MANAGEMENT PROTOCOL above.
4. Before confirming readiness or beginning work, run the mandatory **Instruction preflight** below and persist it with `quest_instruction_audit`.
5. Report the Quest objective and readiness. For `warning`, enumerate the risks and mitigations before continuing. For `blocked`, do not begin work; ask the user to resolve the conflicting instruction. For `clear`, state that no premature-stop conditions were found.
6. If `.opencode/quest.json` is not already ignored or intentionally tracked, mention once that `/.opencode/quest.json` can be added to the consuming repository's `.gitignore`. Do not edit ignore rules without permission.

Do not write generated progress notes after ordinary project turns. The v1 command set has no implicit progress mutation; `/quest status` computes its assessment from current evidence without saving it.

## Mandatory instruction preflight

Run this preflight whenever a Quest is created, when `/quest audit` is invoked, when the objective changes materially, or when applicable instruction files change. Do not start substantive Quest work without a current audit.

1. Discover and read every applicable instruction source from the project root through the target files, including all `AGENTS.md`, `CLAUDE.md`, project-local agent rules, named planning documents, loaded skill instructions, and visible system/developer/user constraints. Record the source paths or instruction-layer names.
2. Search semantically—not just by keyword—for any condition that can interrupt persistence. Include rules that say or imply: stop; ask before proceeding; report and return; make only one attempt; bail after a tool/build/test failure; wait for approval; do not fix; do not implement; hand work back; final action must be a specific command; or a tool/permission is unavailable.
3. For each risk, record:
   - `source`: exact file path or instruction layer
   - `trigger`: the condition that activates it
   - `effect`: how it could pause or terminate Quest work
   - `mitigation`: a compliant way to reduce surprise, such as asking required questions up front, checkpointing before a required stop, choosing an allowed alternative tool, or sequencing verification correctly
   - `severity`: `warning` when execution can proceed with mitigation; `blocking` when instructions conflict or require user action before work
4. Set readiness:
   - `clear`: no risks; `risks` must be empty
   - `warning`: risks exist but each has a compliant mitigation
   - `blocked`: at least one applicable instruction prevents safe continuous execution until the user resolves it
5. Save the complete result with `quest_instruction_audit`. Never claim the audit is clear without listing the sources actually reviewed.
6. Present warnings before implementation. Be explicit that the Quest cannot override higher-priority instructions. Do not silently reinterpret “stop,” “ask,” or tool restrictions as optional.
7. The plugin fingerprints all discovered `AGENTS.md` and `CLAUDE.md` files outside ignored build/vendor directories. Adding, removing, moving, or editing one makes the audit stale and restores the hard preflight gate. The plugin also refuses to save an execution checkpoint while the audit is missing, stale, or blocked.

If no `instructionAudit` exists on a legacy active Quest, the injected `QUEST PREFLIGHT REQUIRED` block is a hard gate: perform the audit before resuming implementation.

### `/quest audit` — re-evaluate instruction risks

Re-run the mandatory instruction preflight against the current Quest and current instruction files. Replace the prior `instructionAudit`, report changes in readiness or risks, and resume only when readiness is `clear` or `warning` with actionable mitigations.

## Long-running execution and context exhaustion

Treat a context limit as a recoverable continuation boundary, not a reason to stop the Quest or return control to the user.

1. Before beginning a long multi-step implementation or any broad/structural edit, call `quest_checkpoint` with `action: "save"`. Record the planned steps in `remaining`, the first `currentStep`, and an executable `nextAction`.
2. After every meaningful milestone, test run, commit, failure, or change of approach, save a fresh checkpoint. Keep it concise and factual; repository state remains authoritative.
3. When context is getting tight, checkpoint before reading another large file, running a broad investigation, or starting another implementation phase. Prefer a safe persisted boundary over trying to squeeze the remainder into one turn.
4. After compaction or on the next model turn, read the injected IN-FLIGHT CHECKPOINT, verify it against repository state, and continue `nextAction`. Do not answer only that context ran out and do not ask the user to repeat the prompt. If OpenCode automatically starts a post-compaction turn, continue without waiting for “continue.” If the host hard-stops without starting another model turn, durable state is preserved and execution resumes when the user or host next invokes the agent.
5. If the checkpoint is stale, repair it from repository evidence and continue. If genuinely blocked by missing authority or user input, save the blocker and ask the smallest necessary question.
6. Clear the checkpoint only when the in-flight task is finished, deliberately abandoned by the user, or superseded by a new execution plan. Completing or clearing the Quest also removes its checkpoint.

The checkpoint is operational state, distinct from the optional `progress` note. Do not checkpoint greetings, single-step edits, status-only requests, or work unrelated to the active Quest.

## Execution persistence and safe recovery

Once work on the active Quest has begun and a checkpoint exists, treat the current task as persistent. Keep taking safe, relevant actions until it is complete or a genuine blocker requires user input or new authority.

Before editing, resolve and verify the exact target path using repository search or file listing; do not rely on memory of which target or directory owns a symbol. The plugin injects this baseline safety rule for every active Quest, even if the agent has not yet created the required checkpoint.

Never treat these as terminal blockers by themselves:

- a compile, lint, or test failure
- an unfamiliar file or missing remembered detail
- a failed edit or an error that changed after an edit
- context pressure or compaction
- uncertainty that can be resolved by inspecting repository state, history, or current diagnostics

When an edit or verification fails:

1. Stop making speculative edits. Save a checkpoint containing the exact current error and recovery action.
2. Re-read the current file and `git diff`; diagnose the first error produced by the current working-tree state. Do not chase output from an earlier state.
3. Preserve recoverability. Before a broad or structural edit, inspect the full target and retain a known-good source from the current file, Git history, or a temporary backup. Never overwrite an existing non-generated source file wholesale with `cat >`, a heredoc, or a partial reconstruction.
4. Make the smallest reversible edit that tests one diagnosis. Re-run the narrowest useful check. Update the checkpoint after each attempt.
5. If an edit makes the state worse, undo only that edit using the saved content or a precise reverse patch. Do not discard unrelated user changes and do not use destructive Git commands.
6. Continue through ordinary failures. Stop only when required user information/authority is unavailable, an external dependency cannot be reached after reasonable retries, or every safe recovery source is exhausted. Save the blocker, evidence, and exact resume action before asking the user.

A failure report is supporting evidence, not task completion. Do not end with a report while a safe repository inspection, recovery, implementation, or verification action remains.

### `/quest show` — display current quest

1. Read `.opencode/quest.json`. If no file exists, say: "No active quest. Run `/quest <objective>` to set one." and stop.
2. Display:
   - The objective (full text)
   - Status (`active` or `completed`)
   - Created timestamp
   - Last updated timestamp
   - Progress note (if present)
   - Instruction-audit readiness and risk summary (if present); say preflight is required if absent on an active Quest

Do not include the `id` in the display — it's internal bookkeeping.

### `/quest status` — evaluate progress against the objective

This is NOT a metadata display — it's a real assessment. After reading quest.json:
1. Examine the current repo state (run `git status`, inspect recent git logs, look at modified files).
2. Re-check whether the persisted instruction audit is present and still current. If instruction files changed, run `/quest audit` semantics before assessing readiness.
3. Evaluate the user's stated objective against what has actually changed in the repo.
4. Provide a concise assessment answering: What's done? What remains? Are there blockers—including instruction risks? Is the quest actually complete based on real evidence?
5. Do NOT just regurgitate stored metadata — synthesize context from the repo and conversation to give a genuine progress evaluation.

### `/quest update <new-objective>` — change the objective

1. Read `.opencode/quest.json`. If no file exists, say "No active quest — run `/quest <objective>` first."
2. Replace the `objective` with the new text, append the prior objective to revision history, and update `updatedAt`.
3. Clear the in-flight checkpoint and prior instruction audit because both may be stale for the new objective. Write back via FILE MANAGEMENT PROTOCOL.
4. Immediately run and persist a new mandatory instruction preflight. Create a new checkpoint only when execution begins against the updated objective.
5. Confirm the updated objective and its new readiness/risk summary.

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
  /quest audit           Re-evaluate instructions that could stop work prematurely
  /quest update <obj>    Change the quest objective
  /quest complete        Audit and mark the quest as completed (requires real evidence)
  /quest clear           Remove the active quest
```

## Completion audit (QuestAuditor logic)

When `/quest complete` is invoked, run the following audit sequence. Do NOT skip it — this is what distinguishes genuine completion from optimistic agreement.

### Audit steps
1. Re-read `originalObjective`, the current `objective`, and `objectiveRevisions` from `.opencode/quest.json`. Evaluate the current objective while using revisions to retain constraints and explain how scope changed.
2. Examine the current repo state: run `git status`, check modified/added/deleted files, look at git log for recent commits related to the quest.
3. Read any relevant source files that were changed during work on this quest — verify the changes actually implement what was requested, not just stubs or partial implementations.
4. Check for outstanding TODOs, FIXMEs, known errors, and compromises made during work (these are often visible in the conversation history or in code comments).
5. Consider all requirements explicitly or implicitly stated during work on this quest — if the conversation contains requests that weren't addressed, note them.
6. Evaluate: is the objective GENUINELY satisfied? Not "checklist done" — did the user's stated intent actually get achieved?

### Audit output
Present findings as a short summary:
- "What was asked:" — the current objective verbatim; mention the original objective when it materially differs
- "Evidence of completion:" — what files were changed, what was implemented
- "Potential gaps:" — any incomplete work, open TODOs, known issues (or state none found)
- "Verdict:" — complete or incomplete

If the verdict is **incomplete**: explain what remains, leave status as `"active"`.
If the verdict is **complete** and no `--force`: flip status to `"completed"`, set `completedAt`.
If the verdict is **complete** with `--force`: flip status regardless of gaps, set `completedAt`, note force-complete.

## Compaction resilience

The companion plugin uses OpenCode's `experimental.session.compacting` hook to add the freshly loaded active Quest, in-flight checkpoint, and explicit resume requirements to compaction context. It uses `experimental.chat.system.transform` to reload the same durable state on subsequent turns. The plugin does not itself create a new model turn after a host-level hard stop; it guarantees that the next turn can resume without reconstructing work from chat history. The persistent file remains the source of truth.

## INSTALL INSTRUCTIONS (for the operator, not the agent)

This skill lives in `~/.config/opencode/skills/quest/` after installation via `./install.sh`. The install script creates a symlink from the repo's `quest/` folder into that directory, making it discoverable by OpenCode's skill loader.
