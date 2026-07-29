#!/usr/bin/env bash
# Append one sculpt-pass review and advance the pipeline.
# Usage: ./review.sh <pass-id> <label> <fidelity> <ai-score> <summary>
# Layer scores and feature reviews are read from renders/<label>-review.json, which the
# reviewing agent writes after LOOKING at renders/<label>-cmp.png.
set -euo pipefail

PASS_ID="$1"; LABEL="$2"; FIDELITY="$3"; AI_SCORE="$4"; SUMMARY="$5"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT="$(cd "$HERE/../../.." && pwd)"
SKILL="C:/Users/Mcgib/.claude/skills/img2threejs"
SPEC="$HERE/hammer-sculpt-spec.json"
REVIEW="$HERE/renders/$LABEL-review.json"

python - "$REVIEW" "$HERE/renders" "$LABEL" <<'PYEOF'
import json, sys
from pathlib import Path
review = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
renders, label = Path(sys.argv[2]), sys.argv[3]
Path(renders / f"layers-{label}.json").write_text(
    json.dumps(review["layerScores"]), encoding="utf-8")
Path(renders / f"features-{label}.json").write_text(
    json.dumps(review["featureReviews"]), encoding="utf-8")
PYEOF

ARGS=("$SPEC" --pass-id "$PASS_ID" --fidelity "$FIDELITY" --action continue
      --summary "$SUMMARY"
      --reference-screenshot "$PROJECT/assets/reference/hammer-reference.png"
      --render-screenshot "$HERE/renders/$LABEL-reference.png"
      --comparison-image "$HERE/renders/$LABEL-cmp.png"
      --map-stripped-render "$HERE/renders/$LABEL-reference-clay.png"
      --ai-vision-score "$AI_SCORE" --visual-threshold 0.7
      --camera-view "reference-bracketed (azimuth 6, elevation 6)"
      --layer-scores-json "$HERE/renders/layers-$LABEL.json"
      --feature-reviews-json "$HERE/renders/features-$LABEL.json"
      --in-place)

python - "$REVIEW" <<'PYEOF' > "$HERE/renders/extra-args.txt"
import json, sys
from pathlib import Path
review = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
for key, flag in (("matched", "--matched"), ("mismatches", "--mismatches"),
                  ("specFixes", "--spec-fixes"), ("codeFixes", "--code-fixes"),
                  ("evidence", "--evidence")):
    for item in review.get(key, []):
        print(flag); print(item)
if review.get("notes"):
    print("--ai-vision-notes"); print(review["notes"])
PYEOF

# python's print writes CRLF here, and a flag carrying a trailing CR reads to argparse
# as an unknown option rather than as --matched.
mapfile -t EXTRA < <(tr -d '\r' < "$HERE/renders/extra-args.txt")
rm -f "$HERE/renders/extra-args.txt"

(cd "$SKILL" && python forge/stage4_review/append_review.py "${ARGS[@]}" "${EXTRA[@]}")
(cd "$SKILL" && python forge/stage3_build/orchestrate_passes.py sync "$SPEC" --in-place | head -4)
