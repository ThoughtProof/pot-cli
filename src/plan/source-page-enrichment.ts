import type { FirstPartyGaiaTrace } from './first-party-adapter.js';

export interface SourcePageMetadata {
  title?: string;
  h1?: string;
  acronymExpansion?: string;
}

export interface SourcePageEnrichmentOptions {
  includeTitle?: boolean;
  includeH1?: boolean;
}

export type SourcePageFetcher = (url: string) => Promise<string>;

function cleanHtmlText(text: string): string {
  return text
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#8211;/gi, '–')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractAcronymFromQuestion(question: string): string | null {
  const match = question.match(/what does\s+([A-Z][A-Z0-9-]{1,15})\s+stand for\??/i);
  return match?.[1]?.toUpperCase() ?? null;
}

function extractAcronymExpansionFromHtml(html: string, acronym: string): string | undefined {
  const text = cleanHtmlText(html);
  const escaped = acronym.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`([A-Z][A-Za-z0-9-]+(?: [A-Z][A-Za-z0-9-]+){1,8}) \\(${escaped}\\)`, 'g');
  const match = regex.exec(text);
  if (!match?.[1]) return undefined;
  const cleaned = match[1]
    .replace(new RegExp(`^${escaped}\\s+`, 'i'), '')
    .replace(/^(?:Official|The)\s+/i, '')
    .trim();
  return cleaned.length > 0 ? `${cleaned} (${acronym})` : undefined;
}

export function extractSourcePageMetadata(html: string, question?: string): SourcePageMetadata {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);

  const title = titleMatch ? cleanHtmlText(titleMatch[1] ?? '') : undefined;
  const h1 = h1Match ? cleanHtmlText(h1Match[1] ?? '') : undefined;
  const acronym = question ? extractAcronymFromQuestion(question) : null;
  const acronymExpansion = acronym ? extractAcronymExpansionFromHtml(html, acronym) : undefined;

  return {
    title: title && title.length > 0 ? title : undefined,
    h1: h1 && h1.length > 0 ? h1 : undefined,
    acronymExpansion,
  };
}

export async function fetchSourcePageHtml(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      'user-agent': 'Mozilla/5.0 (pot-cli source enrichment)',
    },
  });

  if (!response.ok) {
    throw new Error(`fetch failed for ${url}: ${response.status} ${response.statusText}`);
  }

  return await response.text();
}

function getSourceUrl(trace: FirstPartyGaiaTrace): string | null {
  const meta = trace.annotator_metadata;
  if (!meta || typeof meta !== 'object') return null;
  const value = meta['source_url'];
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function cloneTrace(trace: FirstPartyGaiaTrace): FirstPartyGaiaTrace {
  return JSON.parse(JSON.stringify(trace)) as FirstPartyGaiaTrace;
}

export async function enrichFirstPartyTracesWithSourcePageMetadata(
  traces: FirstPartyGaiaTrace[],
  fetcher: SourcePageFetcher = fetchSourcePageHtml,
  options: SourcePageEnrichmentOptions = {},
): Promise<FirstPartyGaiaTrace[]> {
  const includeTitle = options.includeTitle ?? true;
  const includeH1 = options.includeH1 ?? true;

  const enriched: FirstPartyGaiaTrace[] = [];
  const cache = new Map<string, string>();

  for (const trace of traces) {
    const cloned = cloneTrace(trace);
    const sourceUrl = getSourceUrl(cloned);
    const browseStep = cloned.trace.steps.find((step) => step.kind === 'browse');

    if (!sourceUrl || !browseStep) {
      enriched.push(cloned);
      continue;
    }

    let html = cache.get(sourceUrl);
    if (!html) {
      try {
        html = await fetcher(sourceUrl);
      } catch {
        html = '';
      }
      cache.set(sourceUrl, html);
    }

    const metadata = html ? extractSourcePageMetadata(html, cloned.question) : {};

    const additions: string[] = [];
    if (includeTitle && metadata.title) additions.push(metadata.title);
    if (includeH1 && metadata.h1) additions.push(metadata.h1);
    if (metadata.acronymExpansion) additions.push(metadata.acronymExpansion);

    if (additions.length > 0) {
      const evidence = browseStep.evidence ?? [];
      for (const item of additions) {
        if (!evidence.includes(item)) {
          evidence.push(item);
        }
      }
      browseStep.evidence = evidence;
    }

    enriched.push(cloned);
  }

  return enriched;
}
