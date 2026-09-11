import type { Command } from 'commander';

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
export function normalizeSources(
  sources: SearchSourceInput[]
): SearchSourceInput[] {
  return sources.map((source) => {
    const name = typeof source === 'string' ? source : source?.type;
    const type = name === 'exchange' ? 'alexandria' : name;
    if (!sourceNames.includes(type))
      throw new Error(`Invalid source: ${String(name)}`);
    if (
      typeof source !== 'string' &&
      ['alexandria', 'exchange-providers'].includes(type) &&
      Object.keys(source).some((key) => key !== 'type')
    ) {
      throw new Error(
        'Search accepts only the Alexandria source type. Use firecrawl find-tools for catalogue filters.'
      );
    }
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
  return command.option(
    '--skills',
    'Include domain-matched contracts in tools alongside semantic matches'
  );
}
export function parseSearchSources(
  raw: string | undefined
): SearchSourceInput[] | undefined {
  if (!raw) return undefined;
  const sources = raw.trim().startsWith('[')
    ? JSON.parse(raw)
    : raw
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
  if (!Array.isArray(sources) || !sources.length)
    throw new Error('--sources must contain source names or a JSON array.');
  return normalizeSources(sources);
}
export function formatTools(tools: Array<Record<string, any>>): string {
  return tools
    .map((tool) =>
      [
        `${tool.name} (${tool.provider}/${tool.capability})`,
        tool.description,
        `${tool.creditsCost} credits per ${tool.perRecord ? 'record' : 'call'}`,
        `Matched by: ${(tool.matchedBy ?? []).join(', ')}`,
        ...(tool.matchedUrls ?? []),
        ...['options', 'requiresOneOf', 'response', 'examples']
          .filter((key) => tool[key] !== undefined)
          .map((key) => `${key}: ${JSON.stringify(tool[key], null, 2)}`),
      ].join('\n')
    )
    .join('\n\n');
}
