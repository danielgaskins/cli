/**
 * Exchange command implementation
 *
 * `firecrawl exchange discover` walks or searches the capability catalogue
 * (GET /exchange/discover) and `firecrawl exchange retrieve` executes
 * capabilities through the url-less /v2/scrape shape. Both need a Firecrawl
 * API key on a team with Exchange access: the keyless free tier has no team
 * flag, so we refuse locally instead of surfacing an opaque 403.
 */

import type {
  ExchangeCall,
  ExchangeDiscoverOptions,
  ExchangeDiscoverResult,
  ExchangeRequiresAction,
  ExchangeRetrieveOptions,
  ExchangeRetrieveResult,
  ExchangeScrapeFailure,
  ExchangeScrapeResponse,
  ExchangeScrapeResult,
} from '../types/exchange';
import { getClient, isKeylessMode } from '../utils/client';
import { writeOutput } from '../utils/output';
import {
  TERMS_REQUIRED_CODE,
  formatTermsRequired,
  parseRequiresAction,
} from '../utils/terms';
import { randomUUID } from 'node:crypto';

export const EXCHANGE_KEY_REQUIRED =
  'Exchange requires a Firecrawl API key on a team with Exchange access. ' +
  'Set FIRECRAWL_API_KEY, pass --api-key, or run "firecrawl login".';

const MAX_EXCHANGE_CALLS = 10;

/**
 * Refuse before the request leaves the machine when no key would be sent.
 */
export function assertExchangeKeyed(apiKey?: string, apiUrl?: string): void {
  if (isKeylessMode(apiKey, apiUrl)) {
    throw new Error(EXCHANGE_KEY_REQUIRED);
  }
}

/**
 * Split `provider/capability` on the first slash. Capability addresses carry
 * slashes of their own (`series/observations`), so only the first one
 * separates the provider.
 */
export function parseExchangeAddress(address: string): ExchangeCall {
  const trimmed = address.trim();
  const slash = trimmed.indexOf('/');
  if (slash <= 0 || slash === trimmed.length - 1) {
    throw new Error(
      `Invalid exchange address "${address}": expected provider/capability (e.g. fred/series/observations)`
    );
  }
  return {
    provider: trimmed.slice(0, slash),
    capability: trimmed.slice(slash + 1),
  };
}

/**
 * Parse one `--options` value into the capability's options object.
 */
