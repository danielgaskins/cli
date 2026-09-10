/**
 * Search command implementation
 */

import type { FormatOption } from 'firecrawl';
import type {
  SearchOptions,
  SearchResult,
  SearchResultData,
  WebSearchResult,
  ImageSearchResult,
  NewsSearchResult,
  DeveloperSearchResult,
  ExchangeSearchResult,
} from '../types/search';
import { getClient, isKeylessMode, keylessRequest } from '../utils/client';
import { writeOutput } from '../utils/output';
import { assertExchangeKeyed, exchangeErrorMessage } from './exchange';
import {
  normalizeSources,
  hasAlexandria,
  formatAlexandria,
} from '../utils/alexandria';

/**
 * Execute search command
 */
export async function executeSearch(
  options: SearchOptions
): Promise<SearchResult> {
  try {
    // Build search options for the SDK
    const searchParams: Record<string, any> = {
      limit: options.limit,
      integration: 'cli',
    };

    if (options.highlights !== undefined) {
      searchParams.highlights = options.highlights;
    }

    // Add sources if specified
    if (options.sources && options.sources.length > 0) {
      // The exchange source is gated per team; the keyless tier has no team,
      // so refuse here rather than surface an opaque 403.
      if (hasAlexandria(options.sources)) {
        assertExchangeKeyed(options.apiKey, options.apiUrl);
      }
      searchParams.sources = normalizeSources(options.sources).map((source) =>
        typeof source === 'string' ? { type: source } : source
      );
    }
    if (options.skills) {
      assertExchangeKeyed(options.apiKey, options.apiUrl);
      searchParams.skills = true;
    }
    if (
      !options.query.trim() &&
      (!hasAlexandria(options.sources) ||
        (options.sources ?? []).some((source) =>
          ['web', 'news', 'images'].includes(
            typeof source === 'string' ? source : source.type
          )
        ))
    )
      throw new Error(
        'A query is required for web search. Use --sources alexandria --mode browse to list tools.'
      );

    // Add categories if specified
    if (options.categories && options.categories.length > 0) {
      searchParams.categories = options.categories.map((category) => ({
        type: category,
      }));
    }

    // Add time-based search parameter
    if (options.tbs) {
      searchParams.tbs = options.tbs;
    }

    // Add location parameter
    if (options.location) {
      searchParams.location = options.location;
    }

    // Add country parameter
    if (options.country) {
      searchParams.country = options.country;
    }

    // Add timeout parameter
    if (options.timeout !== undefined) {
      searchParams.timeout = options.timeout;
    }

    // Add ignoreInvalidURLs parameter
    if (options.ignoreInvalidUrls !== undefined) {
      searchParams.ignoreInvalidURLs = options.ignoreInvalidUrls;
    }

    // Add scrape options if scraping is enabled
    if (options.scrape) {
      const scrapeOptions: Record<string, any> = {};

      // Add formats
      if (options.scrapeFormats && options.scrapeFormats.length > 0) {
        scrapeOptions.formats = options.scrapeFormats.map((format) => ({
          type: format,
        }));
      } else {
        // Default to markdown if scraping is enabled but no formats specified
        scrapeOptions.formats = [{ type: 'markdown' }];
      }

      // Add onlyMainContent if specified
      if (options.onlyMainContent !== undefined) {
        scrapeOptions.onlyMainContent = options.onlyMainContent;
      }

      searchParams.scrapeOptions = scrapeOptions;
    }

    const searchBody = {
      ...(options.query.trim() ? { query: options.query } : {}),
      ...searchParams,
    };

    // Call /v2/search through the SDK's HTTP layer (auth + retries) instead
    // of `app.search()` so we keep the full response envelope. The high-level
    // `search()` helper drops `id` and `creditsUsed`, which breaks the
    // `firecrawl search-feedback <id>` workflow that consumers rely on.
    let envelope: Record<string, any>;
    if (isKeylessMode(options.apiKey, options.apiUrl)) {
      // Keyless free tier: header-less request. The API identifies the CLI via
      // the `integration: 'cli'` field already in searchParams.
      envelope = (await keylessRequest('/v2/search', searchBody)) as Record<
        string,
        any
      >;
    } else {
      const app = getClient({ apiKey: options.apiKey, apiUrl: options.apiUrl });
      const httpResponse = await (app as any).http.post(
        '/v2/search',
        searchBody
      );
      envelope = (httpResponse?.data ?? {}) as Record<string, any>;
    }
    const payload = (envelope.data ?? {}) as Record<string, any>;

    const data: SearchResultData = {};
    if (payload.alexandria) data.alexandria = payload.alexandria;
    if (payload.skills) data.skills = payload.skills;
    if (payload.web) data.web = payload.web as WebSearchResult[];
    if (payload.images) data.images = payload.images as ImageSearchResult[];
    if (payload.news) data.news = payload.news as NewsSearchResult[];
    // The `developer` category is an extra arm rather than a filter on the web
    // results, so the API returns its hits in their own group.
    if (payload.developer)
      data.developer = payload.developer as DeveloperSearchResult[];
    // Exchange hits are capability matches (never documents). The API omits
    // the group entirely when the Exchange is unreachable, so pass it through
    // exactly as received.
    if (payload.exchange)
      data.exchange = payload.exchange as ExchangeSearchResult[];
    if (payload['exchange-providers'])
      data.exchange = payload['exchange-providers'];

    return {
      success: true,
      data,
      warning: envelope.warning,
      id: envelope.id,
      creditsUsed: envelope.creditsUsed,
    };
  } catch (error) {
    return {
      success: false,
      error: exchangeErrorMessage(error),
    };
  }
}

