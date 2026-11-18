#!/usr/bin/env node
/**
 * StealthSiphon MCP server over stdio.
 *
 *   claude mcp add stealthsiphon -- node /path/to/stealthsiphon/bin/mcp.js
 *
 * stdout carries the MCP protocol, so all logging is redirected to stderr.
 */
console.log = (...args) => console.error(...args);
console.info = console.log;

const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { createMcpServer } = require('../src/mcp');
const scheduler = require('../src/scheduler');
const browser = require('../src/core/browser');
const store = require('../src/core/store');

async function main() {
    // Run scheduled watches from this process unless the web server already does
    if (process.env.MCP_RUN_SCHEDULER !== 'false') scheduler.start();
    const server = createMcpServer();
    await server.connect(new StdioServerTransport());

    let closing = false;
    const shutdown = async () => {
        if (closing) return;
        closing = true;
        scheduler.stop();
        await browser.closeBrowser().catch(() => {});
        store.closeDb();
        process.exit(0);
    };
    process.stdin.on('close', shutdown);
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
}

main().catch((err) => {
    console.error('[stealthsiphon-mcp] fatal:', err);
    process.exit(1);
});
