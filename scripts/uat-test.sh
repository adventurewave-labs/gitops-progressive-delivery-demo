#!/usr/bin/env bash
# UAT (User Acceptance Testing) script for gitops-progressive-delivery-demo.
#
# Exercises the full pipeline state machine end-to-end and validates every
# state's UI contract, then runs edge-case tests. Produces a JSON report at
# /home/z/my-project/scripts/uat-report.json and a human-readable summary on
# stdout. Exits non-zero if any test fails.
#
# Run it from anywhere — the script uses absolute paths and assumes the dev
# server is already up at http://localhost:3000.

set -uo pipefail

BASE_URL="http://localhost:3000"
REPORT="/home/z/my-project/scripts/uat-report.json"
RESULTS=()
PASS=0
FAIL=0

# ---------- helpers -----------------------------------------------------------

# Pretty colors for terminal output
GREEN=$'\033[32m'
RED=$'\033[31m'
YELLOW=$'\033[33m'
RESET=$'\033[0m'

record() {
  # record <name> <status> <detail>
  local name="$1" status="$2" detail="$3"
  RESULTS+=("$(jq -n --arg n "$name" --arg s "$status" --arg d "$detail" \
    '{name:$n, status:$s, detail:$d}')")
  if [ "$status" = "PASS" ]; then
    echo "${GREEN}✓ PASS${RESET}  $name — $detail"
    PASS=$((PASS + 1))
  else
    echo "${RED}✗ FAIL${RESET}  $name — $detail"
    FAIL=$((FAIL + 1))
  fi
}

# ---------- pre-flight: server reachable -------------------------------------
echo "${YELLOW}=== UAT: gitops-progressive-delivery-demo ===${RESET}"
echo "Target: $BASE_URL"
echo

if ! curl -s --fail -o /dev/null "$BASE_URL"; then
  record "server-up" "FAIL" "dev server not reachable at $BASE_URL"
  exit 1
fi
record "server-up" "PASS" "HTTP 200 from $BASE_URL"

# ---------- launch browser ---------------------------------------------------
agent-browser open "$BASE_URL" >/dev/null 2>&1
agent-browser wait 2500 >/dev/null 2>&1
agent-browser set viewport 1440 900 >/dev/null 2>&1

# ---------- helper: read a value out of the rendered page --------------------
get_state_badge() {
  # The footer renders `state: <span class="font-mono text-zinc-400">idle</span>`
  # (see src/app/page.tsx). That span is the single source of truth for the
  # current pipeline state. Query it directly to avoid body.textContent
  # contamination from Next.js's hydration scripts (e.g. `self.__next_r=...`).
  agent-browser eval "document.querySelector('footer span.text-zinc-400')?.textContent.trim() || 'unknown'" 2>&1 | tail -1 | tr -d '"'
}

get_terminal_line_count() {
  agent-browser eval "document.querySelectorAll('.space-y-1 > div').length" 2>&1 | tail -1
}

get_traffic_split() {
  agent-browser eval "(() => { const m = document.body.innerText.match(/stable\s+(\d+)%\s*\/\s*canary\s+(\d+)%/i); return m ? m[1]+'/'+m[2] : 'n/a'; })()" 2>&1 | tail -1 | tr -d '"'
}

get_slo_status() {
  agent-browser eval "Array.from(document.querySelectorAll('span')).find(s => s.innerText.match(/SLO (HEALTHY|VIOLATED)/))?.innerText || 'n/a'" 2>&1 | tail -1 | tr -d '"'
}

# ---------- Test 1: Initial idle state ---------------------------------------
echo
echo "${YELLOW}--- Test 1: Idle state ---${RESET}"

# Page title
TITLE=$(agent-browser get title 2>&1 | tail -1)
if echo "$TITLE" | grep -qi "GitOps Progressive Delivery"; then
  record "title-correct" "PASS" "Page title: $TITLE"
