/**
 * Types for the exchange commands
 *
 * Mirrors the frozen Firecrawl Exchange interface: discovery goes through
 * GET /exchange/discover and execution goes through POST /v2/scrape with an
 * `exchange` array (url-less scrape).
 */

/** One capability to execute: `provider/capability` plus its options. */
export interface ExchangeCall {
  provider: string;
  capability: string;
  options?: Record<string, unknown>;
}

interface ExchangeCommonOptions {
  /** API key for Firecrawl */
  apiKey?: string;
  /** API URL for Firecrawl */
  apiUrl?: string;
  /** Output file path */
  output?: string;
  /** Output as JSON format */
  json?: boolean;
  /** Pretty print JSON output */
  pretty?: boolean;
}

export interface ExchangeDiscoverOptions extends ExchangeCommonOptions {
  /** Cohort slug (first rung of the walk), e.g. `finance` */
  cohort?: string;
  /** Provider slug (second rung), e.g. `fred` */
  provider?: string;
  /** Capability address (third rung), e.g. `finance/series/observations` */
  capability?: string;
  /** Semantic lookup across the whole catalogue (root only) */
  query?: string;
  /** Result cap for semantic lookup (1..24) */
  limit?: number;
  /** How much of the tree to inline on a walk: capabilities, contracts, examples, all */
  expand?: string;
}

export interface ExchangeRetrieveOptions extends ExchangeCommonOptions {
  /** 1..10 capabilities to execute in one request */
  calls: ExchangeCall[];
  /** Timeout in milliseconds forwarded to /v2/scrape */
  timeout?: number;
}

/** A successful per-item execution result. */
export interface ExchangeScrapeSuccess {
  provider: string;
  capability: string;
  creditsCost: number;
  data: unknown;
  records?: number;
  upstreamStatus?: number;
  recordedAt?: string;
  [key: string]: unknown;
}

/** A failed per-item execution result. The batch itself still returns 200. */
export interface ExchangeScrapeFailure {
  provider?: string;
  capability?: string;
  error: { code: string; message: string; status?: number };
  [key: string]: unknown;
}

export type ExchangeScrapeResult =
  | ExchangeScrapeSuccess
  | ExchangeScrapeFailure;

export interface ExchangeScrapeResponse {
  success: boolean;
  scrape_id?: string;
  data?: {
    exchange: ExchangeScrapeResult[];
    creditsCost: number;
  };
  error?: string;
}

export interface ExchangeDiscoverResult {
  success: boolean;
  /** The discover payload exactly as returned by the API */
  data?: Record<string, unknown>;
  error?: string;
}

export interface ExchangeRetrieveResult {
  success: boolean;
  scrapeId?: string;
  exchange?: ExchangeScrapeResult[];
  /** Sum of the successful items' creditsCost, passed through untouched */
  creditsCost?: number;
  error?: string;
}
