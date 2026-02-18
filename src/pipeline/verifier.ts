import { Provider, Proposal } from '../types.js';

export interface VerificationResult {
  claim: string;
  searchResult: string;
  status: 'confirmed' | 'contradicted' | 'inconclusive';
}

export interface VerificationReport {
  results: VerificationResult[];
  summary: string;
}

const EXTRACT_CLAIMS_PROMPT_EN = `Extract the 5-10 most important FACTUAL claims from these proposals. Focus on:
- Specific numbers, percentages, statistics
- Historical dates and events
- Named studies, papers, or reports
- Cause-and-effect claims
- Legal or regulatory assertions

Return ONLY a JSON array of strings, each one a concise factual claim.
Example: ["The Earth orbits the Sun in 365.25 days", "GDP of Germany was $4.2T in 2023"]

PROPOSALS:
{proposals}`;

const EXTRACT_CLAIMS_PROMPT_DE = `Extrahiere die 5-10 wichtigsten FAKTISCHEN Behauptungen aus diesen Proposals. Fokus auf:
- Spezifische Zahlen, Prozente, Statistiken
- Historische Daten und Ereignisse
- Benannte Studien, Papers oder Berichte
- Ursache-Wirkungs-Behauptungen
- Rechtliche oder regulatorische Aussagen

Gib NUR ein JSON-Array von Strings zurück.
Beispiel: ["Die Erde umkreist die Sonne in 365,25 Tagen", "BIP Deutschlands 2023 war $4.2T"]

PROPOSALS:
{proposals}`;

export async function extractAndVerifyClaims(
  extractorProvider: Provider,
  extractorModel: string,
  searchProvider: Provider,
  searchModel: string,
  proposals: Proposal[],
  language: 'de' | 'en' = 'en',
  maxClaims: number = 7
): Promise<VerificationReport> {
  const proposalsText = proposals
    .map((p, i) => `=== PROPOSAL ${i + 1} (${p.model}) ===\n${p.content}`)
    .join('\n\n');

  const template = language === 'de' ? EXTRACT_CLAIMS_PROMPT_DE : EXTRACT_CLAIMS_PROMPT_EN;
  const prompt = template.replace('{proposals}', proposalsText);

  // Step 1: Extract claims using a fast model
  const extractionResponse = await extractorProvider.call(extractorModel, prompt);
  
  let claims: string[];
  try {
    // Try to parse JSON from the response (may have markdown wrapping)
    const jsonMatch = extractionResponse.content.match(/\[[\s\S]*?\]/);
    claims = jsonMatch ? JSON.parse(jsonMatch[0]) : [];
  } catch {
    // Fallback: split by newlines and clean up
    claims = extractionResponse.content
      .split('\n')
      .map(l => l.replace(/^[-*"\d.)\s]+/, '').trim())
      .filter(l => l.length > 10)
      .slice(0, maxClaims);
  }

  claims = claims.slice(0, maxClaims);

  if (claims.length === 0) {
    return {
      results: [],
      summary: 'No verifiable factual claims extracted from proposals.',
    };
  }

  // Step 2: Verify each claim via web search (using Perplexity or similar)
  const results: VerificationResult[] = [];

  for (const claim of claims) {
    try {
      const searchPrompt = `Fact-check this claim. Is it true, false, or uncertain? Provide a brief answer with sources if possible.\n\nClaim: "${claim}"`;
      const searchResponse = await searchProvider.call(searchModel, searchPrompt);
      
      const content = searchResponse.content.toLowerCase();
      let status: 'confirmed' | 'contradicted' | 'inconclusive' = 'inconclusive';
      
      if (content.includes('true') || content.includes('correct') || content.includes('accurate') || content.includes('confirmed')) {
        status = 'confirmed';
      }
      if (content.includes('false') || content.includes('incorrect') || content.includes('inaccurate') || content.includes('wrong') || content.includes('not true') || content.includes('fabricated')) {
        status = 'contradicted';
      }

      results.push({
        claim,
        searchResult: searchResponse.content.slice(0, 500),
        status,
      });
    } catch {
      results.push({
        claim,
        searchResult: 'Search failed — unable to verify',
        status: 'inconclusive',
      });
    }
  }

  // Step 3: Build summary
  const confirmed = results.filter(r => r.status === 'confirmed').length;
  const contradicted = results.filter(r => r.status === 'contradicted').length;
  const inconclusive = results.filter(r => r.status === 'inconclusive').length;

  const summary = results
    .map(r => {
      const icon = r.status === 'confirmed' ? '✅' : r.status === 'contradicted' ? '❌' : '❓';
      return `${icon} ${r.status.toUpperCase()}: "${r.claim}"\n   → ${r.searchResult.slice(0, 200)}`;
    })
    .join('\n\n');

  const header = `WEB VERIFICATION REPORT: ${confirmed} confirmed, ${contradicted} contradicted, ${inconclusive} inconclusive out of ${results.length} claims checked.\n\n`;

  return {
    results,
    summary: header + summary,
  };
}