else
  record "title-correct" "FAIL" "Page title not expected: '$TITLE'"
fi

# All 4 card headers present
CARDS=$(agent-browser eval "JSON.stringify(['Argo CD','Argo Rollouts','Prometheus','K8sGPT'].filter(t => document.body.innerText.includes(t)))" 2>&1 | tail -1)
# The eval output is a JSON-stringified string (double-encoded); parse it with jq -r
CARD_PARSED=$(echo "$CARDS" | jq -r '.' 2>/dev/null)
CARD_COUNT=$(echo "$CARD_PARSED" | jq 'length' 2>/dev/null || echo 0)
if [ "$CARD_COUNT" = "4" ]; then
  record "all-4-cards-present" "PASS" "Argo CD + Argo Rollouts + Prometheus + K8sGPT all visible"
else
  record "all-4-cards-present" "FAIL" "Only $CARD_COUNT of 4 cards visible"
fi

# Start Rollout button present
BTN=$(agent-browser snapshot -i 2>&1 | grep -i "Start Rollout" | head -1)
if [ -n "$BTN" ]; then
  record "start-rollout-button" "PASS" "Start Rollout v2.4 button present"
else
  record "start-rollout-button" "FAIL" "Start Rollout button not found"
fi

# Initial state should be idle
STATE=$(get_state_badge)
if [ "$STATE" = "idle" ]; then
  record "initial-state-idle" "PASS" "Pipeline starts in IDLE state"
else
  record "initial-state-idle" "FAIL" "Expected idle, got '$STATE'"
fi

# Initial traffic split should be 100/0
SPLIT=$(get_traffic_split)
if [ "$SPLIT" = "100/0" ]; then
  record "initial-traffic-100-0" "PASS" "Initial traffic 100% stable / 0% canary"
else
  record "initial-traffic-100-0" "FAIL" "Expected 100/0, got '$SPLIT'"
fi

# SLO should be HEALTHY initially
SLO=$(get_slo_status)
if [ "$SLO" = "SLO HEALTHY" ]; then
  record "initial-slo-healthy" "PASS" "Initial SLO status: HEALTHY"
else
  record "initial-slo-healthy" "FAIL" "Expected SLO HEALTHY, got '$SLO'"
fi

# Terminal should show idle prompt
TERMINAL=$(agent-browser eval "document.body.innerText.includes('awaiting trigger') ? 'yes' : 'no'" 2>&1 | tail -1 | tr -d '"')
if [ "$TERMINAL" = "yes" ]; then
  record "terminal-idle-prompt" "PASS" "K8sGPT terminal shows 'awaiting trigger' idle prompt"
else
  record "terminal-idle-prompt" "FAIL" "Terminal idle prompt not visible"
fi

# ---------- Test 2: Click Start Rollout -------------------------------------
echo
echo "${YELLOW}--- Test 2: Syncing state ---${RESET}"

# Find + click the Start Rollout button
BTN_REF=$(agent-browser snapshot -i 2>&1 | grep "Start Rollout" | head -1 | sed -nE 's/.*\[ref=(e[0-9]+)\].*/\1/p')
if [ -z "$BTN_REF" ]; then
  record "click-start-rollout" "FAIL" "Could not find Start Rollout button ref"
  exit 1
fi
agent-browser click "@${BTN_REF}" >/dev/null 2>&1
agent-browser wait 1500 >/dev/null 2>&1

# Single combined eval — captures state AND applying flag in one shot to
# avoid race where the 3s syncing window expires between two eval calls.
COMBO=$(agent-browser eval "JSON.stringify({state: document.querySelector('footer span.text-zinc-400')?.textContent.trim() || 'unknown', applying: document.body.textContent.includes('Applying')})" 2>&1 | tail -1 | sed 's/^"//; s/"$//; s/\\"/"/g')
STATE=$(echo "$COMBO" | jq -r '.state' 2>/dev/null || echo "unknown")
APPLYING=$(echo "$COMBO" | jq -r '.applying' 2>/dev/null || echo "false")

