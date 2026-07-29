#!/usr/bin/env bash
# Author spec -> validate -> generate factory -> apply refine-code edits -> compile the
# preview harness -> render -> Tier 1. Kept as one script because skipping the harness
# compile step silently renders stale JavaScript.
#
# Usage: ./build.sh <pass-id> <label> [view ...]
set -euo pipefail

PASS_ID="$1"
LABEL="$2"
shift 2
VIEWS=("$@")
[ ${#VIEWS[@]} -eq 0 ] && VIEWS=("reference")

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT="$(cd "$HERE/../../.." && pwd)"
SKILL="C:/Users/Mcgib/.claude/skills/img2threejs"
SPEC="$HERE/hammer-sculpt-spec.json"
MODEL="$PROJECT/components/game/models/createHammerModel.ts"
REFERENCE="$PROJECT/assets/reference/hammer-reference.png"

python "$HERE/author_hammer_spec.py" | tail -1
(cd "$SKILL" && python forge/stage2_spec/validate_sculpt_spec.py "$SPEC" --strict-quality | head -1)
(cd "$SKILL" && python forge/stage3_build/generate_threejs_factory.py "$SPEC" --out "$MODEL" \
  --pass-id "$PASS_ID" --force > /dev/null)
# The optimization pass is the only one allowed to cut tessellation.
if [ "$PASS_ID" = "optimization-pass" ]; then
  python "$HERE/apply_refinements.py" --optimize
else
  python "$HERE/apply_refinements.py"
fi

(cd "$HERE/preview" && npx tsc -p tsconfig.json 2>&1 | grep " error TS" || true)
(cd "$HERE/preview" && node shoot.mjs ../renders "$LABEL" "${VIEWS[@]}" 2>&1 | grep -E "triangles|pageerror")

(cd "$SKILL" && python forge/stage4_review/diagnose_render.py --reference "$REFERENCE" \
  --render "$HERE/renders/$LABEL-reference.png" --spec "$SPEC" --pass-id "$PASS_ID" \
  | grep -E '"(silhouetteIoU|aspectRatioDelta|scaleDelta|bilateralSymmetryError|maxDeltaE|passed)"|^    "')
(cd "$SKILL" && python forge/stage4_review/make_comparison_sheet.py --reference "$REFERENCE" \
  --render "$HERE/renders/$LABEL-reference.png" --out "$HERE/renders/$LABEL-cmp.png" > /dev/null)
echo "comparison sheet: $HERE/renders/$LABEL-cmp.png"