export function parseExchangeOptions(
  raw: string,
  label: string = '--options'
): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Invalid JSON in ${label}: ${error instanceof Error ? error.message : 'Unable to parse JSON'}`
    );
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Invalid ${label}: expected a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

/**
 * Pair each address with the `--options` value at the same position. A single
 * `--options` therefore applies to the first address only.
 */
export function buildExchangeCalls(
  addresses: string[],
  optionsJson: string[] = []
): ExchangeCall[] {
  if (addresses.length === 0) {
    throw new Error('At least one provider/capability address is required.');
  }
  if (addresses.length > MAX_EXCHANGE_CALLS) {
    throw new Error(
      `Exchange accepts at most ${MAX_EXCHANGE_CALLS} capabilities per request (got ${addresses.length}).`
    );
  }
  if (optionsJson.length > addresses.length) {
    throw new Error(
      `More --options values (${optionsJson.length}) than capabilities (${addresses.length}); each --options pairs with the address at the same position.`
    );
  }
  return addresses.map((address, index) => {
    const call = parseExchangeAddress(address);
    const raw = optionsJson[index];
    if (raw !== undefined) {
      call.options = parseExchangeOptions(raw);
    }
    return call;
  });
}

/**
 * Compose the proxied discover path. Segments are encoded one at a time so a
 * capability address keeps its slashes.
 */
export function buildDiscoverPath(options: ExchangeDiscoverOptions): string {
  const segments = [options.cohort, options.provider, options.capability]
    .map((segment) => segment?.trim() ?? '')
    .filter((segment) => segment !== '');

  if (options.query && segments.length > 0) {
    throw new Error(
      '--query searches the whole catalogue; drop the cohort/provider/capability arguments or the --query.'
    );
  }

  const path = segments
    .map((segment) => segment.split('/').map(encodeURIComponent).join('/'))
    .join('/');

  const params = new URLSearchParams();
  if (options.query) params.set('q', options.query);
  if (options.limit !== undefined) params.set('limit', String(options.limit));
  if (options.expand) params.set('expand', options.expand);
  const queryString = params.toString();

  return `/exchange/discover${path ? `/${path}` : ''}${queryString ? `?${queryString}` : ''}`;
}

/**
 * One-line, per-code hint for the request-level failure codes the API
 * returns from `{ success: false, error, code, chargeId? }` bodies:
 * `duplicate_request` (409), `request_in_flight` (409),
 * `request_unresolved` (503), `unknown_provider` (404),
 * `insufficient_credits` (402), `billing_unavailable` (503),
 * `THIRD_PARTY_DATA_TERMS_REQUIRED` (403).
 */
function exchangeErrorHint(code?: string): string | undefined {
  switch (code) {
    case TERMS_REQUIRED_CODE:
      return 'An organization admin must accept the provider terms in the dashboard or with "firecrawl alexandria terms accept <provider>", then rerun.';
    case 'request_in_flight':
      return 'Retry with the same --request-id once the in-flight request finishes.';
    case 'request_unresolved':
      return 'Keep using this --request-id; do not create a new one until it resolves.';
    case 'duplicate_request':
      return 'Use a new --request-id for a new payload.';
    default:
      return undefined;
  }
}

interface ExchangeErrorDetails {
  message?: string;
  code?: string;
  chargeId?: string;
  requiresAction?: ExchangeRequiresAction;
}

/**
 * Pull `{error, code, chargeId, requiresAction}` off an axios error's response
 * body, when present.
 */
function exchangeErrorDetails(error: unknown): ExchangeErrorDetails {
  const response = (error as any)?.response;
  const body = response?.data;
  if (body && typeof body === 'object') {
    return {
      message: typeof body.error === 'string' ? body.error : undefined,
      code: typeof body.code === 'string' ? body.code : undefined,
      chargeId: typeof body.chargeId === 'string' ? body.chargeId : undefined,
      requiresAction: parseRequiresAction(body.requiresAction),
    };
  }
  return {};
}

/**
 * One line for a request-level failure: the API message, its code, the
 * chargeId when a charge was created, and the per-code hint.
 */
export function formatExchangeFailure(failure: {
  error?: string;
  code?: string;
  chargeId?: string;
}): string {
  const message = failure.error ?? 'Unknown error occurred';
  const parts = [failure.code ? `${message} (${failure.code})` : message];
  if (failure.chargeId) parts.push(`chargeId: ${failure.chargeId}`);
  const hint = exchangeErrorHint(failure.code);
  if (hint) parts.push(hint);
  return parts.join(' — ');
}

/**
 * The SDK's HTTP layer throws an axios error on non-2xx. Prefer the API's own
 * `{error, code}` body (403 not enabled, 402 insufficient credits, 409
 * duplicate request) over "Request failed with status code N".
 */
export function exchangeErrorMessage(error: unknown): string {
  const { message, code, chargeId } = exchangeErrorDetails(error);
  if (message) {
    return formatExchangeFailure({ error: message, code, chargeId });
  }
  const response = (error as any)?.response;
  if (typeof response?.status === 'number') {
    return `Firecrawl request failed (HTTP ${response.status})`;
  }
  return error instanceof Error ? error.message : 'Unknown error occurred';
}

/**
 * Execute exchange discover
 */
export async function executeExchangeDiscover(
  options: ExchangeDiscoverOptions
): Promise<ExchangeDiscoverResult> {
  try {
    assertExchangeKeyed(options.apiKey, options.apiUrl);
    const path = buildDiscoverPath(options);
    const app = getClient({ apiKey: options.apiKey, apiUrl: options.apiUrl });
    const response = await (app as any).http.get(path);
    return {
      success: true,
      data: (response?.data ?? {}) as Record<string, unknown>,
    };
  } catch (error) {
    return { success: false, error: exchangeErrorMessage(error) };
  }
}

/**
 * Execute exchange retrieve through the url-less /v2/scrape shape
 */
export async function executeExchangeRetrieve(
  options: ExchangeRetrieveOptions
): Promise<ExchangeRetrieveResult> {
  const requestId = options.requestId ?? randomUUID();
  try {
    if (!/^[A-Za-z0-9._:-]{1,128}$/.test(requestId))
      throw new Error(
        'Invalid --request-id. Use 1–128 letters, digits, dots, underscores, colons or hyphens.'
      );
    assertExchangeKeyed(options.apiKey, options.apiUrl);
    if (!options.calls || options.calls.length === 0) {
      throw new Error('At least one provider/capability address is required.');
    }
    if (options.calls.length > MAX_EXCHANGE_CALLS) {
      throw new Error(
        `Exchange accepts at most ${MAX_EXCHANGE_CALLS} capabilities per request (got ${options.calls.length}).`
      );
    }

    const body: Record<string, unknown> = {
      alexandria: options.calls,
      integration: 'cli',
    };
    if (options.timeout !== undefined) {
      body.timeout = options.timeout;
    }

    const app = getClient({ apiKey: options.apiKey, apiUrl: options.apiUrl });
    const response = await (app as any).http.post('/v2/scrape', body, {
      headers: { 'x-request-id': requestId },
    });
    const envelope = (response?.data ?? {}) as ExchangeScrapeResponse;

    if (envelope.success === false) {
      throw new Error(envelope.error || 'Exchange request failed');
    }

    return {
      success: true,
      scrapeId: envelope.scrape_id,
      requestId,
      exchange: envelope.data?.alexandria ?? [],
      creditsCost: envelope.data?.creditsCost,
    };
  } catch (error) {
    const { message, code, chargeId, requiresAction } =
      exchangeErrorDetails(error);
    return {
      success: false,
      requestId,
      error: message ?? exchangeErrorMessage(error),
      code,
      chargeId,
      requiresAction,
    };
  }
}

function isFailure(item: ExchangeScrapeResult): item is ExchangeScrapeFailure {
  return (
    typeof (item as ExchangeScrapeFailure).error === 'object' &&
    (item as ExchangeScrapeFailure).error !== null
  );
}

function indent(text: string, prefix: string = '  '): string {
  return text
    .split('\n')
    .map((line) => `${prefix}${line}`)
    .join('\n');
}

function stringifyValue(value: unknown): string {
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2) ?? String(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function formatRetrieveReadable(result: ExchangeRetrieveResult): string {
  const lines: string[] = [];
  for (const item of result.exchange ?? []) {
    const address = `${item.provider ?? '?'}/${item.capability ?? '?'}`;
    lines.push(address);
    if (isFailure(item)) {
      const status =
        item.error.status !== undefined ? ` (HTTP ${item.error.status})` : '';
      lines.push(
        `  Error [${item.error.code}]: ${item.error.message}${status}`
      );
      lines.push('');
      continue;
    }
    lines.push(`  Credits cost: ${item.creditsCost}`);
    if (item.records !== undefined) lines.push(`  Records: ${item.records}`);
    if (item.upstreamStatus !== undefined) {
      lines.push(`  Upstream status: ${item.upstreamStatus}`);
    }
    if (item.recordedAt) lines.push(`  Recorded at: ${item.recordedAt}`);
    lines.push('  --- Data ---');
    lines.push(indent(stringifyValue(item.data)));
    lines.push('  --- End Data ---');
    lines.push('');
  }
  if (result.creditsCost !== undefined) {
    lines.push(`Total credits cost: ${result.creditsCost}`);
  }
  return lines.join('\n');
}

function formatCapabilityLine(
  provider: string | undefined,
  capability: Record<string, unknown>
): string[] {
  const address = str(capability.address) ?? str(capability.capability) ?? '?';
  const owner = str(capability.provider) ?? provider;
  const cost =
    capability.creditsCost !== undefined
      ? `  (${capability.creditsCost} credits)`
      : '';
  const lines = [`${owner ? `${owner}/` : ''}${address}${cost}`];
  const label = str(capability.label);
  if (label) lines.push(`  ${label}`);
  const whenToUse = str(capability.whenToUse);
  if (whenToUse) lines.push(`  When to use: ${whenToUse}`);
  return lines;
}

function formatConcepts(
  provider: string | undefined,
  concepts: unknown[]
): string[] {
  const lines: string[] = [];
  for (const concept of concepts) {
    if (!isRecord(concept)) continue;
    const name = str(concept.name) ?? str(concept.id) ?? 'concept';
    lines.push(`## ${name}`);
    const about = str(concept.about);
    if (about) lines.push(about);
    for (const capability of asArray(concept.capabilities)) {
      if (typeof capability === 'string') {
        lines.push(`${provider ? `${provider}/` : ''}${capability}`);
      } else if (isRecord(capability)) {
        lines.push(...formatCapabilityLine(provider, capability));
      }
    }
    lines.push('');
  }
  return lines;
}