if [ "$STATE" = "syncing" ]; then
  record "transitions-to-syncing" "PASS" "After click, state = SYNCING"
else
  record "transitions-to-syncing" "FAIL" "Expected syncing, got '$STATE'"
fi

# Sync arrow should be visible / pulsing during syncing
if [ "$APPLYING" = "true" ]; then
  record "syncing-arrow-pulsing" "PASS" "Argo CD arrow shows 'Applying' state"
else
  record "syncing-arrow-pulsing" "FAIL" "Sync indicator not visible (state=$STATE, applying=$APPLYING)"
fi

# ---------- Test 3: Canary 20% ----------------------------------------------
echo
echo "${YELLOW}--- Test 3: Canary 20% state ---${RESET}"
agent-browser wait 3000 >/dev/null 2>&1

# Combined: state + "Synced" indicator presence (avoid race with state advance)
COMBO=$(agent-browser eval "JSON.stringify({state: document.querySelector('footer span.text-zinc-400')?.textContent.trim() || 'unknown', synced: document.body.textContent.includes('Synced')})" 2>&1 | tail -1 | sed 's/^"//; s/"$//; s/\\"/"/g')
STATE=$(echo "$COMBO" | jq -r '.state' 2>/dev/null || echo "unknown")
SYNCED=$(echo "$COMBO" | jq -r '.synced' 2>/dev/null || echo "false")

if [ "$STATE" = "canary20" ]; then
  record "transitions-to-canary20" "PASS" "After ~3s, state = CANARY 20%"
else
  record "transitions-to-canary20" "FAIL" "Expected canary20, got '$STATE'"
fi

SPLIT=$(get_traffic_split)
if [ "$SPLIT" = "80/20" ]; then
  record "canary20-traffic-split" "PASS" "Traffic split = 80/20"
else
  record "canary20-traffic-split" "FAIL" "Expected 80/20, got '$SPLIT'"
fi

# Argo CD should now show "Synced" status
if [ "$SYNCED" = "true" ]; then
  record "canary20-argo-synced" "PASS" "Argo CD shows Synced state"
else
  record "canary20-argo-synced" "FAIL" "Argo CD sync state not visible (state=$STATE, synced=$SYNCED)"
fi

# ---------- Test 4: Canary 50% ----------------------------------------------
echo
echo "${YELLOW}--- Test 4: Canary 50% state ---${RESET}"
agent-browser wait 4000 >/dev/null 2>&1

STATE=$(get_state_badge)
if [ "$STATE" = "canary50" ]; then
  record "transitions-to-canary50" "PASS" "After ~4s, state = CANARY 50%"
else
  record "transitions-to-canary50" "FAIL" "Expected canary50, got '$STATE'"
fi

SPLIT=$(get_traffic_split)
if [ "$SPLIT" = "50/50" ]; then
  record "canary50-traffic-split" "PASS" "Traffic split = 50/50"
else
  record "canary50-traffic-split" "FAIL" "Expected 50/50, got '$SPLIT'"
fi

# ---------- Test 5: Anomaly --------------------------------------------------
echo
echo "${YELLOW}--- Test 5: Anomaly state ---${RESET}"
agent-browser wait 3000 >/dev/null 2>&1

STATE=$(get_state_badge)
if [ "$STATE" = "anomaly" ]; then
  record "transitions-to-anomaly" "PASS" "After ~3s, state = ANOMALY DETECTED"
else
  record "transitions-to-anomaly" "FAIL" "Expected anomaly, got '$STATE'"
fi

SLO=$(get_slo_status)
if [ "$SLO" = "SLO VIOLATED" ]; then
  record "anomaly-slo-violated" "PASS" "Prometheus shows SLO VIOLATED"
else
  record "anomaly-slo-violated" "FAIL" "Expected SLO VIOLATED, got '$SLO'"
