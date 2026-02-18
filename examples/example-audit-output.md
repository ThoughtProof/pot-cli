# Example: pot-cli audit

```bash
$ pot-cli audit ./security-docs/ --framework soc2

📋 ThoughtProof Audit: security-docs/ (6 files)
   Framework: SOC 2

⠋ Running 4 auditors against SOC 2...
  ✓ GPT-4o completed (8.1s)
  ✓ Claude Sonnet completed (9.3s)
  ✓ Grok completed (7.2s)
  ✓ DeepSeek completed (8.8s)
⠋ Running compliance critic...
  ✓ Critic completed (6.4s)
⠋ Synthesizing audit report...
  ✓ Synthesizer completed (7.1s)

✅ Audit block PoT-064 created in 46.9s

📋 AUDIT REPORT — SOC 2:

## Overall Compliance Score: 61/100

## Covered Requirements (What You Have)
- ✅ Access control policies (CC6.1) — documented in access-policy.md
- ✅ Incident response plan (CC7.2) — covers detection and escalation
- ✅ Change management (CC8.1) — basic PR review process documented
- ✅ Data classification (CC6.5) — 3-tier model defined

## Critical Gaps (What's Missing)

| # | Gap | Severity | Framework Ref |
|---|-----|----------|---------------|
| 1 | No risk assessment methodology | 🔴 Critical | CC3.2 |
| 2 | Missing vendor management policy | 🔴 Critical | CC9.2 |
| 3 | No data retention/destruction policy | 🟡 Major | CC6.5 |
| 4 | Monitoring & alerting undocumented | 🟡 Major | CC7.1 |
| 5 | No employee security training program | 🟡 Major | CC1.4 |

## Where Models Disagreed
- **Data encryption:** GPT-4o rated it compliant, Claude and DeepSeek flagged
  missing encryption-at-rest documentation. Critic sided with Claude/DeepSeek.
- **Business continuity:** Grok found a reference to DR testing in incident-response.md
  that other models missed — upgraded from Critical to Major gap.

## Recommendations
1. Create formal risk assessment (template + annual cadence) — closes CC3.2
2. Add vendor security questionnaire process — closes CC9.2
3. Define data retention schedule per classification tier — closes CC6.5

## Risk Assessment
Without items 1-2, a SOC 2 Type II audit would likely result in qualified opinion.
Estimated effort to close all gaps: 2-3 weeks for a security team of 2.

💾 Saved as PoT-064
📈 Model Diversity Index: 0.750
💰 Estimated cost: $1.84
```