function formatProviderSummary(entry: Record<string, unknown>): string[] {
  const slug = str(entry.provider) ?? '?';
  const name = str(entry.name);
  const count =
    typeof entry.capabilities === 'number'
      ? ` (${entry.capabilities} capabilities)`
      : '';
  const lines = [`${slug}${name ? ` - ${name}` : ''}${count}`];
  const description = str(entry.description);
  if (description) lines.push(`  ${description}`);
  const cohorts = asArray(entry.cohorts);
  if (cohorts.length > 0) lines.push(`  Cohorts: ${cohorts.join(', ')}`);
  if (entry.executable === false) {
    const reason = str(entry.reason);
    lines.push(`  Not executable${reason ? `: ${reason}` : ''}`);
  }
  const concepts = asArray(entry.concepts);
  if (concepts.length > 0) {
    lines.push('');
    lines.push(...formatConcepts(slug, concepts).map((line) => `  ${line}`));
  }
  lines.push('');
  return lines;
}

function formatDiscoverReadable(data: Record<string, unknown>): string {
  const lines: string[] = [];

  if (Array.isArray(data.capabilities) && str(data.query)) {
    lines.push(`=== Capabilities matching "${data.query}" ===`);
    lines.push('');
    for (const hit of data.capabilities) {
      if (!isRecord(hit)) continue;
      lines.push(...formatCapabilityLine(undefined, hit));
      const concept = str(hit.concept);
      if (concept) lines.push(`  Concept: ${concept}`);
      const cohorts = asArray(hit.cohorts);
      if (cohorts.length > 0) lines.push(`  Cohorts: ${cohorts.join(', ')}`);
      if (typeof hit.similarity === 'number') {
        lines.push(`  Similarity: ${hit.similarity}`);
      }
      lines.push('');
    }
    if (data.capabilities.length === 0) {
      lines.push('No capabilities matched.');
      lines.push('');
    }
    if (data.searched !== undefined) {
      lines.push(
        `Searched ${data.searched} capabilities${str(data.source) ? ` (${data.source})` : ''}.`
      );
    }
    return lines.join('\n');
  }

  if (Array.isArray(data.cohorts)) {
    lines.push('=== Cohorts ===');
    lines.push('');
    for (const cohort of data.cohorts) {
      if (!isRecord(cohort)) continue;
      const providers = cohort.providers;
      const count =
        typeof providers === 'number'
          ? ` (${providers} providers)`
          : Array.isArray(providers)
            ? ` (${providers.length} providers)`
            : '';
      lines.push(`${str(cohort.cohort) ?? '?'}${count}`);
      const about = str(cohort.about);
      if (about) lines.push(`  ${about}`);
      if (Array.isArray(providers)) {
        for (const entry of providers) {
          if (!isRecord(entry)) continue;
          lines.push(
            ...formatProviderSummary(entry).map((line) =>
              line ? `  ${line}` : line
            )
          );
        }
      }
      lines.push('');
    }
    lines.push('Next: firecrawl exchange discover <cohort>');
    return lines.join('\n');
  }

  if (Array.isArray(data.providers) && str(data.cohort)) {
    lines.push(`=== Providers in ${data.cohort} ===`);
    lines.push('');
    for (const entry of data.providers) {
      if (isRecord(entry)) lines.push(...formatProviderSummary(entry));
    }
    lines.push(`Next: firecrawl exchange discover ${data.cohort} <provider>`);
    return lines.join('\n');
  }

  if (Array.isArray(data.concepts) && str(data.provider)) {
    const slug = data.provider as string;
    const name = str(data.name);
    lines.push(`=== ${name ? `${name} (${slug})` : slug} ===`);
    const description = str(data.description);
    if (description) lines.push(description);
    const website = str(data.website);
    if (website) lines.push(`Website: ${website}`);
    lines.push('');
    lines.push(...formatConcepts(slug, data.concepts));
    lines.push(
      `Next: firecrawl exchange discover <cohort> ${slug} <capability address>`
    );
    return lines.join('\n');
  }

  if (str(data.capability) && str(data.provider)) {
    const address = `${data.provider}/${data.capability}`;
    lines.push(`=== ${address} ===`);
    const label = str(data.label);
    if (label) lines.push(label);
    if (data.creditsCost !== undefined) {
      lines.push(`Credits cost: ${data.creditsCost}`);
    }
    if (data.executable === false) {
      const reason = str(data.reason);
      lines.push(`Not executable${reason ? `: ${reason}` : ''}`);
    }
    const whenToUse = str(data.whenToUse);
    if (whenToUse) lines.push(`When to use: ${whenToUse}`);
    lines.push('');
    const options = asArray(data.options);
    lines.push('Options:');
    if (options.length === 0) lines.push('  (none)');
    for (const option of options) {
      if (!isRecord(option)) continue;
      const { name, description, about, ...rest } = option;
      const details = Object.entries(rest)
        .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
        .join(', ');
      lines.push(`  ${str(name) ?? '?'}${details ? ` (${details})` : ''}`);
      const summary = str(description) ?? str(about);
      if (summary) lines.push(`    ${summary}`);
    }
    const requiresOneOf = asArray(data.requiresOneOf);
    if (requiresOneOf.length > 0) {
      lines.push(`Requires one of: ${requiresOneOf.join(', ')}`);
    }
    if (data.returns !== undefined) {
      lines.push('');
      lines.push('Returns:');
      lines.push(indent(stringifyValue(data.returns)));
    }
    lines.push('');
    const example = isRecord(data.example) ? data.example : undefined;
    const exampleOptions =
      example && isRecord(example.options) ? example.options : example;
    lines.push(
      `Retrieve: firecrawl exchange retrieve ${address}${
        exampleOptions
          ? ` --options '${JSON.stringify(exampleOptions)}'`
          : " --options '<json>'"
      }`
    );
    return lines.join('\n');
  }

  return JSON.stringify(data, null, 2);
}

