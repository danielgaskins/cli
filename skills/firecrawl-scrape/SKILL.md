---
name: firecrawl-scrape
description: |
  Extract a URL's content as clean markdown, including JS-rendered pages, or execute a known Alexandria data-provider capability. Use when the user supplies a page URL or has selected a provider tool and wants its data.
allowed-tools:
  - Bash(firecrawl *)
  - Bash(npx firecrawl-cli *)
---

# firecrawl scrape

Scrape one or more URLs, or execute a selected Alexandria capability with `--alexandria`. Page scraping returns content; Alexandria execution returns structured provider results.

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

## Alexandria provider execution

Use `firecrawl scrape --alexandria <provider>/<capability> --options '<JSON>'` after reading the tool's contract. This is a URL-less request; do not combine it with page URLs or page-scraping options. Inspect each result in `data.alexandria`, including per-item errors and `data.creditsCost` for the total charge.

Keep the returned request ID. An identical retry uses `--request-id <same-id>`; a pending or uncertain execution must not be retried under a fresh ID. See the [Alexandria workflow](../firecrawl/rules/alexandria.md) for discovery, required inputs, and a complete example.

**Done when:** you have inspected the page content or provider results with bounded reads and used them to answer the request. Report per-item provider failures instead of treating the outer response as proof of success.

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