fi

# Traffic split should still be 50/50 (paused)
SPLIT=$(get_traffic_split)
if [ "$SPLIT" = "50/50" ]; then
  record "anomaly-traffic-paused" "PASS" "Traffic remains 50/50 (paused)"
else
  record "anomaly-traffic-paused" "FAIL" "Expected 50/50, got '$SPLIT'"
fi

# ---------- Test 6: AI Analyzing --------------------------------------------
echo
echo "${YELLOW}--- Test 6: AI Analyzing state ---${RESET}"
agent-browser wait 2000 >/dev/null 2>&1

STATE=$(get_state_badge)
if [ "$STATE" = "analyzing" ]; then
  record "transitions-to-analyzing" "PASS" "After ~2s, state = AI ANALYZING"
else
  record "transitions-to-analyzing" "FAIL" "Expected analyzing, got '$STATE'"
fi

# Terminal should start streaming — wait a bit then check
agent-browser wait 3000 >/dev/null 2>&1
LINE_COUNT=$(get_terminal_line_count)
if [ "$LINE_COUNT" -ge "3" ] 2>/dev/null; then
  record "k8sgpt-streaming" "PASS" "K8sGPT terminal streaming ($LINE_COUNT lines so far)"
else
  record "k8sgpt-streaming" "FAIL" "Expected ≥3 lines, got '$LINE_COUNT'"
fi

# Verify some of the expected K8sGPT lines have appeared
ANALYZER_LINE=$(agent-browser eval "document.body.innerText.includes('K8sGPT Analyzer triggered') ? 'yes' : 'no'" 2>&1 | tail -1 | tr -d '"')
if [ "$ANALYZER_LINE" = "yes" ]; then
  record "k8sgpt-trigger-line" "PASS" "'K8sGPT Analyzer triggered by Prometheus SLO violation...' visible"
else
  record "k8sgpt-trigger-line" "FAIL" "Trigger line not yet visible"
fi

# ---------- Test 7: Rollback (final) -----------------------------------------
echo
echo "${YELLOW}--- Test 7: Rollback state ---${RESET}"
agent-browser wait 5000 >/dev/null 2>&1

STATE=$(get_state_badge)
if [ "$STATE" = "rollback" ]; then
  record "transitions-to-rollback" "PASS" "After ~5s, state = ROLLED BACK"
else
  record "transitions-to-rollback" "FAIL" "Expected rollback, got '$STATE'"
fi

# Traffic should be 100/0 again
SPLIT=$(get_traffic_split)
if [ "$SPLIT" = "100/0" ]; then
  record "rollback-traffic-restored" "PASS" "Traffic restored to 100/0"
else
  record "rollback-traffic-restored" "FAIL" "Expected 100/0, got '$SPLIT'"
fi

# SLO should be healthy again
SLO=$(get_slo_status)
if [ "$SLO" = "SLO HEALTHY" ]; then
  record "rollback-slo-restored" "PASS" "SLO HEALTHY again after rollback"
else
  record "rollback-slo-restored" "FAIL" "Expected SLO HEALTHY, got '$SLO'"
fi

# All 9 K8sGPT stream lines should be present (DOM inspection)
LINE_COUNT=$(get_terminal_line_count)
if [ "$LINE_COUNT" = "9" ] 2>/dev/null; then
  record "k8sgpt-all-9-lines" "PASS" "All 9 K8sGPT stream lines rendered"
else
  record "k8sgpt-all-9-lines" "FAIL" "Expected 9 lines, got '$LINE_COUNT'"
fi

# Verify the final rollback execution line is present
EXEC_LINE=$(agent-browser eval "document.body.innerText.includes('Executing automated rollback') ? 'yes' : 'no'" 2>&1 | tail -1 | tr -d '"')
if [ "$EXEC_LINE" = "yes" ]; then
  record "k8sgpt-final-line" "PASS" "'Executing automated rollback via Argo Rollouts...' visible"
