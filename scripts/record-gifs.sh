#!/usr/bin/env bash
# =============================================================================
# record-gifs.sh — Records demo GIFs of the REAL running demo.
#
# Requires: the cluster up (bash setup.sh), the dashboard running
# (bash dev-real.sh) and the demo controller cycling
# (bash demo-controller/cycle.sh). It will start the last two itself if they
# are not already running.
#
# Recording is done with Playwright (Chromium, recordVideo) and encoded to GIF
# with ffmpeg. Both are installed on first run into ./.playwright (gitignored),
# so this works on a fresh clone with no proprietary tooling.
# =============================================================================
set -euo pipefail

# A stale KUBECONFIG pointing at a file that does not exist breaks every
# kubectl call; fall back to the k3d kubeconfig in that case.
if [ -n "${KUBECONFIG:-}" ] && [ ! -f "${KUBECONFIG}" ]; then unset KUBECONFIG; fi

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASE_URL="${BASE_URL:-http://localhost:3000}"
OUT_DIR="${OUT_DIR:-${REPO_DIR}/public/showcase}"
PW_DIR="${REPO_DIR}/.playwright"
PW_VERSION="${PW_VERSION:-1.49.1}"

export KUBECONFIG="${KUBECONFIG:-${HOME}/.k3d/kubeconfig-gitops-demo.yaml}"
export PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-${HOME}/.cache/ms-playwright}"

cd "${REPO_DIR}"
mkdir -p "${OUT_DIR}"

SUDO=""
if [ "$(id -u)" -ne 0 ]; then SUDO="sudo"; fi

# -----------------------------------------------------------------------------
# Preflight
# -----------------------------------------------------------------------------
echo "Checking cluster..."
if ! kubectl get nodes &>/dev/null; then
    echo "FAIL: cluster not reachable (KUBECONFIG=${KUBECONFIG}). Run: bash setup.sh"
    exit 1
fi
echo "  cluster: OK"

if ! command -v ffmpeg &>/dev/null; then
    echo "Installing ffmpeg..."
    ${SUDO} apt-get update -qq
    ${SUDO} apt-get install -y -qq ffmpeg libnss3 libnspr4
fi
echo "  ffmpeg: $(ffmpeg -version | head -1 | cut -d' ' -f1-3)"

# The devcontainer ships bun but not node/npm; support either runtime.
if command -v npm &>/dev/null && command -v node &>/dev/null; then
    JS_RUN="node"
    PW_INSTALL_CMD=(npm install --silent --no-audit --no-fund)
    PW_X=(npx --yes playwright)
elif command -v bun &>/dev/null; then
    JS_RUN="bun"
    PW_INSTALL_CMD=(bun add)
    PW_X=(bun x playwright)
else
    echo "FAIL: need node+npm or bun on PATH to run Playwright."
    exit 1
fi
echo "  js runtime: ${JS_RUN}"

if [ ! -d "${PW_DIR}/node_modules/playwright" ]; then
    echo "Installing Playwright ${PW_VERSION} into .playwright/ (first run only)..."
    mkdir -p "${PW_DIR}"
    ( cd "${PW_DIR}" \
      && printf %s "{\"name\":\"gifs-recorder\",\"private\":true}" > package.json \
      && "${PW_INSTALL_CMD[@]}" "playwright@${PW_VERSION}" >/dev/null )
fi
echo "  playwright: ${PW_VERSION}"

echo "Ensuring Chromium is installed for Playwright..."
( cd "${PW_DIR}" && "${PW_X[@]}" install chromium >/dev/null )

# Demo controller
if ! pgrep -f "demo-controller/cycle.sh" >/dev/null 2>&1; then
    echo "Starting demo controller in background..."
    setsid bash "${REPO_DIR}/demo-controller/cycle.sh" > /tmp/cycle.log 2>&1 < /dev/null &
    disown || true
    sleep 5
fi
echo "  demo controller: running"

# Dashboard
if ! curl -sf -o /dev/null "${BASE_URL}/" 2>/dev/null; then
    echo "Starting dashboard..."
    setsid bash "${REPO_DIR}/dev-real.sh" > /tmp/dev.log 2>&1 < /dev/null &
    disown || true
    for i in $(seq 1 90); do
        if curl -sf -o /dev/null "${BASE_URL}/" 2>/dev/null; then
            echo "  dashboard ready after ${i}s"
            break
        fi
        sleep 1
    done
