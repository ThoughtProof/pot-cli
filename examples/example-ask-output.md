# Example: pot-cli ask

```bash
$ pot-cli ask "Should a startup use microservices or monolith in 2026?"

🧠 ThoughtProof Pipeline
   Question: Should a startup use microservices or monolith in 2026?

⠋ Running 4 generators...
  ✓ GPT-4o: "Monolith-first, but modular" (3.1s)
  ✓ Claude Sonnet: "Monolith with clear boundaries" (3.8s)
  ✓ Grok: "Depends on team size — monolith <10 engineers" (2.9s)
  ✓ DeepSeek: "Modular monolith with service-ready interfaces" (3.4s)
⠋ Running adversarial critic...
  ✓ Critic completed (5.1s)
⠋ Synthesizing...
  ✓ Synthesizer completed (4.3s)

✅ Block PoT-065 created in 22.6s

🧠 SYNTHESIS:

## Consensus: Start with a modular monolith (4/4 models agree)

All four models independently converge on the same answer: start monolith,
design for future extraction. This is unusually high agreement (MDI-adjusted
confidence: 89%).

## Key Arguments
1. **Monolith wins at startup scale** — deployment simplicity, single DB,
   no distributed systems headaches. All models cite this.
2. **"Modular" is the key word** — not a big ball of mud, but clear module
   boundaries (Claude: "pretend each module is a service")
3. **Extraction trigger:** GPT-4o and Grok agree: consider splitting when
   team hits 15-20 engineers OR a specific module needs independent scaling

## Where They Disagreed
- **Timeline for extraction:** GPT-4o says 18-24 months, Grok says "never
  unless forced by scale" — meaningful disagreement about proactive vs reactive
- **Critic flagged:** All models ignored the cost dimension. Running
  microservices on Kubernetes costs 3-5x more in infrastructure for a startup.
  This strengthens the monolith case further.

## What the Critic Added
The critic caught that no model discussed **hiring implications** — finding
distributed systems engineers is harder and more expensive. This is a hidden
cost of premature microservices that strengthens the consensus.

## Confidence: 89%
Unusually high agreement. The "modular monolith" consensus is well-supported.

💾 Saved as PoT-065
📈 Model Diversity Index: 0.750
💰 Estimated cost: $0.47
```
