#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TEST_HOME="$(mktemp -d /tmp/quest-install.XXXXXX)"
TEST_CONFIG="$TEST_HOME/config"

HOME="$TEST_HOME" XDG_CONFIG_HOME="$TEST_CONFIG" "$ROOT/install.sh" -y >/dev/null
test -L "$TEST_CONFIG/opencode/skills/quest"
test -L "$TEST_CONFIG/opencode/plugins/quest.js"
test -L "$TEST_CONFIG/opencode/commands/quest.md"

# Existing directories are backed up rather than recursively deleted.
rm "$TEST_CONFIG/opencode/skills/quest"
mkdir -p "$TEST_CONFIG/opencode/skills/quest"
touch "$TEST_CONFIG/opencode/skills/quest/user-file"
HOME="$TEST_HOME" XDG_CONFIG_HOME="$TEST_CONFIG" "$ROOT/install.sh" -y >/dev/null
test -L "$TEST_CONFIG/opencode/skills/quest"
find "$TEST_CONFIG/opencode/skills" -maxdepth 1 -type d -name 'quest.quest-backup.*' -exec test -f '{}/user-file' \;

if HOME="$TEST_HOME" XDG_CONFIG_HOME="$TEST_CONFIG" "$ROOT/install.sh" --project >/dev/null 2>&1; then
  echo "missing --project argument unexpectedly succeeded" >&2
  exit 1
fi
