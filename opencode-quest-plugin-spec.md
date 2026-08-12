# OpenCode Quest Plugin — Implementation Specification

## Objective

Build an OpenCode plugin/skill that adds a persistent **Quest** feature: a durable, high-level objective that remains visible to the agent while it works across many turns and survives context compaction and OpenCode restarts.

The feature intentionally uses **`quest`** rather than `goal` so it does not conflict with a future native OpenCode `/goal` feature.

A Quest is more than saved text. The active Quest should continuously influence planning and implementation, and the agent should evaluate its work against the Quest before considering the overall objective complete.

## Desired User Experience

Support a command-oriented workflow centered around `/quest`.

```text
/quest <objective>        Create/set the active quest
/quest show               Display the active quest
/quest status             Evaluate progress toward the active quest
/quest update <objective> Update/refine the active quest
/quest complete           Audit and complete the active quest
/quest clear              Remove the active quest
```

If OpenCode's plugin APIs make another command syntax more idiomatic, preserve these semantics while following OpenCode conventions.

### Example

```text
/quest Refactor the networking layer to use Swift concurrency while preserving existing behavior and tests.
```

After this command, subsequent requests such as:

```text
Start with the API client.
```

or:

```text
Now fix the tests.
```

should be interpreted in the context of the active Quest without requiring the user to restate the larger objective.

## Core Requirements

### 1. One Active Quest

For the initial version, support exactly one active Quest per OpenCode project/workspace.

A Quest should contain at least:

- Unique ID
- Objective text
- Creation timestamp
- Last-updated timestamp
- Status
- Optional progress/notes

Suggested statuses:

- `active`
- `completed`

Do not over-engineer lifecycle states for v1.

### 2. Persistent Storage

The active Quest must survive:

- New chat/session
- Context compaction
- OpenCode restart
- Machine reboot

Prefer project-local storage so different repositories can have different Quests.

Investigate OpenCode's plugin persistence/configuration APIs first. Use the most idiomatic supported mechanism.

If a plugin-specific file is necessary, use something clearly namespaced, for example:

```text
.opencode/quest.json
```

or:

```text
.opencode/quest.md
```

Do not modify application-global state when project-local state is sufficient.

The persistence format should be human-readable where practical.

### 3. Automatic Context Injection

This is the most important feature.

When an active Quest exists, inject it into the agent's effective context automatically so the agent remains aware of the high-level objective throughout the session.

The user should **not** need to repeatedly invoke `/quest show` or paste the Quest back into prompts.

Injected context should clearly distinguish the persistent objective from the immediate user request. Conceptually it should communicate:

```text
ACTIVE QUEST

<quest objective>

Treat this as the persistent high-level objective for the current project. The user's current message is the immediate task, but decisions should remain consistent with this Quest unless the user explicitly changes or clears it.
```

Use OpenCode's supported plugin hooks rather than implementing brittle prompt manipulation if an appropriate API exists.

### 4. Survive Context Compaction

A Quest must not disappear when OpenCode compacts the conversation.

Do not rely solely on the Quest having appeared earlier in chat history.

Persistent storage must remain the source of truth, and the plugin should reintroduce the active Quest whenever necessary after compaction or reconstruction of agent context.

Investigate OpenCode's compaction/session/plugin hooks and implement this using the supported extension points.

### 5. `/quest show`

Display the current Quest clearly.

Example output:

```text
Quest: Refactor the networking layer to use Swift concurrency while preserving existing behavior and tests.

Status: Active
Created: 2026-08-11
```

If no Quest exists, say so clearly and explain how to create one.

### 6. `/quest status`

Ask the agent to evaluate the current repository/session state against the active Quest.

This should be an actual assessment, not simply a display of stored metadata.

The response should identify:

- What has been accomplished
- What remains
- Known blockers or unresolved questions
- Whether the Quest appears complete

The implementation may use the current conversation, repository state, task/todo information, or other context available through supported OpenCode APIs.

Do not claim completion merely because a checklist is exhausted. Evaluate the original Quest itself.

### 7. `/quest update`

Allow the user to refine or replace the objective while retaining the Quest identity/history when practical.

Example:

