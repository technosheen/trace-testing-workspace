import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const temp = await mkdtemp(path.join(tmpdir(), 'trace-redirect-'));
process.env.TRACE_DATA_DIR = temp;
const { isolatedContext } = await import('./runner.mjs');
const { guardedProxy } = await import('./proxy.mjs');
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const close = server => new Promise(resolve => { server.closeAllConnections?.(); server.close(resolve); });

test('redirect destinations are guarded before HTTP and HTTPS requests', {timeout: 90000}, async t => {
  const previousPort = process.env.PORT;
  let browser, proxy, tlsProxy;
  const counters = new Map();
  let base;
  const handler = (req, res) => {
    counters.set(req.url, (counters.get(req.url) || 0) + 1);
    const name = req.url.split('/').at(-1);
    const redirects = {
      unsafe: '/demo/delete', query: '/demo/done?command=save',
      chain: 'middle', middle: 'nested/final', loop: 'loop',
      private: 'http://127.0.0.1:1/private',
      cross: req.socket.encrypted ? `https://1.1.1.1:${tlsServer.address().port}/demo/done` : `http://8.8.8.8:${new URL(base).port}/demo/done`,
    };
    if (name === 'hang') return;
    if (name === 'popup') {res.setHeader('Content-Type','text/html');return res.end(`<button onclick="window.open('/demo/unsafe')">Open popup</button>`);}
    if (name === 'frame') {res.setHeader('Content-Type','text/html');return res.end('<iframe src="/demo/unsafe"></iframe>');}
    if (redirects[name]) { res.writeHead(302, {location: redirects[name]}); return res.end(); }
    res.setHeader('Content-Type', 'text/html');
    res.end('<title>Safe</title><h1>Safe destination</h1><a href="relative">Relative link</a><script>fetch("/demo/asset?version=1")</script>');
  };
  const server = http.createServer(handler);
  let tlsServer;
  try {
    await listen(server);
    process.env.PORT = String(server.address().port);
    base = `http://127.0.0.1:${process.env.PORT}`;
    proxy = await guardedProxy(true);
    execFileSync('openssl', ['req','-x509','-newkey','rsa:2048','-nodes','-keyout',path.join(temp,'key.pem'),'-out',path.join(temp,'cert.pem'),'-subj','/CN=8.8.8.8','-days','1'], {stdio:'ignore'});
    tlsServer = https.createServer({key:await readFile(path.join(temp,'key.pem')),cert:await readFile(path.join(temp,'cert.pem'))}, handler);
    await listen(tlsServer);
    // A test-only CONNECT transport maps the public test URL to the local TLS
    // fixture. Production still uses guardedProxy's DNS-pinned public transport.
    tlsProxy = http.createServer();
    const sockets = new Set();
    tlsProxy.on('connection', s => { sockets.add(s); s.on('close',()=>sockets.delete(s)); });
    tlsProxy.on('connect', (req, client, head) => {
      const upstream = net.connect(tlsServer.address().port,'127.0.0.1',()=>{
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if(head.length) upstream.write(head);
        client.pipe(upstream); upstream.pipe(client);
      });
      sockets.add(upstream); upstream.on('close',()=>sockets.delete(upstream));
      upstream.on('error',()=>client.destroy()); client.on('error',()=>upstream.destroy()); client.on('close',()=>upstream.destroy());
    });
    await listen(tlsProxy);
    for (const protocol of ['http','https']) {
      await t.test(protocol, async t => {
        browser = await chromium.launch({channel:process.env.TRACE_BROWSER_CHANNEL||'chrome',headless:true,proxy:{server:protocol==='http'?proxy.url:`http://127.0.0.1:${tlsProxy.address().port}`,bypass:'<-loopback>'}});
        const origin = protocol==='http'?base:`https://8.8.8.8:${tlsServer.address().port}`;
        async function fixture(name, options = {}) {
          const context = await isolatedContext(browser,`${origin}/demo/${name}`,options);
          // Self-signed TLS fixture only; production contexts keep certificate checks.
          if(protocol==='https') { const page=await context.newPage(); const cdp=await context.newCDPSession(page); await cdp.send('Security.setIgnoreCertificateErrors',{ignore:true}); return {context,page}; }
          return {context,page:await context.newPage()};
        }
        for(const [name,target] of [['unsafe','/demo/delete'],['query','/demo/done?command=save'],['private','/private']]) {
          await t.test(`${name} destination never receives a request`,async()=>{
            counters.clear(); const {context,page}=await fixture(name);
            try { const error=await page.goto(`${origin}/demo/${name}`,{timeout:5000}).catch(e=>e); assert.equal(counters.get(target)||0,0); assert.ok(error instanceof Error); }
            finally {await context.close();}
          });
        }
        await t.test('safe relative chain preserves final URL and relative links',async()=>{
          const {context,page}=await fixture('chain');
          try { await page.goto(`${origin}/demo/chain`); assert.equal(page.url(),`${origin}/demo/nested/final`); assert.equal(await page.locator('a').evaluate(a=>a.href),`${origin}/demo/nested/relative`); await page.waitForFunction(()=>document.title==='Safe'); }
          finally {await context.close();}
        });
        await t.test('popup first navigation fails closed',async()=>{
          const {context,page}=await fixture('popup');
          try {await page.goto(`${origin}/demo/popup`);counters.clear();const popup=context.waitForEvent('page');await page.getByRole('button').click();const child=await popup;await child.waitForTimeout(100);assert.equal(counters.get('/demo/unsafe')||0,0);assert.equal(counters.get('/demo/delete')||0,0);}
          finally {await context.close();}
        });
        await t.test('embedded navigation fails closed before its first request',async()=>{
          const {context,page}=await fixture('frame');
          try {counters.clear();await page.goto(`${origin}/demo/frame`);await page.waitForTimeout(100);assert.equal(counters.get('/demo/unsafe')||0,0);assert.equal(counters.get('/demo/delete')||0,0);}
          finally {await context.close();}
        });
        await t.test('same-origin contexts reject cross-origin redirect',async()=>{
          const {context,page}=await fixture('cross',{sameOrigin:true});
          try {counters.clear();await assert.rejects(page.goto(`${origin}/demo/cross`,{timeout:5000}));assert.equal(counters.get('/demo/done')||0,0);}
          finally {await context.close();}
        });
        await t.test('redirect loops stop at 20 hops',async()=>{
          counters.clear(); const {context,page}=await fixture('loop');
          try {await assert.rejects(page.goto(`${origin}/demo/loop`,{timeout:5000})); assert.equal(counters.get('/demo/loop'),20);}
          finally {await context.close();}
        });
        await t.test('context cancellation closes a pending request',async()=>{
          const {context,page}=await fixture('hang'); const navigation=page.goto(`${origin}/demo/hang`).catch(e=>e);
          await page.waitForTimeout(50); await context.close(); assert.ok(await navigation instanceof Error);
        });
        await browser.close(); browser=null;
      });
    }
    for(const s of sockets) s.destroy();
  } finally {
    await browser?.close(); await proxy?.close();
    await close(server); if(tlsServer) await close(tlsServer); if(tlsProxy) await close(tlsProxy);
    if(previousPort===undefined) delete process.env.PORT; else process.env.PORT=previousPort;
    await rm(temp,{recursive:true,force:true});
  }
});
