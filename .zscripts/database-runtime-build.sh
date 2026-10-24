#!/bin/bash
# v0.3.1 (§2): محصول پایگاه‌داده ندارد (UI استاتیک + agent فایل‌محور)؛
# prisma/db حذف شد. این اسکریپت no-op شد تا ابزار build سندباکس بی‌ضرر بماند.
set -euo pipefail
echo "ℹ️  product has no database — nothing to build (removed in v0.3.1; see WORKLOG)"
