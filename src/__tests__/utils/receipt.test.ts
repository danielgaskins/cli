import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiFailure } from '../../commands/alexandria';
import { printReceipt, printRetry, receiptFor } from '../../utils/receipt';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('execution receipts', () => {
  it('reports actual charges, including free executions, on each response surface', () => {
    expect(receiptFor({ metadata: { creditsUsed: 0 } }, 'scrape')).toEqual({
      creditsUsed: 0,
    });
    expect(receiptFor({ creditsCost: 5 }, 'scrape')).toEqual({
      creditsUsed: 5,
    });
    expect(receiptFor({ data: { creditsCost: 2.5 } }, 'scrape')).toEqual({
      creditsUsed: 2.5,
    });
    expect(receiptFor({ creditsUsed: 0 }, 'search')).toEqual({
      creditsUsed: 0,
    });
  });

  it.each([undefined, null, -1, NaN, Infinity, '5'])(
    'does not present an unknown or invalid charge (%s) as zero',
    (creditsUsed) => {
      expect(
        receiptFor({ metadata: { creditsUsed } }, 'scrape')
      ).not.toHaveProperty('creditsUsed');
      expect(receiptFor({ creditsUsed }, 'search')).not.toHaveProperty(
        'creditsUsed'
      );
    }
  );

  it('does not turn a quote or a catalogue price into an execution charge', () => {
    const quote = { price: 5, estimatedCredits: 5, quote: { creditsCost: 5 } };
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => {});
    printReceipt(receiptFor(quote, 'scrape'));
    expect(stderr).not.toHaveBeenCalled();
  });

  it('keeps the retry request identity distinct from the server operation identity', () => {
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => {});
    const stdout = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);
    const receipt = receiptFor(
      { id: 'search-server-id', creditsUsed: 0 },
      'search',
      'retry-client-id'
    );
    expect(receipt).toMatchObject({
      requestId: 'retry-client-id',
      operationId: 'search-server-id',
    });
    printReceipt(receipt);
    expect(stderr.mock.calls.map(([line]) => line)).toEqual([
      'Request ID: retry-client-id',
      'Search ID: search-server-id',
      'Credits: 0',
    ]);
    expect(stdout).not.toHaveBeenCalled();
  });

  it('can print a server receipt without repeating an already printed request ID', () => {
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => {});
    printReceipt(
      receiptFor(
        { metadata: { scrapeId: 'server-id', creditsUsed: 5 } },
        'scrape',
        'client-id'
      ),
      false
    );
    expect(stderr.mock.calls.map(([line]) => line)).toEqual([
      'Scrape ID: server-id',
      'Credits: 5',
    ]);
  });
});

describe('failure receipts and retry guidance', () => {
  it('retains actionable failure fields without serializing transport credentials or unknown fields', () => {
    const error = Object.assign(new Error('transport message'), {
      config: { headers: { Authorization: 'Bearer secret-key' } },
      response: {
        status: 429,
        headers: { 'retry-after': '2', 'set-cookie': 'secret-cookie' },
        data: {
          error: 'Rate limited',
          code: 'rate_limited',
          requestId: 'client-id',
          scrapeId: 'server-id',
          apiKey: 'secret-key',
          debug: { headers: { Authorization: 'secret-key' } },
        },
      },
    });
    expect(apiFailure(error)).toEqual({
      success: false,
      error: 'Rate limited',
      code: 'rate_limited',
      requestId: 'client-id',
      scrapeId: 'server-id',
      status: 429,
      retryAfterSeconds: 2,
    });
    expect(JSON.stringify(apiFailure(error))).not.toContain('secret');
  });

  it('rounds a fractional structured retry delay up rather than retrying early', () => {
    expect(
      apiFailure({
        details: { error: 'Busy', retry_after_seconds: 1.1 },
        status: 429,
      })
    ).toMatchObject({ retryAfterSeconds: 2 });
  });

  it('understands an HTTP-date Retry-After from standard Headers', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-17T12:00:00.500Z'));
    const failure = apiFailure({
      response: {
        status: 503,
        data: { error: 'Unavailable' },
        headers: new Headers({
          'Retry-After': 'Thu, 17 Sep 2026 12:00:03 GMT',
        }),
      },
    });
    expect(failure.retryAfterSeconds).toBe(3);
  });

  it.each([undefined, 'not-a-delay', '-5', 'Infinity'])(
    'does not invent retry timing from unknown headers (%s)',
    (retry) => {
      const failure = apiFailure({
        response: {
          status: 502,
          data: { error: 'Failed' },
          headers: { 'retry-after': retry },
        },
      });
      expect(failure).not.toHaveProperty('retryAfterSeconds');
      const stderr = vi.spyOn(console, 'error').mockImplementation(() => {});
      printRetry(failure);
      expect(stderr).not.toHaveBeenCalled();
    }
  );

  it('prints a supplied zero-second retry delay rather than suppressing it', () => {
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => {});
    printRetry(
      apiFailure({ details: { error: 'Retry now', retryAfterSeconds: 0 } })
    );
    expect(stderr).toHaveBeenCalledWith('Retry after: 0s');
  });
});
