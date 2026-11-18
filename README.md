# Stealth Siphon

A web scraping toolkit for people **and AI agents**. It returns clean, token-efficient Markdown, extracts structured data, crawls sites within set limits, drives a real headless Chrome for logins and multi-step flows, and watches pages for changes. You can use it four ways: an **MCP server**, a **REST API**, a **CLI**, or the original **web UI**.

![Stealth Siphon Screenshot](image/base.png)

## Created by Christopher Bradford

## Quick start

```bash
npm install          # uses your installed Google Chrome; no browser download
npm start            # web UI + REST API + MCP at http://127.0.0.1:4200
npm test             # 46 tests (browser tests run when Chrome is found)
```

### Use it from Claude Code (or any MCP client)

```bash
# stdio (simplest)
claude mcp add stealthsiphon -- node /path/to/stealthsiphon/bin/mcp.js

# or point at a running server (Streamable HTTP)
claude mcp add --transport http stealthsiphon http://127.0.0.1:4200/mcp
```

For any client that reads an MCP JSON config (Claude Desktop, LocalClaw, ...):

```json
{
  "mcpServers": {
    "stealthsiphon": { "command": "node", "args": ["/path/to/stealthsiphon/bin/mcp.js"] }
  }
}
```

## MCP tools

| Tool | What it does |
|---|---|
| `fetch_page` | URL → Markdown (main content), text, HTML, or raw. Automatically renders JS-heavy pages in Chrome. Paged with `maxChars`/`offset`. |
| `get_links` | Links with anchor text, filtered by internal/external or a substring |
| `extract` | Structured JSON, from CSS `fields` (with `list` for repeated items) or from a JSON `schema` filled by a local Ollama model |
| `screenshot` | Returns an image of the viewport, full page, or a single element |
| `crawl` | Crawls a site within `maxPages`/`maxDepth`, with include/exclude globs and sitemap seeding. Returns a compact per-page summary. |
| `crawl_status` / `get_crawl_page` / `cancel_crawl` | Check a crawl, read one stored page (paged), or stop it |
| `browser_open` | Opens a persistent, isolated Chrome session and returns a snapshot with element refs |
| `browser_navigate` / `browser_click` / `browser_type` / `browser_select` / `browser_press` / `browser_scroll` / `browser_wait` | Drive the session. Target elements by `ref` from the snapshot, a CSS `selector`, or visible `text`. |
| `browser_snapshot` / `browser_read` / `browser_screenshot` / `browser_evaluate` / `browser_close` | Inspect, read as Markdown, capture, run JS, or close the session |
| `watch_page` | Schedules re-fetches of a page and records a diff whenever it changes, with an optional webhook. Accepts presets like `hourly`, `daily`, or cron. |
| `get_changes` / `list_tasks` / `run_task` / `delete_task` | Read diffs and manage scheduled tasks |

Design choices made for agents:

- **Token budget:** Markdown is limited to the main content (Readability) with link titles, decorative images, and wiki infobox/navbox chrome removed. Every text tool is paged (default 20k chars), and crawl results are summaries; you pull full pages on demand.
- **Prompt-injection hygiene:** Web content is wrapped in `<untrusted_web_content>` tags that pages cannot close early, and the server's instructions tell the model to treat it as data.
- **Stable errors:** Errors come back as `isError` results with codes such as `ROBOTS_DISALLOWED`, `BLOCKED_URL`, `TIMEOUT`, `BROWSER_UNAVAILABLE`, `NOT_FOUND`, plus a hint.
- **Cheap repeats:** A 5-minute page cache makes "read, then extract" a single network fetch.

## CLI

```bash
node bin/siphon.js fetch https://example.com                     # Markdown to stdout
node bin/siphon.js fetch https://example.com --format text --max-chars 2000 --offset 2000
node bin/siphon.js fetch https://spa.example --mode browser --scroll --json
node bin/siphon.js links https://news.ycombinator.com --filter external
node bin/siphon.js extract https://quotes.toscrape.com --list .quote \
     --fields '{"text":".text","author":".author","tags":{"selector":".tag","all":true}}'
node bin/siphon.js extract https://example.com/product --schema '{"type":"object","properties":{"price":{"type":"number"}}}'
node bin/siphon.js screenshot https://example.com -o shot.png --full-page
node bin/siphon.js crawl https://docs.example.com --max-pages 50 --include "/docs/**" --exclude "**/changelog*"
```

The global flag `--no-robots` ignores robots.txt (use only with permission). After `npm link`, the CLI is available as `siphon`.

## REST API

Every `/api` response is JSON. Errors look like `{ "ok": false, "error": { "code", "message" } }`.

| Method & path | Body / query |
|---|---|
| `GET /api/health` | Browser availability, cache stats, settings |
| `POST /api/fetch` (or `GET ?url=`) | `{url, format, mode, mainContent, selector, maxChars, offset, includeMetadata, includeLinks, waitForSelector, scroll, respectRobots, useCache}` |
| `POST /api/extract` | `{url \| html, fields, list, limit}` or `{url, schema, instructions, model}` |
| `POST /api/links` | `{url, filter, maxLinks}` |
| `POST /api/screenshot` | `{url, fullPage, selector, type, width, height}`; returns base64, or the raw image with `?raw=1` |
| `POST /api/crawl` · `GET /api/crawl/:id` · `GET /api/crawl/:id/page?url=` · `POST /api/crawl/:id/cancel` | The crawl runs asynchronously; poll its status |
| `POST /api/sessions` · `POST /api/sessions/:id/{navigate,click,type,select,press,scroll,wait,snapshot,markdown,html,screenshot,evaluate}` · `DELETE /api/sessions/:id` | Browser sessions |
| `GET/POST /api/tasks` · `GET/PUT/DELETE /api/tasks/:id` · `POST /api/tasks/:id/run[?wait=true]` · `GET /api/tasks/:id/runs` · `GET /api/runs/:id` · `GET /api/changes` | Scheduled tasks, run history, and diffs |

