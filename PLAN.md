# QuestSkill Implementation Plan

Based on `opencode-quest-plugin-spec.md`. Implement sequentially. Do not stop until every step below is complete and the manual acceptance test passes.

## Repository layout (MUST match this)

```
QuestSkill/                       ← repo root (DO NOT put implementation code here)
  quest/                          ← contains the skill + optional companion files (like esp32-guidance/)
    SKILL.md                      ← agent instructions / skill doc — primary implementation artifact
  install.sh                      ← install script (link quest/ into AI tool skills dirs)
  .gitignore
  README.md
  PLAN.md                         ← this file
  LICENSE
```

This matches the existing `ESP32GuidanceSkill/esp32-guidance/` layout: everything that gets linked into OpenCode's skills directory lives in `quest/`, not at the repo root.

## Architecture decision — Plugin with companion skill

> Implementation update: OpenCode 1.18.16 exposes `experimental.chat.system.transform`, `experimental.session.compacting`, custom tools, and command files. The completed architecture therefore uses `quest/plugin/quest.js` for lifecycle hooks and atomic state operations, `quest/command/quest.md` for `/quest` registration, and `quest/SKILL.md` for repository-aware audit guidance. The earlier skill-only investigation below is retained as decision history but is superseded by this implementation result.

OpenCode's extension model has two layers:
- **Skills** (`SKILL.md` in a folder, discovered by name + description) — agent instructions loaded on demand via the `skill` tool. This is how every existing skill (esp32-guidance, swift-guidance, issues, mac-release, xcode-build, xcode-cleanup) is implemented.
- **Plugins** (TypeScript/JS modules in `.opencode/plugins/` or `~/.config/opencode/plugins/`, registered in `tui.json`) — hook into events like `session.compacted`, register custom tools, etc.

Given the spec requirements and OpenCode's actual API surface:
- The `/quest *` command family is naturally expressed as **agent instructions** in SKILL.md. The agent itself executes the commands by reading/writing `.opencode/quest.json` (a project-local file).
- The "context injection" requirement is handled by the SKILL.md instructing the agent to read `.opencode/quest.json` at the top of every response and prepend an ACTIVE QUEST block when one exists. This is how existing agent skills inject domain context (see esp32-guidance, swift-guidance).
- **Compaction resilience** is the trickiest requirement: `experimental.session.compacting` (a plugin hook) can inject quest context into the compaction summary, but if a full TypeScript plugin is overkill for v1, the skill can instruct the agent to re-read `.opencode/quest.json` after compaction. The spec says "Investigate OpenCode's plugin APIs first" — Phase 0 makes that explicit.

Decision: **v1 implements this as a skill (SKILL.md only)**, following the pattern of all existing skills. The file-based persistence (`quest.json`) is managed by agent instructions, not a separate TypeScript store module. This keeps the implementation minimal and idiomatic.

The companion note at Phase 7 documents whether an `experimental.session.compacting` plugin hook was used for compaction resilience or if skill-level instructions suffice.

## Phase 0 — Investigate OpenCode APIs (mandatory first step)

1. Inspect the current OpenCode repository/version and docs available in this project to identify:
   - The exact location where OpenCode discovers skills (confirmed by `opencode help` + `opencode skill` if available)
   - The `experimental.session.compacting` hook signature (from `/docs/plugins`) — determine if quest context can be injected into compaction via a plugin
   - How agent skills inject persistent context (read existing skill SKILL.md files for patterns)
