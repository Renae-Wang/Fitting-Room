#!/bin/bash
set -eu
cd "$(dirname "$0")"
if ! command -v node >/dev/null || ! node --env-file-if-exists=.env -e 'process.exit(0)' >/dev/null 2>&1; then
  echo "Install Node.js 22.9 or later, then reopen this launcher."
  exit 1
fi
exec node --env-file-if-exists=.env server.mjs
