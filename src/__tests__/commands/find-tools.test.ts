import { describe, expect, it } from 'vitest';
import { buildFindToolsCall } from '../../commands/find-tools';

describe('Find Tools', () => {
  it('builds an inferred lookup and preserves next requests', () => {
    const call = buildFindToolsCall([], {
      providers: 'particle',
      capabilities: 'podcasts/episodes/search',
      expand: 'options,response',
      limit: 2,
    });
    expect(call).toEqual({
      provider: 'firecrawl',
      capability: 'find-tools',
      options: {
        providers: ['particle'],
        capabilities: ['podcasts/episodes/search'],
        expand: ['options', 'response'],
        limit: 2,
      },
    });
    const next = { ...call, options: { ...call.options, offset: 2 } };
    expect(buildFindToolsCall([], { request: JSON.stringify(next) })).toEqual(
      next
    );
  });
  it('does not turn a discovery next request into arbitrary paid execution', () => {
    expect(() =>
      buildFindToolsCall([], {
        request: JSON.stringify({
          provider: 'particle',
          capability: 'podcasts/episodes/search',
        }),
      })
    ).toThrow();
    expect(() => buildFindToolsCall([], { limit: 0 })).toThrow();
    expect(() => buildFindToolsCall([], { offset: -1 })).toThrow();
  });
});
