#!/bin/bash
# v0.3.1 (§2): the product has no database (static UI + file-based agent);
# prisma/db was removed. This script is a no-op so the sandbox build tool stays harmless.
set -euo pipefail
echo "ℹ️  product has no database — nothing to build (removed in v0.3.1; see WORKLOG)"
