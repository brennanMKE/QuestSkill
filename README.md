# QuestSkill — persistent objective tracking

An OpenCode plugin with a companion agent skill that keeps a single high-level quest alive across agent turns, sessions, compaction, and restarts.

**GitHub:** [brennanMKE/QuestSkill](https://github.com/brennanMKE/QuestSkill)

## What This Skill Does

Quest tracks one active objective per project in a `.opencode/quest.json` file. This file is local state by convention, but consuming repositories must ignore it explicitly if they do not want it committed. The plugin uses it to:

- **Stay focused** — inject the quest objective into every response as an ACTIVE QUEST block, reminding the agent of the higher-level goal alongside the immediate task
- **Persist across compaction** — quest state lives on disk, not in chat history; survives token-limited conversations, compaction events, and session boundaries
- **Evaluate progress honestly** — `/quest status` gives a real assessment of whether work satisfies the objective, not just a metadata dump
- **Audit before closing** — `/quest complete` runs an actual completion audit against repo state before flipping status

## Who This Is For

- **Anyone using OpenCode or Claude Code for multi-turn projects** — agents naturally drift; this skill keeps them aligned
- **Projects with a clear, singular goal** — not for scattered experimentation or brainstorming; one quest at a time
- **Users who want the agent to remember what it's working toward** — even after 200+ turns or a restart

## Installation

### Quick install (recommended) — `npx skills`

```bash
npx skills add brennanMKE/QuestSkill --skill quest
```

### Manual install — `install.sh`

Clone the repo and run the installer. It symlinks the skill into the global skills dirs of every detected tool:

```bash
git clone https://github.com/brennanMKE/QuestSkill.git
cd QuestSkill
./install.sh
```

Cursor has no global skills directory, so install per project:

```bash
./install.sh --project /path/to/your/project   # links into <project>/.cursor/skills
```

Install straight from git without a manual clone (caches and updates on re-run):

```bash
REPO_URL=https://github.com/brennanMKE/QuestSkill.git ./install.sh
```

Because `install.sh` uses symlinks, edits to the skill files are picked up without reinstalling.

### Where skills live

| Tool        | Global                           | Project             |
|-------------|----------------------------------|---------------------|
| Claude Code | `~/.claude/skills/`              | `.claude/skills/`   |
| OpenCode    | `~/.config/opencode/skills/`     | (via SKILL.md load) |
| Cursor      | *(project only)*                 | `.cursor/skills/`   |

## Removal

```bash
rm ~/.claude/skills/quest
rm ~/.config/opencode/skills/quest
```

Removing a symlink leaves the source repo untouched.

## How It Works

The `/quest` command is registered with OpenCode's command loader. It loads the companion skill when:
- The user invokes a `/quest` command (show, status, update, complete, clear)
- The user asks about quest state in plain language ("What are we trying to accomplish?", "Show me our goal")
- The agent detects that an active quest exists and the user's request is project-related

### What You Get

When a quest is active, the agent prepends an ACTIVE QUEST block to every relevant response:

```
ACTIVE QUEST

Build a persistent objective tracking system that survives compaction

Treat this as the persistent high-level objective for the current project. The user's current message is the immediate task, but decisions should remain consistent with this Quest unless the user explicitly changes or clears it.
```

The plugin re-reads `.opencode/quest.json` on each model turn and adds this block to effective system context. It does not depend on the model remembering to load the skill.

## Commands

| Command | Description |
|---------|-------------|
| `/quest <objective>` | Create or set the active quest objective. If one already exists, asks whether to replace or clear it first. |
| `/quest show` | Display the current quest: objective, status, timestamps, progress note. |
| `/quest status` | Real assessment of progress — what's done, what remains, blockers. Not a metadata dump. |
| `/quest update <objective>` | Change the quest objective text. New text injected into context on next response. |
| `/quest complete [--force]` | Run a completion audit against repo state. Flips status only when evidence supports it. `--force` overrides. |
| `/quest clear` | Delete the active quest file. Subsequent responses no longer inject the ACTIVE QUEST block. |

## Example Workflow

```
> /quest Implement a file watcher that debounces events and writes to a log

ACTIVE QUEST

Implement a file watcher that debounces events and writes to a log

Treat this as the persistent high-level objective for the current project. The user's current message is the immediate task, but decisions should remain consistent with this Quest unless the user explicitly changes or clears it.

... [agent works on implementation] ...

> /quest status

Based on git status, these files were modified:
  - src/watcher.ts (debounce logic implemented)
  - src/logger.ts (log writing added)

What's done: debounce + log writing.
Remaining: the spec said "debounce events" — but I don't see any event-sourcing or debouncing threshold.
Verdict: not complete yet.

> /quest update Add a configurable debounce threshold parameter (default 300ms)

Objective updated to: Add a configurable debounce threshold parameter (default 300ms)
Next response will reflect the new objective.

... [continues work] ...

> /quest complete

### Audit
- What was asked: Add a configurable debounce threshold parameter (default 300ms)
- Evidence: src/watcher.ts updated with THRESHOLD_MS constant, configurable via function argument
- Gaps: None found
- Verdict: complete

Quest marked as completed.

> /quest show

Status: completed
Objective: Add a configurable debounce threshold parameter (default 300ms)
Completed at: 2026-08-11T...

No active quest — no more ACTIVE QUEST blocks will appear.
```

## Design Decisions

### Persistent file, not chat history

Quest state lives in `.opencode/quest.json` (project-local). This file is always the source of truth — even after compaction, restarts, or token-limited sessions. The agent never relies on chat history for quest existence.

To keep it out of a consuming repository, add this exact entry to that repository's `.gitignore`:

```gitignore
/.opencode/quest.json
```

The installer does not modify project ignore rules automatically. Teams may instead commit Quest state deliberately when a shared objective is desired.

### Compaction resilience

The plugin uses two supported OpenCode hooks:

1. `experimental.chat.system.transform` reloads the active Quest into effective context for every model turn.
2. `experimental.session.compacting` adds the active Quest to the compaction prompt context.

Both hooks load `.opencode/quest.json` afresh. The on-disk file remains authoritative after compaction and restart.

### Single active quest

The skill tracks exactly one quest at a time. If you want to work on something else, `/quest clear` the current one first or use `/quest update` to change focus. This prevents context dilution from multiple simultaneous objectives.

Updates preserve the Quest ID, immutable original objective, and compact revision entries. Ordinary context injection includes only the current objective; completion audits may consult the revisions to avoid losing earlier constraints after compaction.

### Audit, not agreement

`/quest complete` never immediately marks a quest done — it runs a real audit examining repo state, changed files, and evidence of completion. Only the `--force` flag overrides this check.

## Architecture Notes (for developers contributing to this skill)

- **Implementation artifact:** `quest/SKILL.md` — all behavior is encoded as agent instructions in a single markdown file.
- **State file:** `<projectRoot>/.opencode/quest.json` — project-local and ignored only when the consuming repository configures that rule.
- **Project root:** OpenCode's worktree root, falling back to its project directory for non-Git workspaces. Nested shell working directories do not create separate Quests.
- **Discovery:** OpenCode discovers this skill via its name (`quest`) and description in the frontmatter, matching skills loaded by `~/.config/opencode/skills/quest/`.
- **Command registration:** `quest/command/quest.md` registers `/quest` and forwards its complete argument string to the skill instructions.
- **Plugin:** `quest/plugin/quest.js` provides lifecycle hooks for reliable context injection.
- **File I/O protocol:** the FILE MANAGEMENT PROTOCOL section in SKILL.md defines how the agent must read/write quest.json — atomic, validated on read, no caching across turns.

## Verification

Run `npm test` for storage and context tests. Before release, run the OpenCode workflow in `tests/manual-acceptance.md`. Automated tests do not by themselves prove TUI restart or compaction behavior.

## License

This skill and its guidance are provided as-is for personal and educational use.