```text
/quest update Refactor the networking layer to Swift concurrency and remove the old callback API entirely.
```

The new objective should immediately become the version injected into agent context.

### 8. `/quest complete`

Completion should involve an **audit**, not simply flipping a Boolean.

When the user requests completion, have the agent evaluate whether the current state actually satisfies the Quest.

The audit should consider, where applicable:

- Original objective
- Requirements implied or explicitly stated during the Quest
- Current repository changes
- Tests/build results
- Outstanding TODOs
- Known errors or compromises
- User-requested constraints

If the Quest appears incomplete, explain what remains and leave it active unless the user explicitly forces completion.

If it is complete, mark it completed and present a concise completion summary.

If practical, support an explicit force mechanism such as:

```text
/quest complete --force
```

Do not invent this if OpenCode's command system makes flags inappropriate; choose an idiomatic equivalent.

### 9. `/quest clear`

Remove the active Quest from persistent state and stop injecting it into context.

Clearing does not require a completion audit.

If historical storage is simple to support, retaining completed/cleared Quest history is welcome but is **not required for v1**.

## Agent Behavior

While a Quest is active, the agent should distinguish between two levels of instruction:

1. **Quest** — persistent high-level outcome.
2. **Current request** — immediate step the user wants performed.

The Quest must not override explicit user instructions. If the user changes direction, asks for something unrelated, or updates the Quest, follow the latest explicit instruction.

The Quest should primarily provide continuity and prevent the agent from losing sight of the overall outcome during long workflows.

### Example

Active Quest:

```text
Migrate the application from callbacks to Swift concurrency without changing public behavior.
```

Current request:

```text
Fix the compiler errors in UserService first.
```

The agent should fix `UserService`, but decisions made during that work should remain compatible with the larger migration Quest.

## Quest Context Should Be Compact

Do not flood the context window with Quest metadata on every turn.

The automatically injected representation should generally contain only what the agent needs:

- The active objective
- Essential constraints, if stored
- Possibly a compact progress summary

Timestamps, IDs, historical updates, and verbose audit logs do not need to be injected into normal agent context.

## Optional Progress Notes

If OpenCode exposes suitable hooks, consider allowing the plugin or agent to maintain a short progress summary.

For example:

```markdown
## Progress

- Converted APIClient to async/await.
- Migrated UserService.
- Network tests passing.
- ImageService still uses callbacks.
```

This is useful if it can be implemented reliably, but persistent objective injection is more important than automatic progress tracking.

Do not let stale generated progress notes become authoritative. The repository and actual execution state take precedence.

## Repository / Git Considerations

Decide deliberately whether Quest state should normally be committed to Git.

The preferred default is for Quest state to be local developer/agent state unless OpenCode already has a convention for project-scoped state that is committed.

If `.opencode/quest.*` is used, investigate existing OpenCode conventions before deciding whether to recommend adding it to `.gitignore`.

Do not automatically edit `.gitignore` without a strong reason.

## Plugin vs Skill

Investigate the current OpenCode extension model before implementation.

Use a **plugin** for capabilities requiring lifecycle hooks, command registration, persistent state, or context injection.

A companion **skill** may be useful for describing Quest audit behavior or agent instructions, but do not attempt to implement persistence solely through a skill if that would make the feature unreliable.

Prefer the smallest architecture that provides reliable persistence and automatic context injection.

## Implementation Process

Before writing code:

1. Inspect the current OpenCode repository/version and documentation available in this project.
2. Identify the supported plugin API for custom commands.
3. Identify hooks for modifying/injecting agent context or system instructions.
4. Identify session/compaction lifecycle hooks.
5. Identify recommended plugin storage mechanisms.
6. Look at existing first-party or well-maintained plugins for conventions.
7. Write a short implementation plan before making changes.

Do not assume APIs based on older OpenCode versions. Use the APIs available in the installed/current version.

## Suggested Architecture

The exact architecture should follow current OpenCode APIs, but conceptually separate these responsibilities:

```text
QuestPlugin
  |
  +-- QuestStore
  |     load()
  |     save()
  |     clear()
  |
  +-- QuestCommands
  |     set
  |     show
  |     status
  |     update
  |     complete
  |     clear
  |
  +-- QuestContextProvider
  |     inject active quest into agent context
  |
  +-- QuestAuditor
        evaluate completion/status
```

