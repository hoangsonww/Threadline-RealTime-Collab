#!/usr/bin/env bash
# Shared helpers for the shell scripts in this directory.
#
# Source it, don't execute it:
#   source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"
#
# Everything here is POSIX-friendly bash 3.2 so it runs on a stock macOS
# /bin/bash as well as on a CI runner's bash 5.

# ── Strict mode ───────────────────────────────────────────────────────────────
set -euo pipefail

# ── Repository root, regardless of where the script was invoked from ──────────
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
export REPO_ROOT

# ── Colour, but only when a human is watching ─────────────────────────────────
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ] && [ "${TERM:-dumb}" != "dumb" ]; then
  C_RESET=$'\033[0m'
  C_BOLD=$'\033[1m'
  C_DIM=$'\033[2m'
  C_RED=$'\033[31m'
  C_GREEN=$'\033[32m'
  C_YELLOW=$'\033[33m'
  C_BLUE=$'\033[34m'
  C_CYAN=$'\033[36m'
else
  C_RESET='' C_BOLD='' C_DIM='' C_RED='' C_GREEN='' C_YELLOW='' C_BLUE='' C_CYAN=''
fi

# ── Output ────────────────────────────────────────────────────────────────────
heading() { printf '\n%s▸ %s%s\n' "$C_BOLD$C_BLUE" "$*" "$C_RESET"; }
step() { printf '%s·%s %s\n' "$C_DIM" "$C_RESET" "$*"; }
ok() { printf '%s✓%s %s\n' "$C_GREEN" "$C_RESET" "$*"; }
warn() { printf '%s!%s %s\n' "$C_YELLOW" "$C_RESET" "$*" >&2; }
err() { printf '%s✖%s %s\n' "$C_RED" "$C_RESET" "$*" >&2; }
note() { printf '  %s%s%s\n' "$C_DIM" "$*" "$C_RESET"; }

die() {
  err "$*"
  exit 1
}

# ── Environment probes ────────────────────────────────────────────────────────
has() { command -v "$1" >/dev/null 2>&1; }

require() {
  has "$1" || die "\`$1\` is required but not on PATH.${2:+ $2}"
}

# Compares dotted versions. `version_at_least 20.11 18.0` → 1 (false).
version_at_least() {
  local have="$1" want="$2"
  [ "$(printf '%s\n%s\n' "$want" "$have" | sort -V | head -1)" = "$want" ]
}

# Minimum Node major, kept in sync with the root package.json `engines` field.
NODE_MIN="20.11"
export NODE_MIN

check_node() {
  require node "Install Node ${NODE_MIN} or newer — see https://nodejs.org"
  local have
  have="$(node -v | sed 's/^v//')"
  version_at_least "$have" "$NODE_MIN" ||
    die "Node ${NODE_MIN}+ is required (found ${have}). The root package.json \`engines\` field is the source of truth."
}

# ── Timed command runner ──────────────────────────────────────────────────────
# run_step "Label" command args...
#   Prints the label, runs the command, reports elapsed time, and propagates a
#   failure with the label attached so a long run is diagnosable from the tail.
run_step() {
  local label="$1"
  shift
  local start end status
  start="$(date +%s)"

  printf '\n%s── %s%s\n' "$C_CYAN" "$label" "$C_RESET"

  set +e
  "$@"
  status=$?
  set -e

  end="$(date +%s)"

  if [ "$status" -eq 0 ]; then
    ok "$label ($((end - start))s)"
  else
    err "$label failed after $((end - start))s (exit $status)"
  fi

  return "$status"
}

# ── Confirmation for anything destructive ─────────────────────────────────────
confirm() {
  local prompt="${1:-Continue?}"

  if [ "${ASSUME_YES:-0}" = "1" ]; then
    note "$prompt — assumed yes (ASSUME_YES=1)"
    return 0
  fi

  if [ ! -t 0 ]; then
    die "$prompt — refusing to assume an answer without a terminal. Re-run with ASSUME_YES=1 if you mean it."
  fi

  printf '%s%s [y/N]%s ' "$C_BOLD" "$prompt" "$C_RESET"
  local reply
  read -r reply
  case "$reply" in
    [yY] | [yY][eE][sS]) return 0 ;;
    *) return 1 ;;
  esac
}
