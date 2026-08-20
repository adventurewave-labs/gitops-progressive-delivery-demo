#!/usr/bin/env bash
# Records a ~30s demo of the GitOps progressive delivery pipeline and
# converts it to an optimized GIF embedded in the README.
#
# Workflow:
#   1. Open the app at desktop viewport (1440x900)
#   2. Start recording (agent-browser record start)
#   3. Click "Start Rollout (v2.4)"
#   4. Let the full pipeline play out (~20s of state machine + buffer)
#   5. Click "Reset Demo" to show the cycle restarts cleanly (~3s)
#   6. Stop recording -> demo.webm
#   7. Convert webm -> GIF with ffmpeg using a generated palette for quality

set -euo pipefail

BASE_URL="http://localhost:3000"
WEBM_OUT="/home/z/my-project/scripts/demo.webm"
GIF_PALETTE="/home/z/my-project/scripts/palette.png"
GIF_OUT="/home/z/my-project/scripts/demo.gif"
GIF_FINAL="/home/z/my-project/public/demo.gif"

echo "=== Demo recording script ==="
echo "Target: $BASE_URL"
echo

# Preflight
if ! curl -s --fail -o /dev/null "$BASE_URL"; then
  echo "FAIL: dev server not reachable at $BASE_URL"
  exit 1
fi

# Open + reset to a known idle state
agent-browser open "$BASE_URL" >/dev/null 2>&1
agent-browser wait 2500 >/dev/null 2>&1
agent-browser set viewport 1440 900 >/dev/null 2>&1
agent-browser wait 500 >/dev/null 2>&1

# Make sure we're in idle (click Reset if we somehow aren't)
RESET_REF=$(agent-browser snapshot -i 2>&1 | grep "Reset Demo" | head -1 | sed -nE 's/.*\[ref=(e[0-9]+)\].*/\1/p' || true)
if [ -n "$RESET_REF" ]; then
  agent-browser click "@${RESET_REF}" >/dev/null 2>&1
  agent-browser wait 1000 >/dev/null 2>&1
fi

# Start recording
echo "Starting recording..."
agent-browser record start "$WEBM_OUT" >/dev/null 2>&1
agent-browser wait 800 >/dev/null 2>&1

# Click Start Rollout
START_REF=$(agent-browser snapshot -i 2>&1 | grep "Start Rollout" | head -1 | sed -nE 's/.*\[ref=(e[0-9]+)\].*/\1/p')
if [ -z "$START_REF" ]; then
  echo "FAIL: could not find Start Rollout button"
  agent-browser record stop >/dev/null 2>&1
  exit 1
fi
echo "Clicking Start Rollout (@${START_REF})..."
agent-browser click "@${START_REF}" >/dev/null 2>&1

# Let the full pipeline play out:
#   syncing(3s) + canary20(4s) + canary50(3s) + anomaly(2s) + analyzing(8s) = 20s
# Plus a 2s hold on the final rollback state to admire the result.
echo "Letting pipeline play out (~22s)..."
agent-browser wait 22000 >/dev/null 2>&1

# Click Reset to demonstrate the cycle restarts cleanly (extra ~3s of footage)
echo "Clicking Reset Demo to show cycle restarts..."
RESET_REF=$(agent-browser snapshot -i 2>&1 | grep "Reset Demo" | head -1 | sed -nE 's/.*\[ref=(e[0-9]+)\].*/\1/p')
if [ -n "$RESET_REF" ]; then
  agent-browser click "@${RESET_REF}" >/dev/null 2>&1
  agent-browser wait 3000 >/dev/null 2>&1
fi

# Stop recording
echo "Stopping recording..."
agent-browser record stop >/dev/null 2>&1
agent-browser wait 500 >/dev/null 2>&1

# Verify the webm exists
if [ ! -f "$WEBM_OUT" ]; then
  echo "FAIL: recording file not created at $WEBM_OUT"
  exit 1
fi

WEBM_SIZE=$(du -h "$WEBM_OUT" | cut -f1)
WEBM_DUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$WEBM_OUT" 2>/dev/null || echo "?")
echo "Recorded: $WEBM_OUT (${WEBM_SIZE}, ${WEBM_DUR}s)"

# Convert to GIF in two passes:
#   Pass 1: generate a 256-color palette optimized for this video
#   Pass 2: use the palette to produce a high-quality GIF
#
# fps=12 keeps the GIF smooth without ballooning file size.
# scale=720:-1 fits GitHub README column nicely (downscale from 1440).
# split palette + stats_mode=diff is the standard "high-quality GIF" recipe.
echo
echo "Generating optimized GIF..."
echo "  Pass 1: palette generation..."
ffmpeg -y -i "$WEBM_OUT" \
  -vf "fps=12,scale=720:-1:flags=lanczos,palettegen=stats_mode=diff" \
  "$GIF_PALETTE" 2>&1 | tail -3

echo "  Pass 2: GIF encoding with palette..."
ffmpeg -y -i "$WEBM_OUT" -i "$GIF_PALETTE" \
  -lavfi "fps=12,scale=720:-1:flags=lanczos [x]; [x][1:v] paletteuse=dither=bayer:bayer_scale=5" \
  "$GIF_OUT" 2>&1 | tail -3

if [ ! -f "$GIF_OUT" ]; then
  echo "FAIL: GIF not created at $GIF_OUT"
  exit 1
fi

GIF_SIZE=$(du -h "$GIF_OUT" | cut -f1)
GIF_DUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$GIF_OUT" 2>/dev/null || echo "?")
echo
echo "=== SUCCESS ==="
echo "GIF: $GIF_OUT"
echo "Size: $GIF_SIZE"
echo "Duration: ${GIF_DUR}s"

# Copy into /public so it ships with the Next.js app and is accessible
# at /demo.gif from the deployed site.
cp "$GIF_OUT" "$GIF_FINAL"
echo "Copied to: $GIF_FINAL (served at /demo.gif)"