Keep persistence mechanics separate from prompt/context construction so each can be tested independently.

## Data Model

A reasonable starting model is:

```typescript
type QuestStatus = "active" | "completed"

interface Quest {
  id: string
  objective: string
  status: QuestStatus
  createdAt: string
  updatedAt: string
  progress?: string
  completedAt?: string
}
```

Adapt this to the language and conventions used by OpenCode plugins.

Avoid adding fields without a concrete use case.

## Error Handling

Handle at least these cases gracefully:

- `/quest show` with no Quest
- `/quest status` with no Quest
- `/quest complete` with no Quest
- Empty `/quest` objective
- Empty `/quest update` objective
- Corrupt persisted Quest data
- Persistence write failure
- Unsupported/changed OpenCode hook

A corrupt Quest file should produce an actionable error rather than silently discarding the user's objective.

## Tests

Add automated tests where the OpenCode plugin environment permits them.

At minimum test:

### Persistence

1. Create a Quest.
2. Reload the store/plugin.
3. Verify the Quest remains active and unchanged.

### Update

1. Create a Quest.
2. Update it.
3. Verify context injection uses the new objective.

### Clear

1. Create a Quest.
2. Clear it.
3. Verify no Quest context is injected afterward.

### Context Injection

Verify that an active Quest is included in the appropriate agent context and that no Quest block is injected when none exists.

### Completion

Verify that completion follows the audit path rather than immediately changing persisted state.

### Compaction / New Session

Where the OpenCode test APIs allow it, simulate or reproduce a new/compacted session and verify that the Quest is restored from persistent storage and injected again.

## Manual Acceptance Test

The finished implementation should pass this workflow:

```text
/quest Migrate the sample feature to the new API while keeping all existing tests passing.
```

Verify the Quest is stored.

Then ask:

```text
Start with the model layer.
```

Verify the agent knows the larger migration objective without it being repeated.

Start a new OpenCode session in the same project.

Ask:

```text
What are we trying to accomplish?
```

The agent should be able to identify the active Quest.

Then:

```text
/quest status
```

The agent should assess actual progress.

Then:

```text
/quest complete
```

If work remains, the agent should identify it and keep the Quest active.

Once all work is done, `/quest complete` should successfully audit and mark it complete.

Finally create another Quest, run:

```text
/quest clear
```

and verify subsequent agent context contains no active Quest.

## Acceptance Criteria

The feature is complete when all of the following are true:

- A user can create a Quest with a simple command.
- Only one active Quest is required for v1.
- The Quest persists across OpenCode restarts/sessions.
- The active Quest is automatically included in agent context.
- The Quest survives conversation compaction because persistent state, not chat history, is authoritative.
- The user can inspect the current Quest.
- The user can update it.
- The user can request a meaningful progress assessment.
- Completion performs an audit before marking the Quest complete.
- The user can clear a Quest without completing it.
- No Quest context is injected when there is no active Quest.
- The implementation follows current OpenCode plugin conventions.
- Core persistence/context behavior has automated tests where supported.
- Documentation explains installation and usage.

## Deliverables

Produce:

1. The working OpenCode plugin and any companion skill/configuration required.
2. Automated tests.
3. A README containing installation, command usage, persistence behavior, and examples.
4. Any necessary example configuration.
5. A short implementation note describing which OpenCode hooks/APIs are used for persistence, command handling, context injection, and compaction resilience.

## Non-Goals for v1

Do **not** let these delay the core implementation:

- Multiple simultaneous Quests
- Quest dependency graphs
- Cloud synchronization
- Cross-project Quests
- Team/shared Quests
- Elaborate UI
- Gamification
- XP, achievements, levels, or rewards
- Complex Quest history browsing
- Automatic decomposition into dozens of subtasks

The first version should be small and dependable.

## Design Principle

The key test for every implementation decision is:

> **Can the agent reliably remember what it is ultimately trying to accomplish, even after many turns, compaction, or a restart?**

If the answer is yes, the Quest feature is doing its job.