/**
 * Shorten a matched passage for the human-readable output. A developer passage
 * runs to several KB, which floods a terminal. `--json` keeps the full text.
 */
function clipPassage(passage: string): string {
  const collapsed = passage.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= 500) {
    return collapsed;
  }
  return `${collapsed.slice(0, 500)}… (truncated, use --json for the full passage)`;
}

/**
 * Format search data in human-readable way
 */
function formatSearchReadable(
  data: SearchResultData,
  options: SearchOptions
): string {
  const lines: string[] = [];

  // Format web results
  if (data.web && data.web.length > 0) {
    // Label the web group whenever another group follows it, so the reader can
    // tell the groups apart.
    const hasDeveloperResults = !!data.developer && data.developer.length > 0;
    const hasExchangeResults = !!data.exchange && data.exchange.length > 0;
    if (
      (options.sources && options.sources.length > 1) ||
      hasDeveloperResults ||
      hasExchangeResults
    ) {
      lines.push('=== Web Results ===');
      lines.push('');
    }

    for (const result of data.web) {
      lines.push(`${result.title || 'Untitled'}`);
      lines.push(`  URL: ${result.url}`);
      if (result.description) {
        lines.push(`  ${result.description}`);
      }
      if (result.category) {
        lines.push(`  Category: ${result.category}`);
      }
      if (result.markdown) {
        lines.push('');
        lines.push('  --- Content ---');
        // Indent markdown content
        const indentedMarkdown = result.markdown
          .split('\n')
          .map((line) => `  ${line}`)
          .join('\n');
        lines.push(indentedMarkdown);
        lines.push('  --- End Content ---');
      }
      lines.push('');
    }
  }

  // Format developer results
  if (data.developer && data.developer.length > 0) {
    if (lines.length > 0) {
      lines.push('');
    }
    lines.push('=== Developer Results ===');
    lines.push('');

    for (const result of data.developer) {
      lines.push(`${result.title || 'Untitled'}`);
      lines.push(`  URL: ${result.url}`);
      if (result.description) {
        lines.push(`  ${clipPassage(result.description)}`);
      }
      lines.push('');
    }
  }

  // Format image results
  if (data.images && data.images.length > 0) {
    if (lines.length > 0) {
      lines.push('');
    }
    lines.push('=== Image Results ===');
    lines.push('');

    for (const result of data.images) {
      lines.push(`${result.title || 'Untitled'}`);
      lines.push(`  Image URL: ${result.imageUrl}`);
      lines.push(`  Source: ${result.url}`);
      if (result.imageWidth && result.imageHeight) {
        lines.push(`  Size: ${result.imageWidth}x${result.imageHeight}`);
      }
      lines.push('');
    }
  }

  // Format news results
  if (data.news && data.news.length > 0) {
    if (lines.length > 0) {
      lines.push('');
    }
    lines.push('=== News Results ===');
    lines.push('');

    for (const result of data.news) {
      lines.push(`${result.title || 'Untitled'}`);
      lines.push(`  URL: ${result.url}`);
      if (result.date) {
        lines.push(`  Date: ${result.date}`);
      }
      if (result.snippet) {
        lines.push(`  ${result.snippet}`);
      }
      if (result.markdown) {
        lines.push('');
        lines.push('  --- Content ---');
        const indentedMarkdown = result.markdown
          .split('\n')
          .map((line) => `  ${line}`)
          .join('\n');
        lines.push(indentedMarkdown);
        lines.push('  --- End Content ---');
      }
      lines.push('');
    }
  }

  // Format exchange capability hits
  if (data.exchange && data.exchange.length > 0) {
    if (lines.length > 0) {
      lines.push('');
    }
    lines.push('=== Exchange Providers ===');
    lines.push('');

    for (const hit of data.exchange) {
      lines.push(`${hit.provider}/${hit.capability}`);
      if (hit.concept) {
        lines.push(`  Concept: ${hit.concept}`);
      }
      if (hit.cohorts && hit.cohorts.length > 0) {
        lines.push(`  Cohorts: ${hit.cohorts.join(', ')}`);
      }
      if (hit.creditsCost !== undefined) {
        lines.push(`  Credits per call: ${hit.creditsCost}`);
      }
      if (hit.similarity !== undefined) {
        lines.push(`  Similarity: ${hit.similarity}`);
      }
      const cohort = hit.cohorts?.[0];
      if (cohort) {
        lines.push(
          `  Contract: firecrawl exchange discover ${cohort} ${hit.provider} ${hit.capability}`
        );
      }
      lines.push('');
    }
  }

  if (data.alexandria) lines.push(formatAlexandria(data.alexandria));
  if (data.skills)
    lines.push(`Contextual tools: ${JSON.stringify(data.skills, null, 2)}`);
  return lines.join('\n');
}

