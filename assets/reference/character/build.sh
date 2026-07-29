#!/usr/bin/env bash
# Author spec -> validate -> generate factory -> apply refine-code edits -> compile the preview
# harness -> render -> Tier 1 diagnose -> comparison sheet. Kept as one script because skipping
# the harness compile step silently renders stale JavaScript.
#
# usage: build.sh <pass-id> <label> [view ...]
set -euo pipefail

PASS_ID="${1:?pass id required}"
LABEL="${2:?label required}"
shift 2
VIEWS=("${@:-reference}")

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT="$(cd "$HERE/../../.." && pwd)"
SKILL="C:/Users/Mcgib/.claude/skills/img2threejs"
SPEC="$HERE/character-sculpt-spec.json"
MODEL="$PROJECT/components/game/models/createRunnerModel.ts"
REFERENCE="$PROJECT/assets/reference/character-reference.png"

OPTIMIZE=""
if [ "$PASS_ID" = "optimization-pass" ]; then OPTIMIZE="--optimize"; fi

python "$HERE/author_character_spec.py" >/dev/null
python "$SKILL/forge/stage2_spec/validate_sculpt_spec.py" "$SPEC" --strict-quality
python "$SKILL/forge/stage3_build/generate_threejs_factory.py" "$SPEC" --out "$MODEL" --pass-id "$PASS_ID" --force >/dev/null
python "$HERE/apply_refinements.py" $OPTIMIZE "$MODEL"

(cd "$HERE/preview" && npx tsc -p tsconfig.json 2>&1 | grep " error TS" || true)
(cd "$HERE/preview" && node shoot.mjs ../renders "$LABEL" "${VIEWS[@]}")

RENDER="$HERE/renders/$LABEL-reference.png"
# diagnose_render exits non-zero whenever a Tier 1 threshold fails, which is information, not a
# reason to skip building the sheet the vision review actually needs.
python "$SKILL/forge/stage4_review/diagnose_render.py" --reference "$REFERENCE" --render "$RENDER" \
  --spec "$SPEC" --pass-id "$PASS_ID" --in-place > "$HERE/renders/$LABEL-diagnose.json" 2>&1 || true
python - "$HERE/renders/$LABEL-diagnose.json" <<'PY'
import json, sys
# diagnose_render prints an orchestrator STATUS banner before its JSON body.
text = open(sys.argv[1], encoding="utf-8").read()
start = text.find("{")
report = json.loads(text[start:]) if start >= 0 else {}
checks = report.get("checks", report.get("metrics", {}))
print("TIER1 passed=%s IoU=%s aspectDelta=%s symmetryError=%s maxDeltaE=%s" % (
    report.get("passed"), checks.get("silhouetteIoU"), checks.get("aspectRatioDelta"),
    checks.get("bilateralSymmetryError"), (checks.get("colorDelta") or {}).get("maxDeltaE")))
for failure in report.get("failures", []):
    print("  fail:", failure)
PY
python "$SKILL/forge/stage4_review/make_comparison_sheet.py" --reference "$REFERENCE" \
  --render "$RENDER" --out "$HERE/renders/$LABEL-cmp.png" >/dev/null
