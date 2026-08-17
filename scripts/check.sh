#!/usr/bin/env bash
# The full local gate — the same five checks CI runs before it will merge, in
# the same order, with a summary at the end so a failure three steps back is
# still visible.
#
#   ./scripts/check.sh              format, lint, typecheck, test, build
#   ./scripts/check.sh --fix        fix what is fixable first, then run
#   ./scripts/check.sh --fast       skip the build (the slowest step)
#   ./scripts/check.sh --with-docs  also verify the TypeDoc reference builds
#
# Every step runs even if an earlier one fails, because "your formatting is
# wrong" should not hide "your tests are broken".

# shellcheck source=scripts/lib/common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/common.sh"

cd "$REPO_ROOT" || die "Cannot enter the repository root at $REPO_ROOT"

FIX=0
FAST=0
WITH_DOCS=0

while [ $# -gt 0 ]; do
  case "$1" in
    --fix) FIX=1 ;;
    --fast) FAST=1 ;;
    --with-docs) WITH_DOCS=1 ;;
    -h | --help)
      sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) die "Unknown option: $1 (try --help)" ;;
  esac
  shift
done

check_node

STEP_NAMES=()
STEP_RESULTS=()
FAILED=0

record() {
  STEP_NAMES+=("$1")
  STEP_RESULTS+=("$2")
  [ "$2" = "fail" ] && FAILED=1
  return 0
}

attempt() {
  local label="$1"
  shift
  if run_step "$label" "$@"; then
    record "$label" ok
  else
    record "$label" fail
  fi
}

if [ "$FIX" -eq 1 ]; then
  heading "Fixing what is fixable"
  npm run --silent lint:fix || true
  npm run --silent format || true
  ok "eslint --fix and prettier --write applied"
fi

attempt "Format" npm run --silent format:check
attempt "Lint" npm run --silent lint
attempt "Typecheck" npm run --silent typecheck
attempt "Test" npm run --silent test

if [ "$FAST" -eq 0 ]; then
  attempt "Build" npm run --silent build
else
  record "Build" skip
fi

if [ "$WITH_DOCS" -eq 1 ]; then
  attempt "Docs" npm run --silent docs
else
  record "Docs" skip
fi

# ── Summary ───────────────────────────────────────────────────────────────────
printf '\n%s── Summary%s\n\n' "$C_BOLD" "$C_RESET"

i=0
while [ "$i" -lt "${#STEP_NAMES[@]}" ]; do
  case "${STEP_RESULTS[$i]}" in
    ok) printf '  %s✓%s %s\n' "$C_GREEN" "$C_RESET" "${STEP_NAMES[$i]}" ;;
    fail) printf '  %s✖%s %s\n' "$C_RED" "$C_RESET" "${STEP_NAMES[$i]}" ;;
    skip) printf '  %s–  %s (skipped)%s\n' "$C_DIM" "${STEP_NAMES[$i]}" "$C_RESET" ;;
  esac
  i=$((i + 1))
done

printf '\n'

if [ "$FAILED" -eq 1 ]; then
  err "Not ready to push."
  note "Scroll up for the first failure — later steps ran anyway so you can see everything at once."
  if [ "$FIX" -eq 0 ]; then
    note "For formatting and lint problems specifically, ./scripts/check.sh --fix resolves most of them."
  fi
  exit 1
fi

ok "All checks passed. This is what CI will run."
