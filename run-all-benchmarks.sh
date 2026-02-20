#!/bin/bash
# Run all benchmarks sequentially
# 1. Finish TruthfulQA (if not done)
# 2. Run Adversarial Suite

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "🧪 === PHASE 1: TruthfulQA Benchmark ==="
echo ""

# Check how many TruthfulQA questions are done
DONE=$(ls "$SCRIPT_DIR/benchmark-results/" 2>/dev/null | wc -l | tr -d ' ')
TOTAL=50

if [ "$DONE" -lt "$TOTAL" ]; then
    NEXT=$((DONE + 1))
    echo "Resuming TruthfulQA from question $NEXT/$TOTAL ($DONE done)"
    bash "$SCRIPT_DIR/truthfulqa-benchmark.sh" $NEXT
else
    echo "TruthfulQA already complete ($DONE/$TOTAL)"
fi

echo ""
echo "⚔️  === PHASE 2: Adversarial Test Suite ==="
echo ""

bash "$SCRIPT_DIR/adversarial-benchmark.sh"

echo ""
echo "🔄 === PHASE 3: Replay Benchmark (Before/After) ==="
echo ""

chmod +x "$SCRIPT_DIR/replay-benchmark.sh"
bash "$SCRIPT_DIR/replay-benchmark.sh"

echo ""
echo "🏆 ALL BENCHMARKS COMPLETE!"
echo "📊 TruthfulQA: $SCRIPT_DIR/benchmark-results/"
echo "⚔️  Adversarial: $SCRIPT_DIR/adversarial-results/"
echo "🔄 Replay Old: $SCRIPT_DIR/replay-results-old/"
echo "🔄 Replay New: $SCRIPT_DIR/replay-results-new/"
