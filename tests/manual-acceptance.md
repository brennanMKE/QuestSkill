# OpenCode manual acceptance

Run these checks against a temporary Git project after `./install.sh -y` and an OpenCode restart. Record the OpenCode version and result for each release.

- Create: `/quest Keep all existing tests passing.` creates valid `.opencode/quest.json`.
- Ordinary turn: `Start with the model layer.` receives the active Quest in effective context without manually loading the skill.
- New session: the ordinary-turn check still observes the Quest.
- Compaction: run `/compact`; the next ordinary turn still observes the Quest.
- Mid-task compaction: start a multi-step task, verify a checkpoint is saved, run `/compact`, and verify the agent continues the recorded next action without waiting for another user message.
- Context exhaustion: during a long task, verify checkpoint fields retain completed/current/remaining work and the next turn resumes rather than replying only that the context limit was reached.
- Update: `/quest update Preserve behavior and add tests.` changes injected context on the next turn.
- Status: `/quest status` inspects repository evidence and reports work, gaps, blockers, and verdict.
- No unnecessary writes: greetings, single-step unrelated work, and `/quest status` do not create checkpoints.
- Incomplete completion: `/quest complete` leaves state active when evidence is missing.
- Clear: `/quest clear` removes the state file and subsequent context injection.
- Corruption: invalid JSON produces an actionable error without overwriting the file.
- Write failure: read-only `.opencode` state produces an actionable error.
- Git policy: the consuming repository either ignores `/.opencode/quest.json` or intentionally tracks it; installation does not silently change that choice.

Do not describe a release as acceptance-tested until every row has a recorded passing result.
