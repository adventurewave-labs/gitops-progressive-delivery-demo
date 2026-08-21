#!/usr/bin/env bash
# Records 3 demo GIFs of the REAL running demo.
# The cluster must be running (setup.sh) and demo-controller cycling.
set -euo pipefail
BASE_URL="http://localhost:3000"
OUT_DIR="/home/z/my-project/public/showcase"
mkdir -p "$OUT_DIR"

# Verify the real cluster is running
echo "Checking cluster..."
if ! kubectl get nodes &>/dev/null 2>&1; then
    echo "FAIL: k3s not running. Run setup.sh first."
    exit 1
fi
echo "  k3s: OK"

# Verify demo controller is running (or start it)
if ! pgrep -f "cycle.sh" &>/dev/null; then
    echo "Starting demo controller in background..."
    bash demo-controller/cycle.sh &
    disown
    sleep 5
fi

# Verify dev server is running
if ! curl -sf -o /dev/null "$BASE_URL/" 2>/dev/null; then
    echo "Starting dev server..."
    cd /home/z/my-project
    KUBECONFIG=/etc/rancher/k3s/k3s.yaml \
      PROMETHEUS_URL=http://localhost:30900 \
      NODE_TLS_REJECT_UNAUTHORIZED=0 \
      setsid bun run dev > /tmp/dev.log 2>&1 < /dev/null &
    disown
    for i in {1..60}; do
        if curl -sf -o /dev/null "$BASE_URL/" 2>/dev/null; then
            echo "  dev server ready after ${i}s"
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
    local name="$1"
    local viewport_w="$2"
    local viewport_h="$3"
    local record_secs="$4"
    local scroll_y="${5:-0}"

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

    # Wait for a fresh cycle to start (idle phase)
    echo "  waiting for idle phase..."
    for i in {1..120}; do
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
    echo "  recorded: $webm (${webm_size})"

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

# Record GIFs with timing that matches the real ~2min cycle
record_gif "demo-1-pipeline"  1280 720 60 0
record_gif "demo-2-k8sgpt"    1280 720 30 1200
record_gif "demo-3-rollback"  1280 720 20 0

echo
echo "=== All GIFs recorded from REAL cluster ==="
ls -la "$OUT_DIR"