/**
 * Handle search command output
 */
export async function handleSearchCommand(
  options: SearchOptions
): Promise<void> {
  const result = await executeSearch(options);

  if (!result.success) {
    console.error('Error:', result.error);
    process.exit(1);
  }

  if (!result.data) {
    return;
  }

  // Check if there are any results
  const hasResults =
    (result.data.web && result.data.web.length > 0) ||
    (result.data.images && result.data.images.length > 0) ||
    (result.data.news && result.data.news.length > 0) ||
    (result.data.developer && result.data.developer.length > 0) ||
    (result.data.exchange && result.data.exchange.length > 0) ||
    result.data.alexandria ||
    result.data.skills?.length;

  if (!hasResults) {
    console.log('No results found.');
    return;
  }

  let outputContent: string;

  // Use JSON format if --json or --pretty flag is set
  // --pretty implies JSON output
  if (options.json || options.pretty) {
    const jsonOutput: Record<string, any> = {
      success: true,
      data: result.data,
    };

    if (result.warning) {
      jsonOutput.warning = result.warning;
    }
    if (result.id) {
      jsonOutput.id = result.id;
    }
    if (result.creditsUsed !== undefined) {
      jsonOutput.creditsUsed = result.creditsUsed;
    }

    outputContent = options.pretty
      ? JSON.stringify(jsonOutput, null, 2)
      : JSON.stringify(jsonOutput);
  } else {
    // Default to human-readable format
    outputContent = formatSearchReadable(result.data, options);
  }

  writeOutput(outputContent, options.output, !!options.output);
}
