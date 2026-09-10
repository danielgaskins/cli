import type { Command } from 'commander';

export interface AlexandriaSource {
  type: 'alexandria' | 'exchange-providers';
  mode?: 'semantic' | 'browse';
  categories?: string[];
  providers?: string[];
  domains?: string[];
  groups?: string[];
  capabilities?: string[];
  level?: 'categories' | 'providers' | 'groups' | 'tools';
  expand?: Array<'options' | 'response' | 'examples'>;
  languages?: Array<'javascript' | 'python' | 'curl'>;
  cursor?: string;
  limit?: number;
}

export type SearchSourceInput =
  | string
  | ({ type: string } & Record<string, unknown>);
const sourceNames = [
  'web',
  'images',
  'news',
  'alexandria',
  'exchange-providers',
];
const list = (value: string) =>
  value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

export function normalizeSources(
  sources: SearchSourceInput[]
): SearchSourceInput[] {
  return sources.map((source) => {
    const name = typeof source === 'string' ? source : source?.type;
    const type = name === 'exchange' ? 'alexandria' : name;
    if (!sourceNames.includes(type))
      throw new Error(`Invalid source: ${String(name)}`);
    return typeof source === 'string' ? type : { ...source, type };
  });
}

export function hasAlexandria(sources: SearchSourceInput[] = []): boolean {
  return sources.some((source) =>
    ['alexandria', 'exchange-providers', 'exchange'].includes(
      typeof source === 'string' ? source : source.type
    )
  );
}

export function addAlexandriaOptions(command: Command): Command {
  return command
    .option('--mode <mode>', 'Alexandria lookup: semantic or browse')
    .option(
      '--tool-categories <categories>',
      'Alexandria categories, e.g. finance,retail,podcasts'
    )
    .option(
      '--providers <providers>',
      'Alexandria provider slugs, comma-separated'
    )
    .option('--domains <domains>', 'Match configured domains, comma-separated')
    .option('--groups <groups>', 'Capability groups, comma-separated')
    .option(
      '--capabilities <capabilities>',
      'Capability addresses, comma-separated'
    )
    .option(
      '--level <level>',
      'Disclosure: categories, providers, groups, tools'
    )
    .option('--expand <sections>', 'Tool details: options,response,examples')
    .option('--languages <languages>', 'Examples: javascript,python,curl')
    .option(
      '--cursor <cursor>',
      'Next-page cursor; keep the same query and filters'
    )
    .option(
      '--skills',
      'Include contextual tool matches for the query and result URLs'
    );
}

export function parseSearchSources(
  raw: string | undefined,
  options: Record<string, any> = {}
): SearchSourceInput[] | undefined {
  const filters: Record<string, unknown> = {};
  for (const name of [
    'providers',
    'domains',
    'groups',
    'capabilities',
    'expand',
    'languages',
  ])
    if (options[name]) filters[name] = list(options[name]);
  if (options.toolCategories) filters.categories = list(options.toolCategories);
  for (const name of ['mode', 'level', 'cursor'])
    if (options[name]) filters[name] = options[name];
  const filtered = Object.keys(filters).length > 0;
  if (!raw && !filtered) return undefined;
  const parsed = raw?.trim().startsWith('[')
    ? JSON.parse(raw)
    : raw
      ? list(raw)
      : ['alexandria'];
  if (!Array.isArray(parsed) || !parsed.length)
    throw new Error('--sources must contain source names or a JSON array.');
  const sources = normalizeSources(parsed);
  if (filtered && !hasAlexandria(sources))
    throw new Error(
      'Alexandria filters require --sources alexandria (optionally mixed with web).'
    );
  return sources.map((source) => {
    const type = typeof source === 'string' ? source : source.type;
    return filtered && ['alexandria', 'exchange-providers'].includes(type)
      ? { ...(typeof source === 'string' ? { type } : source), ...filters }
      : source;
  });
}

export interface AlexandriaResponse {
  status: 'available' | 'unavailable';
  level: string;
  mode: string;
  items: Array<Record<string, any>>;
  total: number | null;
  nextCursor: string | null;
  error?: string;
}

export function formatAlexandria(data: AlexandriaResponse): string {
  if (data.status === 'unavailable')
    return data.error ?? 'Alexandria is temporarily unavailable.';
  const lines = [
    `Alexandria · ${data.total ?? data.items.length} ${data.level}`,
  ];
  for (const item of data.items) {
    lines.push(
      `\n${item.name ?? item.id} (${item.toolCount} tools)`,
      `  ${item.id}`
    );
    if (item.description) lines.push(`  ${item.description}`);
    if (item.creditsCost !== undefined)
      lines.push(
        `  ${item.creditsCost} credits per ${item.perRecord ? 'record' : 'call'}`
      );
    for (const section of ['options', 'requiresOneOf', 'response', 'examples'])
      if (item[section] !== undefined)
        lines.push(`${section}: ${JSON.stringify(item[section], null, 2)}`);
    if (item.next) lines.push(`  Next request: ${JSON.stringify(item.next)}`);
  }
  if (data.nextCursor) lines.push(`\nNext page: --cursor ${data.nextCursor}`);
  return lines.join('\n');
}
