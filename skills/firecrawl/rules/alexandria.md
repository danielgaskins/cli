# Alexandria: discover a tool, read its contract, get its data

Use Alexandria when the task needs a provider's structured data. These commands require a CLI and API deployment with Alexandria support and an authenticated team with access. Check `firecrawl find-tools --help` for the installed command surface.

## Choose the discovery request

- **Describe the data needed:** `firecrawl search "your intent" --sources alexandria --limit 2 --json`. Add `web` to the sources to also retrieve web results. Search requires a query.
- **Match tools to result domains:** add `--skills` to Search. This is optional and can add lookup latency. Semantic and contextual matches share `data.tools`.
- **Already have a URL or provider:** use `find-tools`, without a search query. It looks up the catalogue; it does not fetch the supplied page or execute the tools it finds.

Inspect a Search tool's `provider`, `capability`, `options`, `requiresOneOf`, `response`, `examples`, `creditsCost`, and `perRecord`. `matchedBy` and `matchedUrls` explain why it appeared. A discovery `warning` means lookup was unavailable, rather than proving no tools match. A zero-result CLI search may leave no new output file; do not read a stale file from a previous run.

## Reveal only the detail needed

```bash
# Start with a provider; lookup depth is inferred
firecrawl find-tools --providers particle --limit 2 --json \
  -o .firecrawl/find-tools.json

# Or start from a page returned by search or scrape
firecrawl find-tools "https://podcasts.apple.com" --limit 2 --json \
  -o .firecrawl/page-tools.json

# Read the inputs, response, and examples for a known capability
firecrawl find-tools --providers particle \
  --capabilities podcasts/episodes/search \
  --expand options,response,examples --limit 2 --json \
  -o .firecrawl/episode-contract.json
```

Find Tools returns its catalogue page inside `data.alexandria[0].data`:

```bash
jq '.data.alexandria[0].data | {level, items, next}' .firecrawl/find-tools.json
```

Follow the selected item's `next` to reveal more detail. Follow the catalogue page's top-level `next` for another page. Pass the complete returned request unchanged:

```bash
firecrawl find-tools --request '<next request JSON>' --json \
  -o .firecrawl/find-tools-next.json
```

`--request` cannot be combined with URLs or lookup filters. Provider, category, group, and capability selectors are optional; add only those needed to narrow the lookup. If necessary, `--level providers|groups|tools` overrides the inferred depth. Reuse contracts already present in Search results instead of fetching them again.

## Execute the selected capability

Use the inputs from the current contract. For Particle episode search, `keyword_search` supplies the exact words to find:

```bash
firecrawl scrape --alexandria particle/podcasts/episodes/search \
  --options '{"keyword_search":"AI agents","limit":2}' \
  --json -o .firecrawl/episodes.json
```

Inspect `data.alexandria` for provider results and per-item errors; an overall successful response can contain a failed item. `data.creditsCost` is the total charge. Tool discovery and Find Tools are free. Web search retains its own cost, and executing a selected provider uses its published price, including per-record pricing where specified. Browsing a contract does not accept provider terms or execute the provider.

The CLI generates a request ID and prints it on stderr, including on failure; successful JSON output also includes `requestId`. Retry an identical payload with `--request-id <same-id>`. If execution is pending or uncertain, report that state rather than creating a new ID to trigger another execution. Credit and provider-terms rejections must be resolved before execution can proceed.

## Provider terms (THIRD_PARTY_DATA_TERMS_REQUIRED)

Paid providers need an organization admin to accept their terms once. Until then, `--json` execution writes `{"success":false,"code":"THIRD_PARTY_DATA_TERMS_REQUIRED","requiresAction":{"type":"accept_terms","terms":"<provider>","version":"...","url":"..."}}` to stdout and exits 1; no credits are charged. When this happens, show the user `requiresAction.url` and stop. Do not retry, and do not try to accept: acceptance is a legal act by a human. A human admin accepts in the dashboard at that URL, or reads and accepts from their own terminal with `firecrawl alexandria terms <provider>` and `firecrawl alexandria terms accept <provider>` (interactive only, needs the admin's own API key). Once they confirm, rerun the identical command with the same `--request-id`.
