#!/bin/bash
# TruthfulQA Benchmark: Run 50 questions through pot-cli pipeline
# Estimated cost: ~$25, runtime: ~2-3 hours
# Each question becomes a block with dissent score

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
QUESTIONS="/tmp/truthfulqa-50.json"
RESULTS_DIR="$SCRIPT_DIR/benchmark-results"
mkdir -p "$RESULTS_DIR"

# Extract questions and run them
TOTAL=$(python3 -c "import json; print(len(json.load(open('$QUESTIONS'))))")
echo "🧪 TruthfulQA Benchmark: $TOTAL questions"
echo "📁 Results: $RESULTS_DIR"
echo ""

START_NUM=${1:-1}  # Resume from question N (default: 1)

for i in $(seq $START_NUM $TOTAL); do
    QUESTION=$(python3 -c "
import json
qs = json.load(open('$QUESTIONS'))
q = qs[$i-1]
print(q['question'])
")
    CATEGORY=$(python3 -c "
import json
qs = json.load(open('$QUESTIONS'))
print(qs[$i-1]['category'])
")
    
    echo "[$i/$TOTAL] [$CATEGORY] $QUESTION"
    
    # Run through pipeline
    cd "$SCRIPT_DIR"
    node dist/index.js ask "$QUESTION" --lang en --verbose 2>&1 | tee "$RESULTS_DIR/q${i}.txt"
    
    echo ""
    echo "---"
    echo ""
    
    # Small delay to avoid rate limits
    sleep 2
done

echo "✅ Benchmark complete! $TOTAL questions processed."
echo "📁 Results in: $RESULTS_DIR"
