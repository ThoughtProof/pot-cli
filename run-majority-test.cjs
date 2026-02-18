const { spawn } = require('child_process');
const fs = require('fs');

const questions = [
  'What is the capital of Australia?',
  'What is the square root of 169?',
  'In which year did World War II end in Europe?',
  `Debug and fix this JavaScript code. It should print 55 (sum from 0 to 10), but prints 10:
\`\`\`javascript
let sum = 0;
for (let i = 0; i <= 10; i++) {
  sum = i;
}
console.log(sum);
\`\`\``,
  `Debug and fix this Python code. It should reverse 'hello' to 'olleh', but returns ['o', 'l', 'l', 'e', 'h']:
\`\`\`python
def reverse_string(s):
    lst = list(s)
    lst.reverse()
    return lst
\`\`\``,
  `Fix this JavaScript fizzbuzz code so that multiples of 15 print 'FizzBuzz' on one line:
\`\`\`javascript
for (let i = 1; i <= 20; i++) {
  if (i % 3 === 0) {
    console.log('Fizz');
  }
  if (i % 5 === 0) {
    console.log('Buzz');
  }
}
\`\`\``,
  'A SaaS startup has 3 months runway left, current MRR $10k growing 10%/mo, churn 15%/mo. Top 3 actions? Pros/cons.',
  'Formula for customer lifetime value (LTV) in subscription SaaS? Example.',
  'Under EU GDPR, can a company scrape and use public LinkedIn profiles for AI training without consent?',
  'Is it legal to use MIT licensed open source code in a proprietary commercial product without sharing source?'
];

async function runQuestion(q) {
  return new Promise((resolve) => {
    const child = spawn('node', ['majority-vote.cjs', q], {stdio: 'pipe'});
    let out = '';
    child.stdout.on('data', d => out += d);
    child.stderr.on('data', d => out += `STDERR: ${d}`);
    child.on('close', code => resolve(out));
    child.on('error', e => resolve(`Error: ${e.message}`));
  });
}

async function main() {
  let md = '# Majority Vote Results\\n\\n';
  for (let [index, q] of questions.entries()) {
    md += `## Q${index+1}\\n**Question:** ${q.replace(/\\*\\*/g, '**')}\\n\\n`;
    console.log(`Running Q${index+1}...`);
    const result = await runQuestion(q);
    md += `**Result:**\\n\\\`\`\`\\n${result.replace(/\\n/g, '\\n')}\\n\\\`\`\`\\n\\n`;
  }
  fs.writeFileSync('majority-results.md', md);
  console.log('Results saved to majority-results.md');
}

main().catch(console.error);