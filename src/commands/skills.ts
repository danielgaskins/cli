import { getClient } from '../utils/client';
import { writeOutput } from '../utils/output';
import { assertExchangeKeyed, exchangeErrorMessage } from './exchange';

export async function handleSkillCommand(options: {
  urls?: string[];
  query?: string;
  context?: 'search' | 'scrape';
  id?: string;
  apiKey?: string;
  apiUrl?: string;
  output?: string;
}): Promise<void> {
  try {
    assertExchangeKeyed(options.apiKey, options.apiUrl);
    if (!options.id && !options.urls?.length && !options.query?.trim())
      throw new Error('Provide at least one URL or --query.');
    if (options.id === '.' || options.id === '..')
      throw new Error('Invalid skill ID.');
    const app = getClient(options) as any;
    const response = options.id
      ? await app.http.get(
          `/exchange/skills/${encodeURIComponent(options.id)}/SKILL.md`
        )
      : await app.http.post(
          '/exchange/skills/resolve',
          JSON.stringify({
            urls: options.urls ?? [],
            query: options.query,
            context: options.context,
          }),
          { headers: { 'Content-Type': 'application/json' } }
        );
    writeOutput(
      typeof response.data === 'string'
        ? response.data
        : JSON.stringify(response.data, null, 2),
      options.output,
      !!options.output
    );
  } catch (error) {
    console.error('Error:', exchangeErrorMessage(error));
    process.exit(1);
  }
}
