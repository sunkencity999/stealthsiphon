require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../src/config');
const { parseUrl, assertSafeUrl, isBlockedHostLiteral, isPrivateIP } = require('../src/core/safety');

test('isPrivateIP covers loopback, RFC1918, link-local, metadata, IPv6 forms', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0',
        '::1', '::', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:a9fe:a9fe']) {
        assert.equal(isPrivateIP(ip), true, ip);
    }
    for (const ip of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '2606:4700:4700::1111']) assert.equal(isPrivateIP(ip), false, ip);
});

test('literal host blocking (when private networks are disallowed)', () => {
    config.allowPrivateNetworks = false;
    try {
        for (const h of ['localhost', 'foo.localhost', 'metadata.google.internal', 'printer.local', '127.0.0.1', '[::1]', '2130706433', '0x7f000001']) {
            assert.equal(isBlockedHostLiteral(h), true, h);
        }
        assert.equal(isBlockedHostLiteral('example.com'), false);
    } finally {
        config.allowPrivateNetworks = true;
    }
});

test('parseUrl rejects non-http schemes and credentials, accepts bare domains', () => {
    assert.throws(() => parseUrl('file:///etc/passwd'), { code: 'BLOCKED_URL' });
    assert.throws(() => parseUrl('ftp://example.com'), { code: 'BLOCKED_URL' });
    assert.throws(() => parseUrl('https://user:pw@example.com'), { code: 'BLOCKED_URL' });
    assert.throws(() => parseUrl('not a url'), { code: 'INVALID_URL' });
    assert.equal(parseUrl('example.com/path').href, 'https://example.com/path');
    assert.equal(parseUrl('https://example.com/a#frag').href, 'https://example.com/a');
});

test('assertSafeUrl blocks private targets, including the WHATWG-normalized decimal form', async () => {
    config.allowPrivateNetworks = false;
    try {
        await assert.rejects(assertSafeUrl('http://127.0.0.1:4200/'), { code: 'BLOCKED_URL' });
        await assert.rejects(assertSafeUrl('http://2130706433/'), { code: 'BLOCKED_URL' });
        await assert.rejects(assertSafeUrl('http://169.254.169.254/latest/meta-data'), { code: 'BLOCKED_URL' });
        await assert.rejects(assertSafeUrl('http://localhost/'), { code: 'BLOCKED_URL' });
    } finally {
        config.allowPrivateNetworks = true;
    }
});

test('httpFetch refuses to connect to private addresses at socket level', async () => {
    const { httpFetch } = require('../src/core/http');
    const { safeLookup } = require('../src/core/safety');
    config.allowPrivateNetworks = false;
    try {
        await new Promise((resolve) => safeLookup('localhost', {}, (err) => { assert.equal(err.code, 'EBLOCKED'); resolve(); }));
        await assert.rejects(httpFetch('http://127.0.0.1:1/'), { code: 'BLOCKED_URL' });
    } finally {
        config.allowPrivateNetworks = true;
    }
});
