/**
 * Provider-terms helpers shared by exchange retrieve, scrape --alexandria and
 * plain scrape: parse the API's `requiresAction` payload and render the
 * human-mode block for THIRD_PARTY_DATA_TERMS_REQUIRED.
 */

import type { ExchangeRequiresAction } from '../types/exchange';

export const TERMS_REQUIRED_CODE = 'THIRD_PARTY_DATA_TERMS_REQUIRED';

/**
 * Accept only a well-formed `accept_terms` action; anything else is dropped so
 * a malformed body degrades to the plain error message.
 */
export function parseRequiresAction(
  value: unknown
): ExchangeRequiresAction | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const { type, terms, version, url } = value as Record<string, unknown>;
  if (
    type !== 'accept_terms' ||
    typeof terms !== 'string' ||
    typeof version !== 'string' ||
    typeof url !== 'string'
  ) {
    return undefined;
  }
  return { type, terms, version, url };
}

export function formatTermsRequired(action: ExchangeRequiresAction): string {
  return [
    'Alexandria provider terms required',
    `  Provider:   ${action.terms}`,
    `  Version:    ${action.version}`,
    `  Accept at:  ${action.url}`,
    `An organization admin accepts in the dashboard or with \`firecrawl alexandria terms accept ${action.terms}\`.`,
    'No credits were charged.',
    '',
  ].join('\n');
}
