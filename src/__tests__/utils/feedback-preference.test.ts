import { afterEach, expect, it, vi } from 'vitest';
import { keylessRequest } from '../../utils/client';

vi.mock('../../utils/config', () => ({
  getConfig: () => ({ apiUrl: 'https://example.test' }),
}));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it.each(['/v2/search', '/v2/scrape'])(
  'forwards invitation opt-out for %s without changing the operation',
  async (path) => {
    vi.stubEnv('FIRECRAWL_DISABLE_ENDPOINT_FEEDBACK', 'true');
    const fetch = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
    vi.stubGlobal('fetch', fetch);
    expect(await keylessRequest(path, { example: 'fixture' })).toEqual({
      success: true,
    });
    expect(fetch.mock.calls[0][1]).toMatchObject({
      headers: {
        'Content-Type': 'application/json',
        'x-firecrawl-no-feedback': '1',
      },
      body: JSON.stringify({ example: 'fixture' }),
    });
    expect(fetch.mock.calls[0][1].headers.Authorization).toBeUndefined();
  }
);
