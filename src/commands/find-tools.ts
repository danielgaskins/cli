import { Command, Option } from 'commander';
import { handleExchangeRetrieveCommand } from './exchange';
import type { ExchangeCall } from '../types/exchange';

const provider = 'firecrawl-contextual-discovery';
const capability = 'discovery/context';
const selectors = [
  'providers',
  'categories',
  'groups',
  'capabilities',
  'expand',
];

export function buildFindToolsCall(
  urls: string[],
  input: Record<string, any>
): ExchangeCall {
  if (input.request) {
    if (
      urls.length ||
      [...selectors, 'level', 'limit', 'offset'].some(
        (key) => input[key] !== undefined
      )
    ) {
      throw new Error('--request cannot be combined with lookup filters.');
    }
    const call = JSON.parse(input.request);
    if (
      call?.provider !== provider ||
      call?.capability !== capability ||
      Object.keys(call).some(
        (key) => !['provider', 'capability', 'options'].includes(key)
      )
    ) {
      throw new Error(
        '--request must be a next request returned by Find Tools.'
      );
    }
    if (
      !call.options ||
      typeof call.options !== 'object' ||
      Array.isArray(call.options)
    )
      throw new Error('Find Tools options must be an object.');
    return call;
  }
  const options: Record<string, unknown> = {};
  if (urls.length) options.urls = urls;
  for (const key of selectors)
    if (input[key])
      options[key] = input[key]
        .split(',')
        .map((s: string) => s.trim())
        .filter(Boolean);
  for (const key of ['level', 'limit', 'offset'])
    if (input[key] !== undefined) options[key] = input[key];
  if (
    input.limit !== undefined &&
    (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100)
  )
    throw new Error('--limit must be an integer from 1 to 100.');
  if (
    input.offset !== undefined &&
    (!Number.isInteger(input.offset) || input.offset < 0)
  )
    throw new Error('--offset must be a non-negative integer.');
  return { provider, capability, options };
}

export function createFindToolsCommand(name = 'find-tools'): Command {
  const command = new Command(name)
    .description(
      'Free contextual lookup and progressive disclosure. Follow next with --request; use search --sources alexandria for semantic discovery.'
    )
    .argument(
      '[urls...]',
      'Page URLs from search or scrape; pages are not fetched'
    )
    .option('--providers <ids>', 'Provider IDs, comma-separated')
    .option('--categories <ids>', 'Catalogue categories, e.g. finance,podcasts')
    .option('--groups <ids>', 'Group IDs returned by Find Tools')
    .option('--capabilities <ids>', 'Exact capability addresses')
    .addOption(
      new Option(
        '--level <level>',
        'Optional depth; inferred from selectors'
      ).choices(['providers', 'groups', 'tools'])
    )
    .option(
      '--expand <sections>',
      'Contract sections: options,response,examples'
    )
    .option('--limit <number>', 'Results per page, 1-100 (default 5)', Number)
    .option(
      '--offset <number>',
      'Page offset; prefer --request to preserve scope',
      Number
    )
    .option(
      '--request <json>',
      'A complete next request from the previous result'
    )
    .option('--request-id <id>', 'Reuse for retrying an identical request')
    .option('-k, --api-key <key>', 'Firecrawl API key')
    .option('--api-url <url>', 'API URL')
    .option('--json', 'Output JSON')
    .option('--pretty', 'Output formatted JSON')
    .option('-o, --output <path>', 'Output file path')
    .action(async (urls: string[], options) => {
      try {
        const call = buildFindToolsCall(urls, options);
        await handleExchangeRetrieveCommand({ ...options, calls: [call] });
      } catch (error) {
        console.error(
          'Error:',
          error instanceof Error ? error.message : String(error)
        );
        process.exitCode = 1;
      }
    });
  return command;
}