function stringifyJson(payload: unknown, pretty?: boolean): string {
  return pretty ? JSON.stringify(payload, null, 2) : JSON.stringify(payload);
}

export function writeExchangeOutput(
  jsonPayload: unknown,
  readable: string,
  options: { output?: string; json?: boolean; pretty?: boolean }
): void {
  const content =
    options.json || options.pretty
      ? stringifyJson(jsonPayload, options.pretty)
      : readable;
  writeOutput(content, options.output, !!options.output);
}

/**
 * Request-level failure: `--json` gets a `{success:false, ...}` envelope on
 * stdout; human mode gets the terms block or a one-line error on stderr.
 */
function reportExchangeFailure(
  result: ExchangeRetrieveResult,
  options: { json?: boolean; pretty?: boolean }
): void {
  if (options.json || options.pretty) {
    writeOutput(
      stringifyJson(
        {
          success: false,
          requestId: result.requestId,
          code: result.code,
          error: result.error,
          requiresAction: result.requiresAction,
        },
        options.pretty
      )
    );
  } else if (result.requiresAction) {
    process.stderr.write(formatTermsRequired(result.requiresAction));
  } else {
    console.error('Error:', formatExchangeFailure(result));
  }
}

/**
 * Handle exchange discover command output
 */
export async function handleExchangeDiscoverCommand(
  options: ExchangeDiscoverOptions
): Promise<void> {
  const result = await executeExchangeDiscover(options);

  if (!result.success || !result.data) {
    console.error('Error:', result.error ?? 'Unknown error occurred');
    process.exit(1);
  }

  writeExchangeOutput(
    result.data,
    formatDiscoverReadable(result.data),
    options
  );
}