fi
if ! curl -sf -o /dev/null "${BASE_URL}/"; then
    echo "FAIL: dashboard not reachable at ${BASE_URL}. Run: bash dev-real.sh"
    exit 1
fi
echo "  dashboard: OK"

# -----------------------------------------------------------------------------
# Playwright clip recorder (written once, reused for every clip)
# -----------------------------------------------------------------------------
cat > "${PW_DIR}/record-clip.mjs" <<'MJS'
import { chromium } from 'playwright';

const [url, outDir, w, h, secs, scrollY] = process.argv.slice(2);
const width = Number(w), height = Number(h);

const browser = await chromium.launch({
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--force-color-profile=srgb'],
});
const ctx = await browser.newContext({
  viewport: { width, height },
  recordVideo: { dir: outDir, size: { width, height } },
  deviceScaleFactor: 1,
});
const page = await ctx.newPage();

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
await page.waitForTimeout(3000); // settle; trimmed off by ffmpeg -ss

if (Number(scrollY) > 0) {
  await page.evaluate((y) => window.scrollTo(0, y), Number(scrollY));
  await page.waitForTimeout(500);
}

await page.waitForTimeout(Number(secs) * 1000);

const video = page.video();
await ctx.close();          // video is only flushed on context close
const out = await video.path();
await browser.close();
console.log(out);
MJS

# -----------------------------------------------------------------------------
# Helpers
# -----------------------------------------------------------------------------
cluster_phase() {
    curl -s "${BASE_URL}/api/cluster-state" \
        | grep -o '"phase":"[^"]*"' | head -1 | cut -d'"' -f4
}

record_gif() {
    local name="$1" vw="$2" vh="$3" secs="$4" scroll_y="${5:-0}"
    local work="/tmp/gifrec-${name}"
    local palette="/tmp/${name}-palette.png"
    local gif="${OUT_DIR}/${name}.gif"

    rm -rf "${work}"; mkdir -p "${work}"

    echo ""
    echo "=== Recording ${name}.gif (${vw}x${vh}, ${secs}s) ==="

    echo "  waiting for a fresh cycle (idle phase)..."
    for i in $(seq 1 180); do
        if [ "$(cluster_phase)" = "idle" ]; then
            echo "  idle phase reached after ${i}s"
            break
        fi
        sleep 1
    done

    local webm
    webm="$(cd "${PW_DIR}" && "${JS_RUN}" record-clip.mjs "${BASE_URL}" "${work}" "${vw}" "${vh}" "${secs}" "${scroll_y}")"

    if [ ! -f "${webm}" ]; then
        echo "FAIL: no video produced for ${name}"
        return 1
    fi
    echo "  recorded: ${webm} ($(du -h "${webm}" | cut -f1))"

    local gif_w=$(( vw > 1024 ? 1024 : vw ))

    echo "  pass 1: palette..."
    ffmpeg -y -loglevel error -ss 3 -i "${webm}" \
        -vf "fps=10,scale=${gif_w}:-1:flags=lanczos,palettegen=stats_mode=diff" \
        "${palette}"

    echo "  pass 2: gif encoding..."
    ffmpeg -y -loglevel error -ss 3 -i "${webm}" -i "${palette}" \
        -lavfi "fps=10,scale=${gif_w}:-1:flags=lanczos [x]; [x][1:v] paletteuse=dither=bayer:bayer_scale=5" \
        "${gif}"

    rm -rf "${work}" "${palette}"
    echo "  GIF: ${gif} ($(du -h "${gif}" | cut -f1))"
}

# -----------------------------------------------------------------------------
# Record — timings match the real ~3-4 min cycle
# -----------------------------------------------------------------------------
record_gif "demo-1-pipeline" 1280 720 60 0
record_gif "demo-2-k8sgpt"   1280 720 30 1200
record_gif "demo-3-rollback" 1280 720 20 0

echo ""
echo "=== All GIFs recorded from the REAL cluster ==="
ls -la "${OUT_DIR}"
