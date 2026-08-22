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

// argv: url outDir width height seconds scrollSelector
const [url, outDir, w, h, secs, scrollSelector] = process.argv.slice(2);
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

// The dashboard renders a "connecting to cluster..." spinner until the first
// /api/cluster-state response lands. Scrolling or recording before that gives
// a clip of the spinner, so wait for real content to exist.
await page.waitForSelector('[data-demo="rollouts"]', { timeout: 60000 });
await page.waitForTimeout(1500); // let the first paint settle; trimmed by ffmpeg -ss

if (scrollSelector && scrollSelector !== '-') {
  const target = page.locator(scrollSelector).first();
  await target.waitFor({ state: 'visible', timeout: 30000 });
  await target.scrollIntoViewIfNeeded();
  await page.waitForTimeout(700);
  // Fail loudly rather than silently record the top of the page.
  const inView = await target.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return r.top >= -20 && r.top < window.innerHeight;
  });
  if (!inView) throw new Error(`scroll target ${scrollSelector} is not in view`);
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

# Block until the reported phase matches an ERE, or fail. Recording without
# this is how you end up with 60s of an idle dashboard captioned as a canary
# rollout - which is exactly what the first cut of these GIFs was.
wait_for_phase() {
    local pattern="$1" timeout="$2" label="$3" p=""
    echo "  waiting for phase ~ /${pattern}/ (up to ${timeout}s)..."
    for i in $(seq 1 "${timeout}"); do
        p="$(cluster_phase)"
        if printf %s "${p}" | grep -Eq "^(${pattern})$"; then
            echo "  phase '${p}' reached after ${i}s"
            return 0
        fi
        sleep 1
    done
    echo "FAIL: ${label}: phase never matched /${pattern}/ within ${timeout}s (last: '${p}')."
    echo "      Is demo-controller/cycle.sh actually running? See /tmp/cycle.log"
    return 1
}

record_gif() {
    local name="$1" vw="$2" vh="$3" secs="$4" scroll_sel="$5" start_pattern="$6" wait_secs="${7:-300}"
    local work="/tmp/gifrec-${name}"
    local palette="/tmp/${name}-palette.png"
    local gif="${OUT_DIR}/${name}.gif"
    local phases="/tmp/${name}-phases.txt"

    rm -rf "${work}"; mkdir -p "${work}"

    echo ""
    echo "=== Recording ${name}.gif (${vw}x${vh}, ${secs}s) ==="

    wait_for_phase "${start_pattern}" "${wait_secs}" "${name}" || return 1

    # Sample the phase for the whole clip so we can prove afterwards that the
    # pipeline actually moved while the camera was rolling.
    : > "${phases}"
    ( while true; do cluster_phase >> "${phases}"; sleep 2; done ) &
    local sampler=$!

    local webm rc=0
    webm="$(cd "${PW_DIR}" && "${JS_RUN}" record-clip.mjs "${BASE_URL}" "${work}" "${vw}" "${vh}" "${secs}" "${scroll_sel}")" || rc=$?
    kill "${sampler}" 2>/dev/null || true
    wait "${sampler}" 2>/dev/null || true

    if [ "${rc}" -ne 0 ] || [ ! -f "${webm}" ]; then
        echo "FAIL: no video produced for ${name}"
        return 1
    fi
    echo "  recorded: ${webm} ($(du -h "${webm}" | cut -f1))"

    local distinct
    distinct="$(sort -u "${phases}" | grep -c . || true)"
    echo "  phases seen while recording: $(sort -u "${phases}" | tr '\n' ' ')"
    if [ "${distinct}" -lt 2 ]; then
        echo "FAIL: ${name}: the dashboard sat in a single phase for the whole clip."
        echo "      A still frame is not a demo - not writing ${gif}."
        return 1
    fi

    local gif_w=$(( vw > 900 ? 900 : vw ))

    echo "  pass 1: palette..."
    ffmpeg -y -loglevel error -ss 2 -i "${webm}" \
        -vf "fps=8,scale=${gif_w}:-1:flags=lanczos,palettegen=stats_mode=diff" \
        "${palette}"

    echo "  pass 2: gif encoding..."
    ffmpeg -y -loglevel error -ss 2 -i "${webm}" -i "${palette}" \
        -lavfi "fps=8,scale=${gif_w}:-1:flags=lanczos [x]; [x][1:v] paletteuse=dither=bayer:bayer_scale=5" \
        "${gif}"

    rm -rf "${work}" "${palette}" "${phases}"
    echo "  GIF: ${gif} ($(du -h "${gif}" | cut -f1))"
}

# -----------------------------------------------------------------------------
# Record - each clip starts on the phase transition it claims to show, so the
# caption in README.md and public/showcase/index.html is what you actually see.
# -----------------------------------------------------------------------------
# 1. The cycle from the top: Argo CD sync -> canary 20% -> canary 50%.
#    Wait out any in-flight cycle first so we catch the next one from idle.
wait_for_phase "idle" 420 "demo-1-pipeline (settle)" || exit 1
record_gif "demo-1-pipeline"  1280 720 60 '-'                      'syncing|canary20' 300 || exit 1

# 2. The analyzer + GLM-4.5 card, once there is something to analyse.
record_gif "demo-2-diagnosis" 1280 720 30 '[data-demo="analyzer"]' 'anomaly|analyzing' 300 || exit 1

# 3. The abort itself.
record_gif "demo-3-rollback"  1280 720 20 '-'                      'rollback'         300 || exit 1

echo ""
echo "=== All GIFs recorded from the REAL cluster, each verified to span >1 phase ==="
ls -la "${OUT_DIR}"