/**
 * Handle exchange retrieve command output. A provider error inside the batch
 * does not fail the request; the exit code is 1 only when every item failed.
 */
export async function handleExchangeRetrieveCommand(
  options: ExchangeRetrieveOptions
): Promise<void> {
  const result = await executeExchangeRetrieve(options);
  if (result.requestId)
    process.stderr.write(`Request ID: ${result.requestId}\n`);

  if (!result.success) {
    reportExchangeFailure(result, options);
    if (result.requestId)
      process.stderr.write(
        `If retrying the identical payload, reuse --request-id ${result.requestId}. Do not replace the ID for pending or uncertain execution.\n`
      );
    process.exit(1);
  }

  if (result.scrapeId) {
    process.stderr.write(`Scrape ID: ${result.scrapeId}\n`);
  }

  const jsonPayload: Record<string, unknown> = {
    success: true,
    requestId: result.requestId,
    data: {
      alexandria: result.exchange ?? [],
      creditsCost: result.creditsCost,
    },
  };
  if (result.scrapeId) {
    jsonPayload.scrape_id = result.scrapeId;
  }

  writeExchangeOutput(jsonPayload, formatRetrieveReadable(result), options);

  const items = result.exchange ?? [];
  if (items.length > 0 && items.every(isFailure)) {
    process.exit(1);
  }
}
