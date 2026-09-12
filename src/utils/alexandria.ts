import { Option, type Command } from 'commander';

export type SearchSourceInput =
  | string
  | ({ type: string } & Record<string, unknown>);
const sourceNames = ['web', 'images', 'news', 'alexandria'];
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
      type === 'alexandria' &&
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
  return sources.some(
    (source) =>
      (typeof source === 'string' ? source : source.type) === 'alexandria'
  );
}
export function addAlexandriaOptions(command: Command): Command {
  return command
    .option(
      '--domain-tools',
      'Include domain-matched contracts in tools alongside semantic matches'
    )
    .addOption(
      new Option(
        '--skills',
        '(deprecated, use --domain-tools) Include domain-matched contracts in tools alongside semantic matches'
      ).hideHelp()
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
