#!/usr/bin/env bash
# OPTIONAL macOS convenience: install a modern bash + the GNU coreutils toolchain so the local
# BSD userland behaves like the Linux CI runner. The deploy scripts DO NOT REQUIRE this — they are
# written to the portable BSD/GNU intersection (e.g. common.sh's `date -j -f … || date -d …`
# fallback and gke.sh's `sed -i.bak … && rm …bak`), so a stock macOS runs them correctly with no
# GNU tools at all. Run this only if you WANT `sed`/`date`/`grep`/etc. to resolve to their GNU
# builds locally (identical flags/output to CI) instead of the BSD ones.
#
# ── The drift caveat (read before you rely on this) ──────────────────────────────────────────────
# Putting the gnubin dirs first on PATH makes bare `sed`/`awk`/`date` mean GNU IN YOUR SHELL ONLY.
# It changes nothing for anyone who hasn't run this, and nothing in CI. So DO NOT let it lull you
# into writing GNU-only invocations (`sed -i` without a suffix, `readlink -f`, `grep -P`, `date -d`
# without a BSD fallback): those still break on a teammate's stock Mac and are caught by nothing
# here. The scripts must stay portable REGARDLESS of this bootstrap. This is a local-parity comfort,
# not a license to drop the dual-dialect idioms. (Sources: Homebrew coreutils formula; the
# widely-mirrored "GNU tools on macOS" gnubin-on-PATH recipe.)
#
# Not part of preflight() and never sourced by run.sh — a one-shot developer setup, kept beside
# infra/run/local/run.sh because that is the script whose macOS-vs-Linux parity it improves.
#
# Usage:
#   bash infra/run/local/brew-bootstrap.sh          install the toolchain + print PATH guidance
#   bash infra/run/local/brew-bootstrap.sh --path    print ONLY the PATH block to add to ~/.zshrc
set -euo pipefail

# Reuse the one logging vocabulary the rest of the tooling speaks (log/ok/warn/die).
# shellcheck source=../../lib/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/../../lib/common.sh"

# The GNU packages whose bare-name binaries diverge from macOS's BSD ones. `bash` is here too so the
# gcp orchestrator's bash>=5.1 re-exec (run/gcp/run.sh) finds a modern bash at the Homebrew prefix.
# Homebrew installs each g-prefixed (gsed, gdate, …); the gnubin dirs below expose the unprefixed
# names. gnu-tar/ed/make are omitted — no infra script depends on their GNU-specific behaviour.
BREW_GNU_FORMULAE=(bash coreutils gnu-sed gawk findutils grep)

# gnubin_path: echo the newline-separated list of every Homebrew "libexec/gnubin" dir under the
# active brew prefix ($(brew --prefix) is arch-agnostic — /opt/homebrew on Apple Silicon,
# /usr/local on Intel — so this never hardcodes either). Empty if none are installed yet.
gnubin_path() {
  local prefix
  prefix="$(brew --prefix 2>/dev/null)" || return 0
  [[ -n "$prefix" ]] || return 0
  # -follow so a symlinked opt/ is traversed; sorted for deterministic, reviewable output.
  find "$prefix/opt" -type d -follow -name gnubin -print 2>/dev/null | sort || true
}

# print_path_block: emit the shell-profile snippet that puts the gnubin dirs first on PATH, so
# `sed`/`awk`/`date`/`grep`/`find` resolve to GNU. Uses a literal `$(brew --prefix)` in the emitted
# text (single-quoted heredoc) so the user's profile stays arch-portable rather than baking in this
# machine's absolute prefix.
print_path_block() {
  cat <<'EOF'
# GNU coreutils first on PATH (installed via infra/run/local/brew-bootstrap.sh) so bare
# sed/awk/date/grep/find match Linux/CI. Local-only; the deploy scripts do NOT require it.
for _gnubin in "$(brew --prefix)"/opt/*/libexec/gnubin; do
  [ -d "$_gnubin" ] && PATH="$_gnubin:$PATH"
done
export PATH
EOF
}

main() {
  if [[ "${1:-}" == "--path" ]]; then
    print_path_block
    return 0
  fi

  need brew "https://brew.sh"

  log "Installing modern bash + GNU coreutils toolchain (${BREW_GNU_FORMULAE[*]})"
  # `brew install` is idempotent (already-installed formulae are a no-op), so re-runs are safe.
  brew install "${BREW_GNU_FORMULAE[@]}"
  ok "Toolchain installed"

  local installed
  installed="$(gnubin_path)"
  if [[ -n "$installed" ]]; then
    ok "gnubin dirs found:"
    # gnubin_path emits one dir per line; indent each without word-splitting a single string.
    while IFS= read -r _dir; do printf '    %s\n' "$_dir"; done <<< "$installed"
  fi

  log "To make bare sed/awk/date/grep/find resolve to GNU, add this to your ~/.zshrc (or ~/.bashrc):"
  print_path_block
  warn "Local-parity only — this changes YOUR shell, not CI or a teammate's Mac. Keep the scripts"
  warn "portable (BSD/GNU dual-dialect) regardless; do NOT rely on GNU-only flags because of this."
}

main "$@"