else
  record "k8sgpt-final-line" "FAIL" "Final rollback line not present"
fi

# Reset Demo button should now be visible
RESET_BTN=$(agent-browser snapshot -i 2>&1 | grep -i "Reset Demo" | head -1)
if [ -n "$RESET_BTN" ]; then
  record "reset-button-visible" "PASS" "Reset Demo button appears in header"
else
  record "reset-button-visible" "FAIL" "Reset Demo button not found"
fi

# ---------- Test 8: Reset Demo (edge case) ----------------------------------
echo
echo "${YELLOW}--- Test 8: Reset Demo (edge case) ---${RESET}"

RESET_REF=$(agent-browser snapshot -i 2>&1 | grep "Reset Demo" | head -1 | sed -nE 's/.*\[ref=(e[0-9]+)\].*/\1/p')
if [ -z "$RESET_REF" ]; then
  record "click-reset-demo" "FAIL" "Could not find Reset Demo button ref"
else
  agent-browser click "@${RESET_REF}" >/dev/null 2>&1
  agent-browser wait 1000 >/dev/null 2>&1

  STATE=$(get_state_badge)
  if [ "$STATE" = "idle" ]; then
    record "reset-returns-to-idle" "PASS" "After Reset, state returns to IDLE"
  else
    record "reset-returns-to-idle" "FAIL" "Expected idle after reset, got '$STATE'"
  fi

  LINE_COUNT=$(get_terminal_line_count)
  if [ "$LINE_COUNT" = "0" ] 2>/dev/null; then
    record "reset-clears-terminal" "PASS" "Terminal cleared on reset (0 lines)"
  else
    record "reset-clears-terminal" "FAIL" "Expected 0 lines after reset, got '$LINE_COUNT'"
  fi

  # Start Rollout should be visible again
  START_BTN=$(agent-browser snapshot -i 2>&1 | grep "Start Rollout" | head -1)
  if [ -n "$START_BTN" ]; then
    record "reset-restores-start-button" "PASS" "Start Rollout button restored after reset"
  else
    record "reset-restores-start-button" "FAIL" "Start Rollout button not visible after reset"
  fi
fi

# ---------- Test 9: Mobile responsive ---------------------------------------
echo
echo "${YELLOW}--- Test 9: Mobile responsive ---${RESET}"
agent-browser set viewport 375 812 >/dev/null 2>&1
agent-browser wait 500 >/dev/null 2>&1

# No horizontal overflow
OVERFLOW=$(agent-browser eval "document.documentElement.scrollWidth > document.documentElement.clientWidth ? 'overflow' : 'fit'" 2>&1 | tail -1 | tr -d '"')
if [ "$OVERFLOW" = "fit" ]; then
  record "mobile-no-overflow" "PASS" "375px viewport: no horizontal overflow"
else
  record "mobile-no-overflow" "FAIL" "Horizontal overflow on 375px viewport"
fi

# Reset to desktop for recording
agent-browser set viewport 1440 900 >/dev/null 2>&1

# ---------- Write JSON report ------------------------------------------------
echo
echo "${YELLOW}=== Writing JSON report ===${RESET}"

jq -n --argjson results "$(printf '%s\n' "${RESULTS[@]}" | jq -s '.')" \
  '{total: ($results | length), passed: ($results | map(select(.status=="PASS")) | length), failed: ($results | map(select(.status=="FAIL")) | length), results: $results}' \
  > "$REPORT"

echo "Report saved: $REPORT"
echo
echo "${GREEN}=== UAT SUMMARY ===${RESET}"
echo "Total tests: $((PASS + FAIL))"
echo "${GREEN}Passed: $PASS${RESET}"
[ "$FAIL" -gt 0 ] && echo "${RED}Failed: $FAIL${RESET}" || echo "${GREEN}Failed: 0${RESET}"

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
