const fs = require('fs');
const https = require('https');

const config = JSON.parse(fs.readFileSync('.potrc.json', 'utf8'));
const generators = config.generators;

function postJson(options, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request(options, (res) => {
      let buf = '';
      res.on('data', (chunk) => { buf += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(buf);
          resolve(parsed);
        } catch (e) {
          reject(new Error(`Parse error: ${buf.substring(0,200)}`));
        }
      });
    });
    req.on('error', reject);
    if (options.headers) {
      Object.entries(options.headers).forEach(([k, v]) => req.setHeader(k, v));
    }
    req.setHeader('Content-Length', Buffer.byteLength(data, 'utf8'));
    req.write(data);
    req.end();
  });
}

async function callGenerator(gen, question) {
  const messages = [{ role: 'user', content: `Answer this question concisely and accurately in a single paragraph or code block if applicable:\n\n${question}` }];
  const body = {
    model: gen.model,
    messages,
    max_tokens: 1000,
    temperature: 0.0,
  };
  const headersBase = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${gen.apiKey}`,
  };
  let apiUrl;
  if (gen.provider === 'anthropic') {
    apiUrl = 'https://api.anthropic.com/v1/messages';
    headersBase['anthropic-version'] = '2023-06-01';
  } else {
    apiUrl = new URL('/chat/completions', gen.baseUrl).toString();
  }
  const parsedUrl = new URL(apiUrl);
  const hostname = parsedUrl.hostname;
  const port = parsedUrl.port || 443;
  const path = parsedUrl.pathname + parsedUrl.search;
  const headers = headersBase;
  const options = {
    hostname,
    port,
    path,
    method: 'POST',
    headers,
  };
  try {
    const data = await postJson(options, body);
    let content;
    if (gen.provider === 'anthropic') {
      content = data.content && data.content[0] ? data.content[0].text : (data.error ? data.error.message : 'Unknown error');
    } else {
      content = data.choices && data.choices[0] && data.choices[0].message ? data.choices[0].message.content : (data.error ? data.error.message : 'Unknown error');
    }
    return content ? content.trim() : 'No content';
  } catch (e) {
    return `Error from ${gen.name}: ${e.message}`;
  }
}

function findMajorityAnswer(answers, gens) {
  const count = {};
  for (let i = 0; i < answers.length; i++) {
    const ans = answers[i];
    if (ans.includes('Error') || ans.includes('Invalid') || ans.includes('No content') || ans.includes('resource was not found')) continue;
    const norm = ans.toLowerCase().replace(/[^\\w\\s]/g, '').replace(/\\s+/g, ' ').trim().substring(0, 300);
    if (!count[norm]) count[norm] = [];
    count[norm].push({ans, gen: gens[i].name});
  }
  if (Object.keys(count).length === 0) {
    return 'All generators failed';
  }
  const groupSizes = Object.values(count).map(g => g.length);
  const maxSize = Math.max(...groupSizes);
  const topGroups = Object.values(count).filter(g => g.length === maxSize);
  if (topGroups.length === 1) {
    return topGroups[0][0].ans;
  } else {
    return `Tie (${maxSize}/${gens.length}): ${topGroups.map(g => `${g[0].gen} (${g[0].ans.substring(0,50)}...)`).join('; ')}`;
  }
}

async function main() {
  const question = process.argv.slice(2).join(' ');
  if (!question) {
    console.log('Usage: node majority-vote.js "your question here"');
    process.exit(1);
  }
  console.log(`\n=== Question: ${question} ===\n`);
  const answers = await Promise.all(generators.map(g => callGenerator(g, question)));
  answers.forEach((a, i) => {
    console.log(`${generators[i].name}:\n${a}\n---`);
  });
  const majority = findMajorityAnswer(answers, generators);
  console.log('\n=== Majority Vote Result ===\n' + majority);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
