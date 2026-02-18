# Example: pot-cli debug

```bash
$ pot-cli debug src/auth.ts --error "TypeError: Cannot read property 'token' of undefined"

🐛 ThoughtProof Debug: auth.ts
   Language: typescript | 87 lines

⠋ Running 4 debuggers + static analysis...
  ✓ GPT-4o completed (3.2s)
  ✓ Claude Sonnet completed (4.1s)
  ✓ Grok completed (2.8s)
  ✓ DeepSeek completed (3.5s)
  ✓ Static Analysis: 2 issues found (eslint, tsc)
⠋ Running adversarial critic...
  ✓ Critic completed (5.2s)
⠋ Synthesizing...
  ✓ Synthesizer completed (4.8s)

✅ Debug block PoT-063 created in 23.6s

🐛 DEBUG SYNTHESIS:

## Root Cause
The `token` variable in `authenticateUser()` (line 34) is accessed before the
async `fetchToken()` resolves. All 4 models agree this is a race condition.

## The Fix
```typescript
// Before (line 34):
const token = fetchToken(userId);
if (token.expires < Date.now()) { ... }

// After:
const token = await fetchToken(userId);
if (token?.expires && token.expires < Date.now()) { ... }
```

## Where Models Disagreed
- **GPT-4o** suggested wrapping in try/catch — valid but doesn't fix root cause
- **Grok** identified a second bug on line 52 (unchecked null return from DB query)
  that other models missed — **confirmed by critic as genuine bug**
- **Static analysis** flagged missing return type annotation (minor, not the bug)

## Confidence: 92%
All models converge on the async/await fix. Grok's secondary finding adds value.

💾 Saved as PoT-063
📈 Model Diversity Index: 0.750
💰 Estimated cost: $0.12
```

This is a representative example of pot-cli debug output. The pipeline:
1. Sends your code to 4 different LLMs + static analysis in parallel
2. An adversarial critic checks all proposals for errors and blind spots
3. A synthesizer produces the final recommendation with disagreement analysis