2. Review the `session.compacted` and `experimental.session.compacting` hook signatures to decide: can quest persistence survive compaction purely through skill-level instructions, or do we need a plugin hook?
3. Write a short implementation plan summarizing:
   - Where the skill lives after install (e.g. `~/.config/opencode/skills/quest/`)
   - How quest state is stored (`${projectRoot}/.opencode/quest.json` — project-local)
   - How context injection works (skill instructions to read quest file each turn)
   - How compaction resilience works (either skill-level re-read + instruction, or an optional `experimental.session.compacting` plugin if that's the most reliable path)
   - How commands are registered (skill instructions for `/quest *` subcommands, not a separate command module)

## Phase 1 — Core data layer (`quest.json`)

4. Define the `Quest` model (human-readable JSON in `.opencode/quest.json`):
   ```json
   {
     "id": "uuid-string",
     "objective": "...",
     "status": "active" | "completed",
     "createdAt": "ISO-8601 timestamp",
     "updatedAt": "ISO-8601 timestamp",
     "progress": "...",       // optional, short text summary of progress notes
     "completedAt": "..."     // optional ISO-8601 timestamp
   }
   ```
5. Write skill instructions for `QuestStore` behavior:
   - Path: `<projectRoot>/.opencode/quest.json`. The project root is inferred from the current working directory or git worktree.
   - If `.opencode/` doesn't exist, create it before writing quest.json.
   - All writes are atomic: read → validate → mutate → write back. Never overwrite with empty/unparseable data.
   - Corrupt file → actionable error message, do NOT silently discard the user's objective.
6. Handle errors gracefully in agent instructions: no quest, empty objective, corrupt persisted file (actionable error), persistence write failure.

## Phase 2 — Command definitions (`/quest *`)

7. Write SKILL.md instructions for the `/quest` command family with these exact semantics:
   - `/quest <objective>` — read current quest.json if it exists. If status is "active", warn that an active quest already exists and ask whether to replace or clear first. If no file exists, create a new quest with the given objective and set status to "active".
   - `/quest show` — read quest.json, display current objective + status + timestamps. If no file exists or quest has been cleared/deleted, say so clearly and explain how to create one.
   - `/quest status` — read quest.json, evaluate current repo/session state against the active quest. Produce a real assessment (what's done, what remains, blockers, is it actually complete?). Do NOT just display stored metadata.
   - `/quest update <objective>` — read quest.json, replace the objective text, update `updatedAt`, keep same id and status. Immediately start injecting new objective into context.
   - `/quest complete [--force]` — run an audit (see Phase 5). If incomplete, explain what remains and leave quest active. Only flip status to "completed" + set completedAt when the audit genuinely passes. `--force` supported only if the OpenCode command system makes it idiomatic (otherwise tell the user what remains and ask for confirmation).
   - `/quest clear` — delete or null out the quest state file. No audit needed. Stop injecting quest context on subsequent turns.

## Phase 3 — Context injection (MOST IMPORTANT)

8. Write SKILL.md instructions for automatic context injection. The agent MUST prepend an ACTIVE QUEST block to every response when a quest is active and the user's request is related to project work. The block format:

   ```
   ACTIVE QUEST

   <quest objective>

   Treat this as the persistent high-level objective for the current project. The user's current message is the immediate task, but decisions should remain consistent with this Quest unless the user explicitly changes or clears it.
   ```

9. Keep injection compact: just objective + essential constraints (if any stored). Do NOT inject timestamps, IDs, history, audit logs, or verbose progress into the ACTIVE QUEST block on every turn.
10. Do NOT inject when: there is no active quest, the user explicitly asks about quest state (show/status), or the user's request is completely unrelated to project work.
11. When the objective is updated via `/quest update`, the new text must be used immediately in subsequent responses.

## Phase 4 — Compaction resilience

12. Strategy decision (documented in implementation note at Phase 7):
    - **Option A (skill-only, v1 default):** Instruct the agent in SKILL.md to re-read `.opencode/quest.json` at the start of every response after a new session or compaction event. The persistent file is always re-injected into context. This works if the agent consistently checks for active quest on each turn.
    - **Option B (plugin hook):** If compaction reliably discards context before the agent can re-read, implement an `experimental.session.compacting` plugin hook (TypeScript module in `.opencode/plugins/`) that injects the quest objective into the compaction summary. This is more reliable but adds complexity.
13. Whichever option, persistent file remains the source of truth — never rely solely on chat history for quest existence.
14. The agent should always attempt to re-read `.opencode/quest.json` at the start of a response if it doesn't already have quest context loaded.

## Phase 5 — Completion audit logic (`QuestAuditor`)

15. Write SKILL.md instructions for the completion audit. When `/quest complete` is invoked, the agent MUST:
    - Re-read the quest's original objective from `.opencode/quest.json`
    - Examine current repo state (git diff, modified files, test results if available)
    - Consider all requirements explicitly or implicitly stated during work on this quest
    - Check outstanding TODOs, known errors, compromises made
    - Evaluate whether the original objective is genuinely satisfied — not just "checklist done"
16. If audit finds incomplete work → explain what remains, leave quest active (status stays "active").
17. If audit passes → set status to "completed" + `completedAt` timestamp, present a concise completion summary.
18. If user requests force-complete (`/quest complete --force` or "complete it anyway"), still run the audit and present findings, then allow explicit override.

## Phase 6 — Tests (manual + automated where supported)

19. Manual / acceptance tests (these are the real verification):
    - Create quest: `/quest <objective>` — verify `/.opencode/quest.json` exists with correct schema
    - Persist across restart: close OpenCode, reopen in same project, `What are we trying to accomplish?` — agent identifies the active quest
    - Persist across compaction: force or wait for compaction, then ask agent to show quest — still present
    - `/quest update`: change objective, verify new text in context injection within next response
    - `/quest clear`: verify quest.json gone or null, no ACTIVE QUEST block in subsequent responses
    - `/quest status`: verify agent gives a real assessment, not just metadata dump
    - `/quest complete`: verify audit path (agent doesn't immediately mark complete if work is missing)
20. Automated tests — only if the OpenCode skill/plugin environment provides reliable test hooks. The spec says "Where the OpenCode plugin environment permits them" — prioritize manual acceptance testing over automated if they conflict.

## Phase 7 — Deliverables and verification

21. Working skill at `quest/SKILL.md` covering all command semantics (Phase 2), context injection (Phase 3), compaction strategy (Phase 4), and audit logic (Phase 5).
22. README at repo root covering: installation (`./install.sh`), command usage, persistence behavior (`.opencode/quest.json` location), examples, and the design rationale.
23. Short implementation note (in README or as a separate section) documenting:
    - Where the skill lives after install (`~/.config/opencode/skills/quest`)
    - Quest state persistence file location (`<projectRoot>/.opencode/quest.json`)
    - Which OpenCode mechanisms are used: skills (discovery), skill instructions (commands + context injection), file I/O (persistence), compaction strategy (Option A or B)
    - Whether an `experimental.session.compacting` plugin hook was used for compaction resilience or if skill-level instructions suffice
24. `install.sh` at repo root (mode +x), patterned after ESP32GuidanceSkill/install.sh:
    - Symlinks `quest/` into each detected AI tool's skills directory (OpenCode: `~/.config/opencode/skills/quest`, Claude Code: `~/.claude/skills/quest`)
    - Supports `--project DIR` for Cursor/project-scoped install at `DIR/.cursor/skills/quest`
    - Supports `-y` to skip replace prompts; `ASSume_YES=1` env var
    - Respects `REPO_URL=<git-url>` for cache-based clone-then-link workflow
25. `.gitignore` at repo root (mirrors ESP32GuidanceSkill/.gitignore pattern, plus `*-workspace/` and `iteration-*/`).
26. Verify all 7 phases are complete against the spec's acceptance criteria (one active quest, persistence across restarts/compaction, auto context injection, show/update/status/complete/clear all work).

## Design principle to test every decision against

> Can the agent reliably remember what it is ultimately trying to accomplish, even after many turns, compaction, or a restart?

If yes, the implementation is doing its job. Keep working until every Phase 0-7 step is done and the manual acceptance test passes.
