// Majority Vote Test — calls 4 generators, returns all responses (no critic/synthesis)
import { readFileSync } from 'fs';

const config = JSON.parse(readFileSync('.potrc.json', 'utf8'));

async function callGenerator(gen, question) {
  const isAnthropic = gen.provider === 'anthropic';
  const url = isAnthropic 
    ? 'https://api.anthropic.com/v1/messages'
    : gen.baseUrl;
  
  const headers = isAnthropic
    ? { 'x-api-key': gen.apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }
    : { 'Authorization': `Bearer ${gen.apiKey}`, 'Content-Type': 'application/json' };
  
  const body = isAnthropic
    ? JSON.stringify({ model: gen.model, max_tokens: 1024, messages: [{ role: 'user', content: question }] })
    : JSON.stringify({ model: gen.model, messages: [{ role: 'user', content: question }], max_tokens: 1024 });

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000);
    const res = await fetch(url, { method: 'POST', headers, body, signal: controller.signal });
    clearTimeout(timeout);
    const data = await res.json();
    
    if (isAnthropic) {
      return { model: gen.name, content: data.content?.[0]?.text || 'ERROR', ok: true };
    }
    return { model: gen.name, content: data.choices?.[0]?.message?.content || 'ERROR', ok: true };
  } catch (e) {
    return { model: gen.name, content: `FAILED: ${e.message}`, ok: false };
  }
}

async function majorityVote(question) {
  const results = await Promise.all(config.generators.map(g => callGenerator(g, question)));
  return results;
}

const questions = [
  // Factual (3)
  "What is the capital of Myanmar and when did it change?",
  "How many bones does an adult human have? Are there common misconceptions about this?",
  "What caused the Chernobyl disaster? List the sequence of events.",
  // Code debugging (3)  
  "Find the bug: function fibonacci(n) { if (n <= 1) return n; return fibonacci(n-1) + fibonacci(n-2); } — This works but is extremely slow for n>35. Why, and what are the fixes?",
  "Find the bug in this Python: def merge_sorted(a, b): result = []; i = j = 0; while i < len(a) and j < len(b): if a[i] <= b[j]: result.append(a[i]); i += 1; else: result.append(b[j]); j += 1; return result",
  "Is this SQL injection safe? query = `SELECT * FROM users WHERE id = ${parseInt(req.params.id)}`",
  // Strategic (2)
  "Should a solo founder bootstrap or raise VC for a developer tools startup in 2026?",
  "What are the risks of storing all company data in a single cloud provider?",
  // Compliance (2)
  "What are the key requirements of the EU AI Act for high-risk AI systems?",
  "Can a company use customer emails for AI training without explicit consent under GDPR?"
];

async function runTest() {
  console.log('# Majority Vote Test Results\n');
  console.log(`Date: ${new Date().toISOString()}\n`);
  
  for (let i = 0; i < questions.length; i++) {
    console.log(`## Q${i+1}: ${questions[i]}\n`);
    const results = await majorityVote(questions[i]);
    
    for (const r of results) {
      console.log(`### ${r.model} ${r.ok ? '✅' : '❌'}`);
      console.log(r.content.slice(0, 500));
      console.log('');
    }
    console.log('---\n');
  }
}

runTest().catch(console.error);
