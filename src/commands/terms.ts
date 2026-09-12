/**
 * `firecrawl alexandria terms <provider>` shows a provider's terms document
 * from GET /exchange/provider-terms; `firecrawl alexandria terms accept
 * <provider>` shows it, asks the user to type the provider slug, and posts the
 * acceptance to the dashboard. Acceptance is interactive only.
 */

import type {
  ExchangeProviderTerms,
  ExchangeTermsOptions,
} from '../types/exchange';
import { getClient } from '../utils/client';
import { getApiKey, getDashboardUrl } from '../utils/config';
import { writeOutput } from '../utils/output';
import {
  assertExchangeKeyed,
  exchangeErrorMessage,
  writeExchangeOutput,
} from './exchange';

async function fetchProviderTerms(
  options: ExchangeTermsOptions
): Promise<ExchangeProviderTerms> {
  assertExchangeKeyed(options.apiKey, options.apiUrl);
  const app = getClient({ apiKey: options.apiKey, apiUrl: options.apiUrl });
  const response = await (app as any).http.get(
    '/exchange/provider-terms?surface=web'
  );
  const providers: ExchangeProviderTerms[] = Array.isArray(
    response?.data?.providers
  )
    ? response.data.providers
    : [];
  const entry = providers.find((p) => p.provider === options.provider);
  if (!entry) {
    throw new Error(
      `Unknown Alexandria provider "${options.provider}". List providers with "firecrawl alexandria discover".`
    );
  }
  return entry;
}

function formatTermsReadable(entry: ExchangeProviderTerms): string {
  const terms = entry.terms!;
  const lines = [
    `${entry.name ?? entry.provider} (${entry.provider}) Alexandria provider terms`,
  ];
  if (terms.publisher) lines.push(`Publisher: ${terms.publisher}`);
  lines.push(`Version: ${terms.version}`);
  if (terms.effective) lines.push(`Effective: ${terms.effective}`);
  lines.push('', terms.document.trimEnd(), '');
  return lines.join('\n');
}

function dashboardTermsUrl(provider: string): string {
  return `${getDashboardUrl()}/app/alexandria/${encodeURIComponent(provider)}`;
}

/**
 * Show a provider's terms. Exits 0 with a note when the provider has none.
 */
export async function handleExchangeTermsCommand(
  options: ExchangeTermsOptions
): Promise<void> {
  let entry: ExchangeProviderTerms;
  try {
    entry = await fetchProviderTerms(options);
  } catch (error) {
    console.error('Error:', exchangeErrorMessage(error));
    process.exit(1);
  }
  if (!entry.terms) {
    process.stderr.write(
      `${entry.provider} has no provider terms to accept.\n`
    );
    return;
  }
  writeExchangeOutput(entry, formatTermsReadable(entry), options);
}

async function postAcceptance(
  provider: string,
  version: string,
  apiKey: string
): Promise<{ status: number; body: Record<string, any> }> {
  const response = await fetch(
    `${getDashboardUrl()}/api/exchange/provider-access/accept`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ provider, version, confirmed: true }),
    }
  );
  const body = await response.json().catch(() => ({}));
  return { status: response.status, body: body ?? {} };
}

function acceptFailureMessage(
  provider: string,
  status: number,
  body: Record<string, any>
): string {
  switch (status) {
    case 401:
      return 'The dashboard rejected this API key. Check FIRECRAWL_API_KEY or run "firecrawl login".';
    case 403:
      return `Only a team admin's own API key can accept provider terms. Ask an organization admin to accept at ${dashboardTermsUrl(provider)}.`;
    case 404:
      return `The dashboard does not know the provider "${provider}".`;
    case 409:
      return `The ${provider} terms changed${
        typeof body.version === 'string'
          ? ` (current version ${body.version})`
          : ''
      } since they were displayed. Nothing was accepted; rerun "firecrawl alexandria terms accept ${provider}" to review the current version.`;
    default:
      return typeof body.error === 'string'
        ? body.error
        : `Accepting provider terms failed (HTTP ${status})`;
  }
}

/**
 * Interactive acceptance: refuse without a TTY, show the document, require
 * the provider slug typed back, then post the displayed version.
 */
export async function handleExchangeTermsAcceptCommand(
  options: ExchangeTermsOptions
): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error(
      `Error: Accepting provider terms needs an interactive terminal. Accept in the dashboard at ${dashboardTermsUrl(options.provider)} instead.`
    );
    process.exit(2);
  }

  let entry: ExchangeProviderTerms;
  try {
    entry = await fetchProviderTerms(options);
  } catch (error) {
    console.error('Error:', exchangeErrorMessage(error));
    process.exit(1);
  }
  if (!entry.terms) {
    process.stderr.write(
      `${entry.provider} has no provider terms to accept.\n`
    );
    return;
  }
  const { provider } = entry;
  const { version } = entry.terms;
  writeOutput(formatTermsReadable(entry));

  const { input } = await import('@inquirer/prompts');
  const typed = await input({
    message: `Accept ${provider} terms version ${version} for your organization? Type "${provider}" to confirm:`,
  });
  if (typed.trim() !== provider) {
    console.error('Error: Confirmation did not match. Nothing was accepted.');
    process.exit(1);
  }

  const apiKey = getApiKey(options.apiKey);
  if (!apiKey) {
    console.error(
      'Error: An API key is required to accept provider terms. Set FIRECRAWL_API_KEY or run "firecrawl login".'
    );
    process.exit(1);
  }

  let outcome: Awaited<ReturnType<typeof postAcceptance>>;
  try {
    outcome = await postAcceptance(provider, version, apiKey);
  } catch (error) {
    console.error(
      'Error:',
      error instanceof Error ? error.message : 'Unknown error occurred'
    );
    process.exit(1);
  }
  if (outcome.status !== 200 || outcome.body.success !== true) {
    console.error(
      'Error:',
      acceptFailureMessage(provider, outcome.status, outcome.body)
    );
    process.exit(1);
  }
  process.stderr.write(
    `Accepted ${provider} provider terms version ${outcome.body.version ?? version}${
      typeof outcome.body.digest === 'string'
        ? ` (digest ${outcome.body.digest})`
        : ''
    }. Rerun the request with the same --request-id.\n`
  );
}
