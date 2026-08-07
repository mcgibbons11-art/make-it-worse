#!/usr/bin/env bash
# Cuts a recorded clip into a finished social post.
#
# Deliberately ships WITHOUT a music bed. Baked-in music is what gets a post
# muted or region-blocked, and every short-form platform wants its own
# trending audio chosen at upload anyway. The beats below are timed so a track
# dropped on top lands with the fall.
set -euo pipefail

CLIP="$1"
OUT="$2"
SHAPE="${3:-vertical}"
FONT="C\:/Windows/Fonts/seguibl.ttf"

T1="${T1:-every level starts clean}"
T2="${T2:-then your friends get to it}"
T3="${T3:-MAKE IT WORSE}"
T4="${T4:-beat it. ruin it. send it on.}"

if [ "$SHAPE" = "vertical" ]; then
  W=1080; H=1920; TOP=640; HOOK=380; TAG=1440; SIZE=64; BIG=112
else
  W=1920; H=1080; TOP=150; HOOK=54; TAG=960; SIZE=52; BIG=88
fi
SMALL=$((SIZE - 8))

# The frame is filled by a blown-up blurred copy of the same footage with the
# sharp one centred over it. A flat colour left half a vertical frame empty,
# which reads as a cropped desktop clip rather than something cut for the
# format. The background scales to COVER, so it is sized by height then
# trimmed to width.
ffmpeg -y -v error -i "$CLIP" -filter_complex "\
[0:v]scale=-2:${H},crop=${W}:${H},boxblur=30:2,eq=brightness=0.05:saturation=0.8,setsar=1[bg];\
[0:v]scale=${W}:-2,setsar=1[vid];\
[bg][vid]overlay=(W-w)/2:${TOP}:shortest=1[base];\
[base]drawtext=fontfile='${FONT}':text='${T1}':fontcolor=white:fontsize=${SIZE}:borderw=7:bordercolor=0x14213D:x=(w-text_w)/2:y=${HOOK}:enable='between(t,0.2,2.6)',\
drawtext=fontfile='${FONT}':text='${T2}':fontcolor=white:fontsize=${SIZE}:borderw=7:bordercolor=0x14213D:x=(w-text_w)/2:y=${HOOK}:enable='between(t,2.8,5.4)',\
drawtext=fontfile='${FONT}':text='${T3}':fontcolor=0xFF4D5A:fontsize=${BIG}:borderw=9:bordercolor=white:x=(w-text_w)/2:y=${HOOK}-30:enable='gt(t,5.6)',\
drawtext=fontfile='${FONT}':text='${T4}':fontcolor=white:fontsize=${SMALL}:borderw=6:bordercolor=0x14213D:x=(w-text_w)/2:y=${TAG}:enable='gt(t,5.6)'[out]" \
  -map "[out]" -r 30 -c:v libx264 -pix_fmt yuv420p -crf 18 -preset slow -movflags +faststart -an "$OUT"

echo "wrote $OUT"