The legacy endpoints `/proxy`, `/headless-proxy`, `/export-to-db`, `/api/scrape/*`, and `/api/scheduler/tasks` still work for the original web UI.

### Fetch modes

- `auto` (default): plain HTTP first. It upgrades to headless Chrome when the page looks client-rendered (an empty SPA root or almost no text plus scripts), when a bot wall returns 403/429/503, or when you ask for `waitForSelector`/`scroll`.
- `http`: never launches a browser.
- `browser`: always renders in Chrome (with isolated cookies per request, and media/fonts blocked).

## Scheduler & change monitoring

Each run is written to `data/results/<taskId>/`, hashed, and diffed against the previous successful run. Runs are stored in SQLite as `status`, `changed`, `addedLines`/`removedLines`, and a unified diff. With `webhookUrl` and `notifyOn: change | always | never`, the server POSTs `{event, task, run, diff}`.

Only one process runs cron jobs at a time: the web server or a stdio MCP process, coordinated through `data/scheduler.lock`. That process re-reads tasks every 30 seconds, so a watch created from any client gets scheduled. Task JSON files from v1 (`scheduled_tasks/`) are imported automatically.

## Security model

Assume an agent may be reading hostile pages, and plan accordingly.

- **SSRF protection.** Localhost, RFC1918, link-local/cloud-metadata (`169.254.169.254`), CGNAT, IPv6 ULA/link-local, and encoded forms such as `2130706433` are blocked. The check runs when the URL is parsed, again after DNS resolution, again at socket connect time (which defeats DNS rebinding), on every redirect hop, and on every request made by browser pages. Set `ALLOW_PRIVATE_NETWORKS=true` to opt out.
- **Binds to `127.0.0.1` by default.** The server rejects foreign `Host` headers (DNS rebinding) and cross-origin browser requests unless the origin is listed in `CORS_ORIGINS`.
- **Optional API key** (`STEALTHSIPHON_API_KEY`) for `/api`, `/mcp`, and the legacy endpoints.
- **Only `public/` and `image/` are served.** The database, task configs, and source code are never exposed, and errors never include stack traces.
- **robots.txt is honored by default**, including `Crawl-delay`. Disallowed links are never queued during crawls. You can override this per request with `respectRobots: false` (the web UI's "Bypass robots.txt" checkbox now maps to this).
- **Per-host concurrency and rate limiting** protect target sites and your IP.

See [`.env.example`](.env.example) for every setting.

## Project layout

```
src/
  config.js           env-driven settings
  server.js           express app: UI, /api, /mcp, guards
  api.js              REST routes + legacy routes + error handler
  mcp.js              MCP tool definitions
  scheduler.js        cron tasks, run history, diffs, webhooks
  exporters.js        SQLite/Mongo/MySQL export for the UI
  core/
    safety.js         SSRF protection
    http.js           safe HTTP client
    browser.js        puppeteer-core: render, screenshots, sessions
    scrape.js         fetch orchestration (auto mode, cache, formats)
    content.js        Markdown/text/metadata/links/paging
    extract.js        CSS + LLM extraction
    crawl.js          bounded concurrent crawler
    robots.js         robots.txt + sitemaps
    limiter.js        per-host politeness
    cache.js          TTL LRU
    store.js          SQLite (better-sqlite3)
bin/                  siphon CLI, stdio MCP server
public/               web UI
test/                 node:test suites with a local fixture site
```

## Recent Updates

### Version 2.0.0 (November 2026)

- MCP server (stdio + Streamable HTTP) with 26 agent-oriented tools
- Real headless Chrome rendering, screenshots, and interactive browser sessions (puppeteer-core with the system Chrome)
- Clean Markdown output with metadata, link inventory, and pagination
- Structured extraction (CSS fields/lists, or JSON Schema via Ollama)
- Concurrent, rate-limited crawler that respects robots.txt, with include/exclude globs, sitemap seeding, and persisted results
- Scheduler rewrite: SQLite run history, change detection with diffs, webhooks, single-leader locking
- CLI (`siphon`)
- Security hardening: SSRF protection, loopback binding, Host/Origin guards, optional API key, no static exposure of data or source, no stack traces in errors; removed public CORS-proxy fallback from the UI
- Fixed: the "headless" mode never actually rendered JavaScript; screenshots returned HTML; failed scheduled runs recorded the wrong error; unbounded crawls
- Dependencies: `sqlite3` → `better-sqlite3`, `puppeteer` → `puppeteer-core`; dropped unused `sharp`, `to-ico`, `png-to-ico`, `svg2png-cli`, `cors`, `uuid`

### Version 1.3.0 (April 2025)

- Deep link following, scheduling presets, output format selection

### Version 1.2.0 (April 2025)

- Scheduled scraping, task scheduler UI

### Version 1.1.0 (April 2025)

- Port 4200, SVG favicon, database export, headless browser fallback

## License

MIT
