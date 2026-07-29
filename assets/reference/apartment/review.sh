#!/usr/bin/env bash
# Append one sculpt-pass review. Layer scores and per-feature scores go through files
# because inline JSON does not survive the shell to python argument hand-off.
#
# usage: review.sh <pass-id> <fidelity> <action> <ai-score> <label> "<summary>"
#        with layers-<pass-id>.json and features-<pass-id>.json already written to renders/
set -euo pipefail

PASS_ID="${1:?pass id}"
FIDELITY="${2:?fidelity}"
ACTION="${3:?action}"
AI_SCORE="${4:?ai score}"
LABEL="${5:?render label}"
SUMMARY="${6:?summary}"
MATCHED="${MATCHED:-}"
MISMATCHES="${MISMATCHES:-}"
CODE_FIXES="${CODE_FIXES:-}"
SPEC_FIXES="${SPEC_FIXES:-}"
NOTES="${NOTES:-}"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT="$(cd "$HERE/../../.." && pwd)"
SKILL="C:/Users/Mcgib/.claude/skills/img2threejs"
SPEC="$HERE/apartment-sculpt-spec.json"
REFERENCE="$PROJECT/assets/reference/apartment-reference.png"

python "$SKILL/forge/stage4_review/append_review.py" "$SPEC" \
  --pass-id "$PASS_ID" --fidelity "$FIDELITY" --action "$ACTION" --summary "$SUMMARY" \
  --reference-screenshot "$REFERENCE" \
  --render-screenshot "$HERE/renders/$LABEL-reference.png" \
  --map-stripped-render "$HERE/renders/$LABEL-reference-clay.png" \
  --comparison-image "$HERE/renders/$LABEL-cmp.png" \
  --ai-vision-score "$AI_SCORE" --visual-threshold 0.7 \
  --camera-view "reference diagonal (azimuth 45, pitch 22.44, 13.01 degree vertical field)" \
  --layer-scores-json "$HERE/renders/layers-$PASS_ID.json" \
  --feature-reviews-json "$HERE/renders/features-$PASS_ID.json" \
  --matched "$MATCHED" --mismatches "$MISMATCHES" \
  --code-fixes "$CODE_FIXES" --spec-fixes "$SPEC_FIXES" \
  --ai-vision-notes "$NOTES" \
  --in-place

python "$SKILL/forge/stage3_build/orchestrate_passes.py" sync "$SPEC" --in-place
python "$SKILL/forge/stage3_build/orchestrate_passes.py" status "$SPEC"
