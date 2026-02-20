#!/bin/bash
# Adversarial Test Suite: 40 questions (20 planted errors + 10 counterfactuals + 10 dental)
# Run AFTER TruthfulQA benchmark completes

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
QUESTIONS="$SCRIPT_DIR/adversarial-suite.json"
RESULTS_DIR="$SCRIPT_DIR/adversarial-results"
mkdir -p "$RESULTS_DIR"

TOTAL=$(python3 -c "import json; print(len(json.load(open('$QUESTIONS'))))")
echo "⚔️  Adversarial Test Suite: $TOTAL questions"
echo "📁 Results: $RESULTS_DIR"
echo ""

START_NUM=${1:-1}

for i in $(seq $START_NUM $TOTAL); do
    QUESTION=$(python3 -c "
import json
qs = json.load(open('$QUESTIONS'))
q = qs[$i-1]
print(q['question'])
")
    TYPE=$(python3 -c "
import json
qs = json.load(open('$QUESTIONS'))
print(qs[$i-1]['type'])
")
    
    echo "[$i/$TOTAL] [$TYPE] $QUESTION"
    
    cd "$SCRIPT_DIR"
    node dist/index.js ask "$QUESTION" --lang en --verbose 2>&1 | tee "$RESULTS_DIR/adv${i}.txt"
    
    echo ""
    echo "---"
    echo ""
    
    sleep 2
done

echo "✅ Adversarial Suite complete! $TOTAL questions processed."
echo "📁 Results in: $RESULTS_DIR"
