#!/usr/bin/env bash
# Records 3 demo GIFs of the real running app and converts them to
# optimized animated GIFs that get embedded in the static showcase HTML.
#
#   demo-1-pipeline.gif   — full pipeline walkthrough (~25s, 1280x720)
#   demo-2-k8sgpt.gif     — K8sGPT terminal + real GLM-4.5 stream  (~15s)
#   demo-3-rollback.gif   — traffic pipe rollback transition (~8s)

set -euo pipefail
BASE_URL="http://localhost:3000"
OUT_DIR="/home/z/my-project/public/showcase"
mkdir -p "$OUT_DIR"

# Start dev server if needed
if ! curl -sf -o /dev/null "$BASE_URL/" 2>/dev/null; then
  echo "Starting dev server..."
  cd /home/z/my-project
  setsid bun run dev > /tmp/dev.log 2>&1 < /dev/null &
  disown
  for i in {1..60}; do
    if curl -sf -o /dev/null "$BASE_URL/" 2>/dev/null; then
      echo "  ready after ${i}s"
      break
    fi
    sleep 1
  done
fi
if ! curl -sf -o /dev/null "$BASE_URL/"; then
  echo "FAIL: server not reachable"
  exit 1
fi

record_gif() {
  local name="$1"      # demo-1-pipeline
  local viewport_w="$2"
  local viewport_h="$3"
  local record_secs="$4"
  local scroll_y="${5:-0}"  # optional: scroll to this Y before recording

  local webm="/tmp/${name}.webm"
  local palette="/tmp/${name}-palette.png"
  local gif="${OUT_DIR}/${name}.gif"

  echo
  echo "=== Recording ${name}.gif (${viewport_w}x${viewport_h}, ${record_secs}s) ==="

  agent-browser open "$BASE_URL" >/dev/null 2>&1
  agent-browser wait 2000 >/dev/null 2>&1
  agent-browser set viewport "$viewport_w" "$viewport_h" >/dev/null 2>&1
  agent-browser wait 500 >/dev/null 2>&1

  if [ "$scroll_y" != "0" ]; then
    agent-browser eval "window.scrollTo(0, $scroll_y)" >/dev/null 2>&1
    agent-browser wait 500 >/dev/null 2>&1
  fi

  # Poll until we're in the idle phase so we start clean
  echo "  waiting for idle phase..."
  for i in {1..30}; do
    local phase=$(curl -s "$BASE_URL/api/cluster-state" | jq -r '.phase')
    if [ "$phase" = "idle" ]; then
      echo "  idle phase reached after ${i}s"
      break
    fi
    sleep 1
  done

  agent-browser record start "$webm" >/dev/null 2>&1
  agent-browser wait "$((record_secs * 1000))" >/dev/null 2>&1
  agent-browser record stop >/dev/null 2>&1
  agent-browser wait 500 >/dev/null 2>&1

  if [ ! -f "$webm" ]; then
    echo "FAIL: $webm not created"
    return 1
  fi

  local webm_size=$(du -h "$webm" | cut -f1)
  local dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$webm" 2>/dev/null || echo "?")
  echo "  recorded: $webm (${webm_size}, ${dur}s)"

  # Two-pass GIF: palette gen, then paletteuse
  local gif_w=$((viewport_w > 1024 ? 1024 : viewport_w))
  echo "  pass 1: palette..."
  ffmpeg -y -i "$webm" \
    -vf "fps=10,scale=${gif_w}:-1:flags=lanczos,palettegen=stats_mode=diff" \
    "$palette" 2>&1 | tail -2

  echo "  pass 2: gif encoding..."
  ffmpeg -y -i "$webm" -i "$palette" \
    -lavfi "fps=10,scale=${gif_w}:-1:flags=lanczos [x]; [x][1:v] paletteuse=dither=bayer:bayer_scale=5" \
    "$gif" 2>&1 | tail -2

  local gif_size=$(du -h "$gif" | cut -f1)
  echo "  GIF: $gif ($gif_size)"
}

record_gif "demo-1-pipeline"  1280 720 26 0
record_gif "demo-2-k8sgpt"    1280 720 14 1200
record_gif "demo-3-rollback"  1280 720 10 0

echo
echo "=== All GIFs recorded ==="
ls -la "$OUT_DIR"
