#!/bin/bash
# Makes `clasp logs` work in every cloud session. Credentials come from the
# CLASPRC_JSON environment secret, never from the repo. Never pushes.
set -u
[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || exit 0
cd "$CLAUDE_PROJECT_DIR" || exit 0
if [ -n "${CLASPRC_JSON:-}" ]; then
  printf '%s' "$CLASPRC_JSON" > ~/.clasprc.json && chmod 600 ~/.clasprc.json
else
  echo "clasp: CLASPRC_JSON not set; clasp logs will not authenticate." >&2
fi
[ -f .clasp.json ] || printf '{"scriptId":"14P0qujMM2XD-wPhP2IaIWGpZSqyLX6XYu7nLNw4oI1s5d0_OOudpiwaL","projectId":"nhsc-apps-script","rootDir":"."}\n' > .clasp.json
command -v clasp >/dev/null || npm i -g @google/clasp >/dev/null 2>&1
exit 0
