#!/usr/bin/env node
/**
 * StealthSiphon CLI: shell access for agents and scripts.
 *
 *   siphon fetch <url> [--format markdown|text|html|raw] [--mode auto|http|browser]
 *                      [--selector css] [--max-chars N] [--offset N] [--links] [--json]
 *   siphon links <url> [--filter internal|external|all]
 *   siphon extract <url> --fields '{"title":"h1","price":".price"}' [--list ".item"]
 *   siphon extract <url> --schema '{"type":"object",...}' [--instructions "..."] [--provider lmstudio|ollama|openai] [--model id]
 *   siphon llm          show which local LLM servers/models are available
 *   siphon screenshot <url> [-o out.png] [--full-page] [--selector css]
 *   siphon crawl <url> [--max-pages N] [--max-depth N] [--include glob] [--exclude glob] [--json]
 *   siphon serve        start the web server / REST API / MCP HTTP endpoint
 *   siphon mcp          start the MCP server on stdio
 *
 * Global flags: --no-robots (ignore robots.txt), --user-agent "..."
 */
const fs = require('fs');

function parseArgs(argv) {
    const args = { _: [] };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a.startsWith('--')) {
            const [k, inline] = a.slice(2).split(/=(.*)/s);
            const key = k.replace(/-([a-z])/g, (_m, c) => c.toUpperCase());
            if (inline !== undefined) args[key] = inline;
            else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('-')) args[key] = argv[++i];
            else args[key] = true;
        } else if (a === '-o') {
            args.output = argv[++i];
        } else {
            args._.push(a);
        }
    }
    return args;
}

const multi = (v) => (v === undefined ? undefined : [].concat(v).flatMap(s => String(s).split(',')).map(s => s.trim()).filter(Boolean));
const num = (v) => (v === undefined ? undefined : Number(v));

async function main() {
    const [cmd, ...rest] = process.argv.slice(2);
    const a = parseArgs(rest);
    const url = a._[0];
    const common = {
        url,
        mode: a.mode,
        respectRobots: a.noRobots ? false : undefined,
        userAgent: a.userAgent,
    };
    const needUrl = () => { if (!url) throw new Error(`Usage: siphon ${cmd} <url> ...`); };

    switch (cmd) {
        case 'serve':
            require('../src/server').start();
            return;
        case 'mcp':
            require('./mcp');
            return;
        case 'fetch': {
            needUrl();
            const { fetchPage } = require('../src/core/scrape');
            const r = await fetchPage({
                ...common, format: a.format, selector: a.selector, mainContent: a.full ? false : undefined,
                maxChars: num(a.maxChars), offset: num(a.offset), includeLinks: a.links ? (a.links === true ? true : a.links) : false,
                waitForSelector: a.waitFor, scroll: !!a.scroll,
            });
            if (a.json) return print(JSON.stringify(r, null, 2));
            if (r.warnings.length) console.error(`warning: ${r.warnings.join('; ')}`);
            if (!r.ok) console.error(`HTTP ${r.status} from ${r.finalUrl}`);
            if (r.truncated) console.error(`(truncated at ${r.nextOffset} of ${r.totalChars} chars; use --offset ${r.nextOffset})`);
            print(r.content);
            if (r.links) print('\n' + r.links.map(l => `${l.url}\t${l.text}`).join('\n'));
            process.exitCode = r.ok ? 0 : 2;
            return;
        }
        case 'links': {
            needUrl();
            const { fetchPage } = require('../src/core/scrape');
            const filter = a.filter || 'internal';
            const r = await fetchPage({ ...common, format: 'raw', maxChars: 1, includeMetadata: false, includeLinks: filter === 'all' ? true : filter, maxLinks: 5000 });
            if (a.json) return print(JSON.stringify(r.links, null, 2));
            print((r.links || []).map(l => `${l.url}\t${l.text}`).join('\n'));
            return;
        }
        case 'extract': {
            needUrl();
            const { extract } = require('../src/core/extract');
            const r = await extract({
                ...common,
                fields: a.fields ? JSON.parse(a.fields) : undefined,
                list: a.list,
                schema: a.schema ? JSON.parse(a.schema) : undefined,
                instructions: a.instructions,
                model: a.model,
                provider: a.provider,
            });
            print(JSON.stringify(r.items ? r.items : r.data, null, 2));
            return;
        }
        case 'llm': {
            const llm = require('../src/core/llm');
            const status = await llm.probe({ fresh: true });
            for (const s of status) {
                print(`${s.provider.padEnd(9)} ${s.url}  ${s.available ? `${s.models.length} model(s)` : `unavailable (${s.error})`}`);
                for (const m of s.models || []) print(`    ${m.loaded ? '*' : ' '} ${m.id}`);
            }
            try {
                const r = await llm.resolve({});
                print(`\nextract would use: ${r.provider} / ${r.model}   (* = loaded)`);
            } catch (err) { print(`\n${err.message}`); }
            return;
        }
        case 'screenshot': {
            needUrl();
            const { screenshot } = require('../src/core/scrape');
            const type = /\.jpe?g$/i.test(a.output || '') ? 'jpeg' : 'png';
            const s = await screenshot({ ...common, fullPage: !!a.fullPage, selector: a.selector, type, width: num(a.width), height: num(a.height) });
            const out = a.output || `screenshot-${Date.now()}.${type}`;
            fs.writeFileSync(out, s.image);
            console.error(`Saved ${out} (${s.image.length} bytes) from ${s.finalUrl}`);
            return;
        }
        case 'crawl': {
            needUrl();
            const { startCrawl } = require('../src/core/crawl');
            const r = await startCrawl({
                ...common, maxPages: num(a.maxPages), maxDepth: num(a.maxDepth), include: multi(a.include), exclude: multi(a.exclude),
                useSitemap: !!a.sitemap, format: a.format, waitMs: 60 * 60 * 1000,
            });
            if (a.json) {
                const store = require('../src/core/store');
                const pages = r.pages.map(p => ({ ...p, content: (store.crawls.page(r.crawlId, p.url) || {}).content }));
                return print(JSON.stringify({ ...r, pages }, null, 2));
            }
            print(`crawl ${r.crawlId}: ${r.status}, ${r.pagesOk} ok, ${r.pagesFailed} failed`);
            for (const p of r.pages) print(`${p.status}\t${p.depth}\t${p.url}\t${p.title || p.error || ''}`);
            return;
        }
        default:
            print(fs.readFileSync(__filename, 'utf8').split('\n').slice(2, 19).map(l => l.replace(/^ \* ?/, '')).join('\n'));
            process.exitCode = cmd ? 1 : 0;
    }
}

function print(s) { process.stdout.write(s.endsWith('\n') ? s : s + '\n'); }

main()
    .then(async () => {
        const cmd = process.argv[2];
        if (cmd === 'serve' || cmd === 'mcp') return;
        await require('../src/core/browser').closeBrowser().catch(() => {});
        process.exit();
    })
    .catch(async (err) => {
        console.error(`error: ${err.code ? err.code + ': ' : ''}${err.message}`);
        await require('../src/core/browser').closeBrowser().catch(() => {});
        process.exit(1);
    });
