/**
 * Tests for exchange command
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  EXCHANGE_KEY_REQUIRED,
  buildDiscoverPath,
  buildExchangeCalls,
  exchangeErrorMessage,
  executeExchangeDiscover,
  executeExchangeRetrieve,
  handleExchangeDiscoverCommand,
  handleExchangeRetrieveCommand,
  parseExchangeAddress,
} from '../../commands/exchange';
import { getClient, isKeylessMode } from '../../utils/client';
import { initializeConfig } from '../../utils/config';
import { writeOutput } from '../../utils/output';
import { setupTest, teardownTest } from '../utils/mock-client';

vi.mock('../../utils/output', () => ({ writeOutput: vi.fn() }));

vi.mock('../../utils/client', async () => {
  const actual = await vi.importActual('../../utils/client');
  return {
    ...actual,
    getClient: vi.fn(),
    isKeylessMode: vi.fn(() => false),
  };
});

// The SDK's HTTP layer rejects non-2xx with an axios-shaped error.
const axiosError = (status: number, body: Record<string, unknown>) =>
  Object.assign(new Error(`Request failed with status code ${status}`), {
    response: { status, data: body },
  });

const successItem = {
  provider: 'fred',
  capability: 'series/observations',
  creditsCost: 1,
  data: { observations: [{ date: '2024-01-01', value: '308.4' }] },
  records: 1,
  upstreamStatus: 200,
};

const failedItem = {
  provider: 'fred',
  capability: 'series/search',
  error: {
    code: 'credential_missing',
    message: 'FRED credential is not configured.',
    status: 503,
  },
};

describe('exchange helpers', () => {
  describe('parseExchangeAddress', () => {
    it('splits on the first slash so capability addresses keep theirs', () => {
      expect(parseExchangeAddress('fred/series/observations')).toEqual({
        provider: 'fred',
        capability: 'series/observations',
      });
    });

    it('rejects addresses without a provider or capability', () => {
      expect(() => parseExchangeAddress('fred')).toThrow(
        /provider\/capability/
      );
      expect(() => parseExchangeAddress('/finance')).toThrow(
        /provider\/capability/
      );
      expect(() => parseExchangeAddress('fred/')).toThrow(
        /provider\/capability/
      );
    });
  });

  describe('buildExchangeCalls', () => {
    it('pairs each --options value with the address at the same position', () => {
      expect(
        buildExchangeCalls(
          ['fred/series/observations', 'fred/series/search'],
          ['{"series_id":"CPIAUCSL"}']
        )
      ).toEqual([
        {
          provider: 'fred',
          capability: 'series/observations',
          options: { series_id: 'CPIAUCSL' },
        },
        { provider: 'fred', capability: 'series/search' },
      ]);
    });

    it('caps a request at 10 capabilities', () => {
      const addresses = Array.from({ length: 11 }, (_, i) => `p/cap${i}`);
      expect(() => buildExchangeCalls(addresses)).toThrow(/at most 10/);
    });

    it('rejects more --options values than addresses', () => {
      expect(() =>
        buildExchangeCalls(['fred/series/observations'], ['{}', '{}'])
      ).toThrow(/More --options values/);
    });

    it('rejects options that are not a JSON object', () => {
      expect(() =>
        buildExchangeCalls(['fred/series/observations'], ['[1]'])
      ).toThrow(/expected a JSON object/);
      expect(() =>
        buildExchangeCalls(['fred/series/observations'], ['{oops'])
      ).toThrow(/Invalid JSON in --options/);
    });

    it('requires at least one address', () => {
      expect(() => buildExchangeCalls([])).toThrow(/At least one/);
    });
  });

  describe('buildDiscoverPath', () => {
    it('walks the catalogue one rung at a time', () => {
      expect(buildDiscoverPath({})).toBe('/exchange/discover');
      expect(buildDiscoverPath({ cohort: 'finance' })).toBe(
        '/exchange/discover/finance'
      );
      expect(buildDiscoverPath({ cohort: 'finance', provider: 'fred' })).toBe(
        '/exchange/discover/finance/fred'
      );
      expect(
        buildDiscoverPath({
          cohort: 'finance',
          provider: 'fred',
          capability: 'series/observations',
        })
      ).toBe('/exchange/discover/finance/fred/series/observations');
    });

    it('encodes each segment without touching the slashes in an address', () => {
      expect(
        buildDiscoverPath({
          cohort: 'finance',
          provider: 'fred',
          capability: 'series/obs ervations',
        })
      ).toBe('/exchange/discover/finance/fred/series/obs%20ervations');
    });

    it('sends a semantic lookup as ?q= with its limit', () => {
      expect(buildDiscoverPath({ query: 'balance sheet', limit: 8 })).toBe(
        '/exchange/discover?q=balance+sheet&limit=8'
      );
    });

    it('forwards expand on a walk', () => {
      expect(buildDiscoverPath({ cohort: 'finance', expand: 'all' })).toBe(
        '/exchange/discover/finance?expand=all'
      );
    });

    it('refuses --query combined with path arguments', () => {
      expect(() =>
        buildDiscoverPath({ cohort: 'finance', query: 'balance sheet' })
      ).toThrow(/--query/);
    });
  });

  describe('exchangeErrorMessage', () => {
    it('prefers the API body error and code', () => {
      expect(
        exchangeErrorMessage(
          axiosError(403, {
            success: false,
            error: 'Exchange is not enabled for this team.',
          })
        )
      ).toBe('Exchange is not enabled for this team.');
      expect(
        exchangeErrorMessage(
          axiosError(409, {
            success: false,
            code: 'duplicate_request',
            error: 'This request id was already charged.',
            chargeId: 'c1',
          })
        )
      ).toBe(
        'This request id was already charged. (duplicate_request) — chargeId: c1 — Use a new --request-id for a new payload.'
      );
    });

    it('falls back to the status and then the error message', () => {
      expect(exchangeErrorMessage(axiosError(402, {}))).toBe(
        'Firecrawl request failed (HTTP 402)'
      );
      expect(exchangeErrorMessage(new Error('boom'))).toBe('boom');
      expect(exchangeErrorMessage('nope')).toBe('Unknown error occurred');
    });
  });
});

describe('executeExchangeDiscover / executeExchangeRetrieve', () => {
  let mockHttpGet: ReturnType<typeof vi.fn>;
  let mockHttpPost: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    setupTest();
    initializeConfig({
      apiKey: 'test-api-key',
      apiUrl: 'https://api.firecrawl.dev',
    });
    mockHttpGet = vi.fn();
    mockHttpPost = vi.fn();
    vi.mocked(getClient).mockReturnValue({
      http: { get: mockHttpGet, post: mockHttpPost },
    } as any);
    vi.mocked(isKeylessMode).mockReturnValue(false);
  });

  afterEach(() => {
    teardownTest();
    vi.clearAllMocks();
  });

  it('GETs the proxied discover path and returns the payload verbatim', async () => {
    const payload = {
      capabilities: [
        {
          address: 'series/observations',
          cohorts: ['finance'],
          concept: 'series/observations',
          creditsCost: 1,
          provider: 'fred',
          similarity: 0.8123,
        },
      ],
      query: 'cpi',
      searched: 54,
      source: 'process',
    };
    mockHttpGet.mockResolvedValue({ data: payload });

    const result = await executeExchangeDiscover({
      query: 'cpi',
      apiKey: 'fc-key',
      apiUrl: 'http://localhost:3002',
    });

    expect(getClient).toHaveBeenCalledWith({
      apiKey: 'fc-key',
      apiUrl: 'http://localhost:3002',
    });
    expect(mockHttpGet).toHaveBeenCalledWith('/exchange/discover?q=cpi');
    expect(result).toEqual({ success: true, data: payload });
  });

  it('relays the API error body from discover', async () => {
    mockHttpGet.mockRejectedValue(
      axiosError(501, {
        code: 'semantic_not_configured',
        error: 'Semantic lookup needs an embedding key.',
      })
    );

    const result = await executeExchangeDiscover({ query: 'cpi' });

    expect(result).toEqual({
      success: false,
      error:
        'Semantic lookup needs an embedding key. (semantic_not_configured)',
    });
  });

  it('refuses discover in keyless mode without calling the API', async () => {
    vi.mocked(isKeylessMode).mockReturnValue(true);

    const result = await executeExchangeDiscover({ cohort: 'finance' });

    expect(result).toEqual({ success: false, error: EXCHANGE_KEY_REQUIRED });
    expect(getClient).not.toHaveBeenCalled();
    expect(mockHttpGet).not.toHaveBeenCalled();
  });

  it('POSTs the url-less /v2/scrape shape and passes creditsCost through untouched', async () => {
    mockHttpPost.mockResolvedValue({
      data: {
        success: true,
        scrape_id: 'scrape-1',
        data: { alexandria: [successItem, failedItem], creditsCost: 1 },
      },
    });

    const result = await executeExchangeRetrieve({
      calls: [
        {
          provider: 'fred',
          capability: 'series/observations',
          options: { series_id: 'CPIAUCSL' },
        },
        { provider: 'fred', capability: 'series/search' },
      ],
      timeout: 30000,
    });

    expect(mockHttpPost).toHaveBeenCalledTimes(1);
    expect(mockHttpPost).toHaveBeenCalledWith(
      '/v2/scrape',
      {
        alexandria: [
          {
            provider: 'fred',
            capability: 'series/observations',
            options: { series_id: 'CPIAUCSL' },
          },
          { provider: 'fred', capability: 'series/search' },
        ],
        integration: 'cli',
        timeout: 30000,
      },
      { headers: { 'x-request-id': result.requestId } }
    );
    expect(result).toEqual({
      success: true,
      scrapeId: 'scrape-1',
      requestId: expect.any(String),
      exchange: [successItem, failedItem],
      creditsCost: 1,
    });
  });

  it('reuses the same execution ID on a manual retry after an uncertain failure', async () => {
    const calls = [{ provider: 'fred', capability: 'series/observations' }];
    mockHttpPost
      .mockRejectedValueOnce(new Error('Connection reset'))
      .mockResolvedValueOnce({
        data: { success: true, data: { alexandria: [] } },
      });
    const first = await executeExchangeRetrieve({ calls });
    expect(first.success).toBe(false);
    const retry = await executeExchangeRetrieve({
      calls,
      requestId: first.requestId,
    });
    expect(retry.requestId).toBe(first.requestId);
    expect(mockHttpPost.mock.calls[0]).toEqual(mockHttpPost.mock.calls[1]);
    expect(mockHttpPost.mock.calls[0][2]).toEqual({
      headers: { 'x-request-id': first.requestId },
    });
  });

  it('omits timeout when not provided', async () => {
    mockHttpPost.mockResolvedValue({
      data: {
        success: true,
        scrape_id: 'scrape-2',
        data: { alexandria: [successItem], creditsCost: 1 },
      },
    });

    await executeExchangeRetrieve({
      calls: [{ provider: 'fred', capability: 'series/observations' }],
    });

    expect(mockHttpPost).toHaveBeenCalledWith(
      '/v2/scrape',
      {
        alexandria: [{ provider: 'fred', capability: 'series/observations' }],
        integration: 'cli',
      },
      { headers: { 'x-request-id': expect.any(String) } }
    );
  });

  it('relays the 403 body when the team has no Exchange flag', async () => {
    mockHttpPost.mockRejectedValue(
      axiosError(403, {
        success: false,
        error: 'Exchange is not enabled for this team.',
      })
    );

    const result = await executeExchangeRetrieve({
      calls: [{ provider: 'fred', capability: 'series/observations' }],
    });

    expect(result).toEqual({
      success: false,
      requestId: expect.any(String),
      error: 'Exchange is not enabled for this team.',
    });
  });

  it('refuses retrieve in keyless mode without calling the API', async () => {
    vi.mocked(isKeylessMode).mockReturnValue(true);

    const result = await executeExchangeRetrieve({
      calls: [{ provider: 'fred', capability: 'series/observations' }],
    });

    expect(result).toEqual({
      success: false,
      requestId: expect.any(String),
      error: EXCHANGE_KEY_REQUIRED,
    });
    expect(mockHttpPost).not.toHaveBeenCalled();
  });

  it('rejects an empty or oversized batch before calling the API', async () => {
    const empty = await executeExchangeRetrieve({ calls: [] });
    expect(empty.success).toBe(false);
    expect(empty.error).toMatch(/At least one/);

    const oversized = await executeExchangeRetrieve({
      calls: Array.from({ length: 11 }, (_, i) => ({
        provider: 'p',
        capability: `cap${i}`,
      })),
    });
    expect(oversized.success).toBe(false);
    expect(oversized.error).toMatch(/at most 10/);
    expect(mockHttpPost).not.toHaveBeenCalled();
  });
});

describe('handleExchangeDiscoverCommand / handleExchangeRetrieveCommand', () => {
  let mockHttpGet: ReturnType<typeof vi.fn>;
  let mockHttpPost: ReturnType<typeof vi.fn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  const writtenOutput = () =>
    vi.mocked(writeOutput).mock.calls.at(-1)?.[0] as string;

  beforeEach(() => {
    setupTest();
    initializeConfig({
      apiKey: 'test-api-key',
      apiUrl: 'https://api.firecrawl.dev',
    });
    mockHttpGet = vi.fn();
    mockHttpPost = vi.fn();
    vi.mocked(getClient).mockReturnValue({
      http: { get: mockHttpGet, post: mockHttpPost },
    } as any);
    vi.mocked(isKeylessMode).mockReturnValue(false);
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code: number) => {
      throw new Error(`exit ${code}`);
    }) as never);
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    stderrSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
  });

  afterEach(() => {
    exitSpy.mockRestore();
    errorSpy.mockRestore();
    stderrSpy.mockRestore();
    teardownTest();
    vi.clearAllMocks();
  });

  it('prints cohorts in a readable list', async () => {
    mockHttpGet.mockResolvedValue({
      data: {
        cohorts: [
          { cohort: 'finance', about: 'Markets and macro.', providers: 3 },
        ],
      },
    });

    await handleExchangeDiscoverCommand({});

    const output = writtenOutput();
    expect(output).toContain('=== Cohorts ===');
    expect(output).toContain('finance (3 providers)');
    expect(output).toContain('Markets and macro.');
  });

  it('prints semantic hits with their address, cost and similarity', async () => {
    mockHttpGet.mockResolvedValue({
      data: {
        capabilities: [
          {
            address: 'series/observations',
            cohorts: ['finance'],
            concept: 'series/observations',
            creditsCost: 1,
            provider: 'fred',
            similarity: 0.8123,
          },
        ],
        query: 'cpi',
        searched: 54,
        source: 'process',
      },
    });

    await handleExchangeDiscoverCommand({ query: 'cpi' });

    const output = writtenOutput();
    expect(output).toContain('=== Capabilities matching "cpi" ===');
    expect(output).toContain('fred/series/observations  (1 credits)');
    expect(output).toContain('Similarity: 0.8123');
    expect(output).toContain('Searched 54 capabilities (process).');
  });

  it('prints a contract with its options and a ready-to-run retrieve line', async () => {
    mockHttpGet.mockResolvedValue({
      data: {
        capability: 'series/observations',
        provider: 'fred',
        creditsCost: 1,
        label: 'FRED series observations',
        options: [
          {
            name: 'series_id',
            required: true,
            description: 'FRED series id, e.g. CPIAUCSL',
          },
        ],
        returns: { key: 'observations' },
        example: { options: { series_id: 'CPIAUCSL' } },
      },
    });

    await handleExchangeDiscoverCommand({
      cohort: 'finance',
      provider: 'fred',
      capability: 'series/observations',
    });

    expect(mockHttpGet).toHaveBeenCalledWith(
      '/exchange/discover/finance/fred/series/observations'
    );
    const output = writtenOutput();
    expect(output).toContain('=== fred/series/observations ===');
    expect(output).toContain('Credits cost: 1');
    expect(output).toContain('series_id (required: true)');
    expect(output).toContain('FRED series id, e.g. CPIAUCSL');
    expect(output).toContain(
      `Retrieve: firecrawl exchange retrieve fred/series/observations --options '{"series_id":"CPIAUCSL"}'`
    );
  });

  it('writes the discover payload verbatim with --json', async () => {
    const payload = { cohort: 'finance', providers: [] };
    mockHttpGet.mockResolvedValue({ data: payload });

    await handleExchangeDiscoverCommand({ cohort: 'finance', json: true });

    expect(JSON.parse(writtenOutput())).toEqual(payload);
  });

  it('exits 1 with the explanatory error in keyless mode', async () => {
    vi.mocked(isKeylessMode).mockReturnValue(true);

    await expect(handleExchangeDiscoverCommand({})).rejects.toThrow('exit 1');

    expect(errorSpy).toHaveBeenCalledWith('Error:', EXCHANGE_KEY_REQUIRED);
    expect(mockHttpGet).not.toHaveBeenCalled();
    expect(writeOutput).not.toHaveBeenCalled();
  });

  it('prints each retrieve item with its creditsCost and the total', async () => {
    mockHttpPost.mockResolvedValue({
      data: {
        success: true,
        scrape_id: 'scrape-1',
        data: { alexandria: [successItem, failedItem], creditsCost: 1 },
      },
    });

    await handleExchangeRetrieveCommand({
      calls: [
        { provider: 'fred', capability: 'series/observations' },
        { provider: 'fred', capability: 'series/search' },
      ],
    });

    const output = writtenOutput();
    expect(output).toContain('fred/series/observations');
    expect(output).toContain('Credits cost: 1');
    expect(output).toContain('Records: 1');
    expect(output).toContain('"value": "308.4"');
    expect(output).toContain(
      'Error [credential_missing]: FRED credential is not configured. (HTTP 503)'
    );
    expect(output).toContain('Total credits cost: 1');
    expect(stderrSpy).toHaveBeenCalledWith('Scrape ID: scrape-1\n');
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('mirrors the /v2/scrape envelope with --json', async () => {
    mockHttpPost.mockResolvedValue({
      data: {
        success: true,
        scrape_id: 'scrape-1',
        data: { alexandria: [successItem], creditsCost: 1 },
      },
    });

    await handleExchangeRetrieveCommand({
      calls: [{ provider: 'fred', capability: 'series/observations' }],
      json: true,
    });

    expect(JSON.parse(writtenOutput())).toEqual({
      success: true,
      requestId: expect.any(String),
      scrape_id: 'scrape-1',
      data: { alexandria: [successItem], creditsCost: 1 },
    });
  });

  it('exits 1 only when every item in the batch failed', async () => {
    mockHttpPost.mockResolvedValue({
      data: {
        success: true,
        scrape_id: 'scrape-3',
        data: { alexandria: [failedItem], creditsCost: 0 },
      },
    });

    await expect(
      handleExchangeRetrieveCommand({
        calls: [{ provider: 'fred', capability: 'series/search' }],
      })
    ).rejects.toThrow('exit 1');

    expect(writtenOutput()).toContain('Error [credential_missing]');
  });

  it('exits 1 with the API error when the request itself fails', async () => {
    mockHttpPost.mockRejectedValue(
      axiosError(403, {
        success: false,
        error: 'Exchange is not enabled for this team.',
      })
    );

    await expect(
      handleExchangeRetrieveCommand({
        calls: [{ provider: 'fred', capability: 'series/observations' }],
      })
    ).rejects.toThrow('exit 1');

    expect(errorSpy).toHaveBeenCalledWith(
      'Error:',
      'Exchange is not enabled for this team.'
    );
  });

  it('exits 1 with the explanatory error for retrieve in keyless mode', async () => {
    vi.mocked(isKeylessMode).mockReturnValue(true);

    await expect(
      handleExchangeRetrieveCommand({
        calls: [{ provider: 'fred', capability: 'series/observations' }],
      })
    ).rejects.toThrow('exit 1');

    expect(errorSpy).toHaveBeenCalledWith('Error:', EXCHANGE_KEY_REQUIRED);
    expect(mockHttpPost).not.toHaveBeenCalled();
  });
});
