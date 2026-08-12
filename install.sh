#!/usr/bin/env bash
set -euo pipefail

# install.sh — link this repo's skill(s) into the AI coding tools on this machine.
#
# A skill is a folder containing SKILL.md. "Installing" links that folder into each
# tool's skills directory (symlink, so edits are live).
#
# Usage:
#   ./install.sh                    Install globally for detected tools (Claude Code, OpenCode)
#   ./install.sh --project DIR      Also install into DIR/.cursor/skills (covers Cursor)
#   ./install.sh -y                 Don't prompt before replacing

PROJECT_DIR=""
ASSUME_YES="${ASSUME_YES:-0}"
GLOBAL_TARGETS=()

while [ $# -gt 0 ]; do
  case "$1" in
    --project)
      if [ $# -lt 2 ] || [ -z "$2" ]; then echo "--project requires a directory" >&2; exit 1; fi
      PROJECT_DIR="$2"; shift 2
      ;;
    --project=*) PROJECT_DIR="${1#*=}"; shift ;;
    -y|--yes)    ASSUME_YES=1; shift ;;
    -h|--help)   grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

have() { command -v "$1" >/dev/null 2>&1; }

# --- Resolve source root (live checkout, or persistent clone) ---
if [ -n "${REPO_URL:-}" ]; then
  CACHE_BASE="${XDG_CACHE_HOME:-$HOME/.cache}/ai-skills"
  repo_name="$(basename "${REPO_URL%.git}")"
  CLONE_DIR="$CACHE_BASE/$repo_name"
  mkdir -p "$CACHE_BASE"
  if [ -d "$CLONE_DIR/.git" ]; then
    echo "Updating clone in $CLONE_DIR"
    git -C "$CLONE_DIR" pull --ff-only
  else
    echo "Cloning $REPO_URL into $CLONE_DIR"
    git clone "$REPO_URL" "$CLONE_DIR"
  fi
  SRC_ROOT="$CLONE_DIR"
else
  SRC_ROOT="$(cd "$(dirname "$0")" && pwd)"
fi

# --- Detect installed tools (global targets) ---
if have claude || [ -d "$HOME/.claude" ]; then
  GLOBAL_TARGETS+=("$HOME/.claude/skills")
fi
OPENCODE_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/opencode"
if have opencode || [ -d "$OPENCODE_DIR" ]; then
  GLOBAL_TARGETS+=("$OPENCODE_DIR/skills")
fi

prepare_destination() {
  dest="$1"
  [ ! -e "$dest" ] && [ ! -L "$dest" ] && return 0
  if [ "$ASSUME_YES" != "1" ]; then
    printf 'Replace existing path %s? [y/N] ' "$dest"
    if [ -r /dev/tty ]; then read -r reply </dev/tty; else reply="N"; fi
    case "${reply:-N}" in [yY]*) ;; *) echo "  skipped $dest"; return 1 ;; esac
  fi
  if [ -L "$dest" ]; then
    rm -- "$dest"
  else
    backup="$dest.quest-backup.$(date +%Y%m%d%H%M%S).$$"
    mv -- "$dest" "$backup"
    echo "  backed up $dest to $backup"
  fi
}

# --- Link one skill folder into one target dir ---
link_skill() {
  src="$1"; targets_dir="$2"
  name="$(basename "$src")"
  dest="$targets_dir/$name"
  mkdir -p "$targets_dir"
  prepare_destination "$dest" || return 0
  ln -s "$src" "$dest"
  echo "  linked $dest -> $src"
}

# --- Find every skill (dir containing SKILL.md) and install it ---
while IFS= read -r skillmd; do
      skill="$(cd "$(dirname "$skillmd")" && pwd)"
      echo "Installing skill: $(basename "$skill")"
      for t in "${GLOBAL_TARGETS[@]}"; do link_skill "$skill" "$t"; done
      if [ -n "$PROJECT_DIR" ]; then
        link_skill "$skill" "$PROJECT_DIR/.cursor/skills"
      fi
    done < <(find "$SRC_ROOT" -maxdepth 2 -name SKILL.md -not -path '*/.git/*' -print)

# OpenCode plugins must live in its plugin directory to run on every turn.
QUEST_PLUGIN="$SRC_ROOT/quest/plugin/quest.js"
if [ -f "$QUEST_PLUGIN" ] && { have opencode || [ -d "$OPENCODE_DIR" ]; }; then
  mkdir -p "$OPENCODE_DIR/plugins"
  plugin_dest="$OPENCODE_DIR/plugins/quest.js"
  if prepare_destination "$plugin_dest"; then
    ln -s "$QUEST_PLUGIN" "$plugin_dest"
    echo "  linked $plugin_dest -> $QUEST_PLUGIN"
  fi
fi

# Register /quest with OpenCode's command loader.
QUEST_COMMAND="$SRC_ROOT/quest/command/quest.md"
if [ -f "$QUEST_COMMAND" ] && { have opencode || [ -d "$OPENCODE_DIR" ]; }; then
  mkdir -p "$OPENCODE_DIR/commands"
  command_dest="$OPENCODE_DIR/commands/quest.md"
  if prepare_destination "$command_dest"; then
    ln -s "$QUEST_COMMAND" "$command_dest"
    echo "  linked $command_dest -> $QUEST_COMMAND"
  fi
fi

echo ""

if [ "${#GLOBAL_TARGETS[@]}" -eq 0 ] && [ -z "$PROJECT_DIR" ]; then
  echo "No supported AI tools detected (Claude Code / OpenCode)."
  echo "Cursor is project-scoped: re-run with --project /path/to/your/project"
elif [ -z "$PROJECT_DIR" ]; then
  echo "Cursor skipped (no global dir). Install per project with: --project /path/to/your/project"
fi
