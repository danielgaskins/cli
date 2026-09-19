---
name: firecrawl-alexandria
description: Discover and execute Alexandria provider tools with the Firecrawl beta CLI. Use for structured provider data, progressive tool discovery, or remote Bash inspection of large retained workflow and scrape results.
allowed-tools:
  - Bash(npx firecrawl-cli@alexandria *)
---

# Alexandria beta

Use `npx firecrawl-cli@alexandria` explicitly; do not replace the user's stable CLI. Use existing login credentials or `FIRECRAWL_API_KEY`. Never print credentials or call Exchange directly.

## Search naturally, inspect selectively, execute through scrape

Start with the user's actual question, preserving location, dates, marketplace and constraints. Default search returns web results plus semantic and domain-matched tools. A tool match is discovery, not fetched provider data. Use useful web results directly; select a tool only when its coverage and inputs fit.

```bash
npx firecrawl-cli@alexandria search 'pizza hut'
npx firecrawl-cli@alexandria search alexandria 'pizza hut'
npx firecrawl-cli@alexandria list
npx firecrawl-cli@alexandria list restaurants --category
npx firecrawl-cli@alexandria list pizzahut-com
npx firecrawl-cli@alexandria list pizzahut-com restaurants/store --pretty
npx firecrawl-cli@alexandria scrape pizzahut-com/restaurants/store --options '{"store_number":"<returned-store-number>"}'
```

- Default search includes web, semantic tools and domain matches. `search alexandria` selects semantic tools only. `--sources web` opts out; `--sources web --domain-tools` retains domain matching.
- Inspect `data.web` and `data.tools` in search JSON. If a full contract is already present, use it without another discovery call. Otherwise, `list <provider> <capability> --pretty` expands only that contract. Use exact returned IDs and required fields; resolve identifiers through appropriate lookup tools instead of inventing them.
- Follow catalogue pagination only when needed. Do not expand every contract or example. Use `find-tools <url>` for tools associated with a known website; it does not scrape or execute them.
- Execute with `scrape <provider/capability> --options '<JSON>'`; explicit `--alexandria` still works. Tool errors never imply fallback to URL scraping. Plain URL scrape does not execute provider tools, and `search --scrape` fetches web content only.
- Read each `data.alexandria[]` result and its error, not just outer `success`. Access requirements matter; displayed pricing is informational and is not an extra confirmation gate.
- If coverage does not fit, continue with ordinary web results or URL scraping rather than probing adjacent tools.

## Large output and context recovery

For known large datasets or PDFs, plan bounded reading before execution. With a local filesystem, `--json -o <file>` avoids dumping the result into context. Where remote processing is preferable, `scrape firecrawl/bash` can inspect retained results using `jq`, `head`, `sed`, and other supported commands.

If the harness reports a context/output error, the provider may already have succeeded. Preserve the returned request/scrape ID and recover that result before rerunning the provider. Read [remote Bash recovery](references/large-results.md) for ID selection, commands, output/error fields, workspace reuse and expiry.

Bash recovery is explicit, not automatic overflow detection. A harness may reject output before the agent sees a hint. Search IDs and all provider payloads are not universally supported. Do not assume a missing ID or stdout means an empty successful result.

**Done when:** the selected source answered the task, per-call errors were checked, and only the relevant data was brought into context. Preserve source links and disclose partial coverage.
