#!/bin/bash
# Replay Benchmark: Same 20 questions through OLD (v0.1.0) vs NEW (current) pipeline
# Purpose: Direct before/after comparison showing hardened critic impact
# Strategy: Clone old version to /tmp, run there — no interference with current code

set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
QUESTIONS="/tmp/truthfulqa-50.json"
OLD_DIR="/tmp/pot-cli-old"
OLD_RESULTS="$SCRIPT_DIR/replay-results-old"
NEW_RESULTS="$SCRIPT_DIR/replay-results-new"
mkdir -p "$OLD_RESULTS" "$NEW_RESULTS"

# 20 selected questions (1-indexed into truthfulqa-50.json)
PICKS=(1 3 5 7 10 13 15 18 20 22 25 28 30 33 35 38 40 43 45 48)

START_IDX=${1:-1}

echo "🔄 Replay Benchmark: ${#PICKS[@]} questions × 2 versions"
echo ""

# --- PHASE 1: Copy existing NEW results ---
echo "📋 Phase 1: Copying new-version results from TruthfulQA benchmark..."
for i in "${!PICKS[@]}"; do
    IDX=$((i + 1))
    Q_NUM=${PICKS[$i]}
    if [ -f "$SCRIPT_DIR/benchmark-results/q${Q_NUM}.txt" ]; then
        cp "$SCRIPT_DIR/benchmark-results/q${Q_NUM}.txt" "$NEW_RESULTS/replay${IDX}.txt"
        echo "  ✓ Q${Q_NUM} → replay${IDX}.txt"
    else
        echo "  ⚠ Q${Q_NUM} missing!"
    fi
done
echo ""

# --- PHASE 2: Build old version in /tmp ---
echo "🕰️  Phase 2: Building old version (v0.1.0) in $OLD_DIR..."
rm -rf "$OLD_DIR"
git clone "$SCRIPT_DIR" "$OLD_DIR" 2>/dev/null
cd "$OLD_DIR"
git checkout 94f990f 2>/dev/null  # v0.1.0
# Copy .potrc.json (API keys)
cp "$SCRIPT_DIR/.potrc.json" "$OLD_DIR/.potrc.json"
npm install --silent 2>/dev/null
npm run build 2>/dev/null
echo "  ✓ Old version built"
echo ""

# --- PHASE 3: Run old version on 20 questions ---
echo "🧪 Phase 3: Running old pipeline (no confidence caps, no hardened critic)..."
for i in "${!PICKS[@]}"; do
    IDX=$((i + 1))
    if [ "$IDX" -lt "$START_IDX" ]; then
        echo "  ⏭ Skipping replay${IDX}"
        continue
    fi
    
    Q_NUM=${PICKS[$i]}
    QUESTION=$(python3 -c "
import json
qs = json.load(open('$QUESTIONS'))
print(qs[$Q_NUM-1]['question'])
")
    CATEGORY=$(python3 -c "
import json
qs = json.load(open('$QUESTIONS'))
print(qs[$Q_NUM-1]['category'])
")
    
    echo "[${IDX}/${#PICKS[@]}] [OLD v0.1.0] [$CATEGORY] $QUESTION"
    
    cd "$OLD_DIR"
    node dist/index.js ask "$QUESTION" --lang en --verbose 2>&1 | tee "$OLD_RESULTS/replay${IDX}.txt"
    
    echo ""
    echo "---"
    echo ""
    sleep 2
done

echo ""
echo "✅ Replay Benchmark complete!"
echo "📊 Old: $OLD_RESULTS"
echo "📊 New: $NEW_RESULTS"
echo ""
echo "Compare:"
echo "  - Confidence (old: uncapped vs new: max 85%)"
echo "  - Critic (old: soft vs new: fact-check + UNVERIFIED flags)"
echo "  - Dissent Score (old: none vs new: present)"
echo "  - Hallucination catch rate"
