#!/usr/bin/env bash
# Author spec -> strict validate -> generate factory -> apply refine-code edits -> compile the
# preview harness -> render -> Tier 1 diagnose -> comparison sheet. Kept as one script because
# skipping the harness compile step silently renders stale JavaScript.
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
SPEC="$HERE/apartment-sculpt-spec.json"
MODEL="$PROJECT/components/game/models/createApartmentModel.ts"
REFERENCE="$PROJECT/assets/reference/apartment-reference.png"

python "$HERE/author_apartment_spec.py" >/dev/null
python "$SKILL/forge/stage2_spec/validate_sculpt_spec.py" "$SPEC" --strict-quality
python "$SKILL/forge/stage3_build/generate_threejs_factory.py" "$SPEC" --out "$MODEL" --pass-id "$PASS_ID" --force >/dev/null
python "$HERE/apply_refinements.py"

(cd "$HERE/preview" && npx tsc -p tsconfig.json 2>&1 | grep " error TS" || true)
(cd "$HERE/preview" && node shoot.mjs ../renders "$LABEL" "${VIEWS[@]}" 2>&1 | grep -v "404" || true)

RENDER="$HERE/renders/$LABEL-reference.png"
# The clay render is the map-stripped evidence: identical geometry under one flat grey
# MeshStandardMaterial, so a silhouette that only holds up because of a texture cannot pass.
CLAY="$HERE/renders/$LABEL-reference-clay.png"
# diagnose_render exits non-zero whenever a Tier 1 threshold fails, which is information, not a
# reason to skip building the sheet the vision review actually needs.
if [ -f "$CLAY" ]; then
  python "$SKILL/forge/stage4_review/diagnose_render.py" --reference "$REFERENCE" --render "$RENDER" \
    --spec "$SPEC" --pass-id "$PASS_ID" --map-stripped-render "$CLAY" --in-place \
    > "$HERE/renders/$LABEL-diagnose.json" 2>&1 || true
else
  python "$SKILL/forge/stage4_review/diagnose_render.py" --reference "$REFERENCE" --render "$RENDER" \
    --spec "$SPEC" --pass-id "$PASS_ID" --in-place \
    > "$HERE/renders/$LABEL-diagnose.json" 2>&1 || true
fi
python - "$HERE/renders/$LABEL-diagnose.json" <<'PY'
import json, sys
# diagnose_render prints an orchestrator STATUS banner before its JSON body and can
# append a trailing note, so the object is bracket-matched out rather than sliced.
text = open(sys.argv[1], encoding="utf-8").read()
start = text.find("{")
depth, end = 0, start
for index in range(start, len(text)):
    if text[index] == "{":
        depth += 1
    elif text[index] == "}":
        depth -= 1
        if depth == 0:
            end = index + 1
            break
report = json.loads(text[start:end]) if start >= 0 else {}
checks = report.get("checks", report.get("metrics", {}))
print("TIER1 passed=%s IoU=%s aspectDelta=%s scaleDelta=%s symmetryError=%s maxDeltaE=%s" % (
    report.get("passed"), checks.get("silhouetteIoU"), checks.get("aspectRatioDelta"),
    checks.get("scaleDelta"), checks.get("bilateralSymmetryError"),
    (checks.get("colorDelta") or {}).get("maxDeltaE")))
for failure in report.get("failures", []):
    print("  fail:", failure)
PY
python "$SKILL/forge/stage4_review/make_comparison_sheet.py" --reference "$REFERENCE" \
  --render "$RENDER" --out "$HERE/renders/$LABEL-cmp.png" >/dev/null
