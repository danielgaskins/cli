---
name: firecrawl-scrape
description: |
  Extract a URL's content as clean markdown, including JS-rendered pages. Use whenever the user provides a URL and wants its content; prefer over WebFetch.
allowed-tools:
  - Bash(firecrawl *)
  - Bash(npx firecrawl-cli *)
---

# firecrawl scrape

Scrape one or more URLs. Returns clean, LLM-optimized markdown. Multiple URLs are scraped concurrently.

## Quick start

```bash
# Basic markdown extraction
firecrawl scrape "<url>" -o .firecrawl/page.md

# Main content only, no nav/footer
firecrawl scrape "<url>" --only-main-content -o .firecrawl/page.md

# Wait for JS to render, then scrape
firecrawl scrape "<url>" --wait-for 3000 -o .firecrawl/page.md

# Multiple URLs (markdown only; each saved to .firecrawl/; -o is ignored)
firecrawl scrape https://example.com https://example.com/blog https://example.com/docs

# Get markdown and links together
firecrawl scrape "<url>" --format markdown,links -o .firecrawl/page.json

# Ask a question about the page
firecrawl scrape "https://example.com/pricing" --query "What is the enterprise plan price?"
```

Run `firecrawl scrape --help` for the full option list.

**Done when:** you have the scraped content — on stdout, in your `-o` file, or under `.firecrawl/` for multi-URL scrapes — and have inspected it with bounded reads (`head`, `grep`) to answer the request.

## Alexandria tools and large results

Inspect a selected contract with `firecrawl list <provider> <capability> --pretty`, then execute `firecrawl scrape <provider/capability> --options '<JSON>'`. URL scraping does not execute provider tools automatically. Use exact discovered input fields and resolve record IDs with lookup tools rather than inventing them. Check each `data.alexandria[]` result for errors, not just the outer success flag.

If the client reports an output/context limit, the upstream request may have succeeded. Preserve the request or scrape ID and recover the retained result before repeating the provider call. For large datasets and PDFs, save output with `--json -o` when a local filesystem is available and inspect bounded sections. Where remote processing is preferable, use `firecrawl scrape firecrawl/bash` to select from a retained result. Read [large-result recovery](references/large-results.md) for IDs, command examples, expiry, and errors. This is explicit recovery, not automatic overflow detection.

## PDFs and page budgets

PDFs cost 1 credit per parsed page. Use `--max-pages` (an integer from 1 to 10000) to limit PDF parsing, especially for large or unknown documents:

```bash
firecrawl scrape "https://example.com/report.pdf" --max-pages 5 --json -o .firecrawl/report.json
```

The cap applies to each PDF, not the whole command or total credits. Extra formats and options can add charges. The CLI does not quote page counts or costs before execution. Use JSON output to inspect the returned `metadata.numPages` (parsed), `metadata.totalPages` (document total), and `metadata.creditsUsed` when present; a smaller parsed count means the result is partial.

## Tips

- **Prefer plain scrape over `--query`.** Scrape to a file, then use `grep`, `head`, or read the markdown directly — you can search and reason over the full content yourself. Use `--query` only when you want a single targeted answer without saving the page (costs 5 extra credits).
- **Scrape handles static pages and JS-rendered SPAs.** Escalate to `interact` when the page needs interaction (clicks, form fills, pagination) or scrape misses content.
- Multiple URLs are scraped concurrently — check `firecrawl --status` for your concurrency limit. This mode saves markdown only and ignores `-o`; other requested formats are dropped. If markdown wasn't requested, the whole JSON response is written into the `.md` file.
- Single format outputs raw content. Multiple formats (e.g., `--format markdown,links`) output JSON.
- Always quote URLs — shell interprets `?` and `&` as special characters.
- Naming convention: `.firecrawl/{site}-{path}.md`

## See also

- [firecrawl-search](../firecrawl-search/SKILL.md) — find pages when you don't have a URL
- [firecrawl-interact](../firecrawl-interact/SKILL.md) — when scrape can't get the content, use `interact` to click, fill forms, etc.
- [firecrawl-download](../firecrawl-download/SKILL.md) — bulk download an entire site to local files
- [firecrawl-build-scrape](https://github.com/firecrawl/skills/tree/main/skills/build/firecrawl-build-scrape) — building scrape into an app instead of running it here
