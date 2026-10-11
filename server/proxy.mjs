import http from "node:http";
import net from "node:net";
import { lookup } from "node:dns/promises";
import { validateTarget } from "./policy.mjs";

export function responseNetworkError(response) {
  // HTTP responses pass through the guard, which strips target copies below.
  // HTTPS headers remain encrypted inside CONNECT; a target may set any header.
  if (!response?.url().startsWith("http:")) return undefined;
  const marker = response.headers()["x-trace-network-error"];
  return ["blocked", "unavailable"].includes(marker) ? marker : undefined;
}

// Enforce destination policy below Playwright's route layer: Chromium does not
// invoke a route handler for every hop of a redirected request.
export async function guardedProxy(allowDemo) {
  const sockets = new Set();
  async function destination(value) {
    const url = await validateTarget(value, allowDemo);
    const hostname = url.hostname.replace(/^\[|\]$/g, "");
    const address = net.isIP(hostname)
      ? { address: hostname, family: net.isIP(hostname) }
      : await lookup(hostname);
    // Revalidate the address that will actually be connected, and pin it so
    // the outgoing connection cannot perform a second DNS lookup.
    if (
      !(
        allowDemo &&
        hostname === "127.0.0.1" &&
        url.port === String(process.env.PORT || 4310) &&
        /^\/demo(?:\/|$)/.test(url.pathname)
      )
    )
      await validateTarget(
        `https://${address.family === 6 ? "[" + address.address + "]" : address.address}`,
        false,
      );
    return { url, address };
  }
  const server = http.createServer(async (req, res) => {
    let outgoing;
    try {
      if (!["GET", "HEAD", "OPTIONS"].includes(req.method))
        throw new Error("Write request blocked.");
      const { url, address } = await destination(req.url);
      if (url.protocol !== "http:")
        throw new Error("HTTPS must use a guarded tunnel.");
      const headers = { ...req.headers, host: url.host };
      delete headers["proxy-connection"];
      delete headers["proxy-authorization"];
      outgoing = http.request(
        {
          hostname: address.address,
          family: address.family,
          port: url.port || 80,
          path: url.pathname + url.search,
          method: req.method,
          headers,
          agent: false,
          timeout: 15000,
        },
        (upstream) => {
          // Only this guard can attest that a response was synthesized locally.
          // Strip a target's same-named header so it cannot hide an HTTP failure.
          const responseHeaders = { ...upstream.headers };
          delete responseHeaders["x-trace-network-error"];
          res.writeHead(upstream.statusCode || 502, responseHeaders);
          upstream.pipe(res);
        },
      );
      outgoing.on("timeout", () => outgoing.destroy());
      outgoing.on("error", () => {
        if (!res.headersSent)
          res.writeHead(502, { "x-trace-network-error": "unavailable" });
        res.end();
      });
      req.pipe(outgoing);
      res.on("close", () => outgoing.destroy());
    } catch {
      res.writeHead(403, { "x-trace-network-error": "blocked" });
      res.end("Destination blocked by Trace network policy.");
    }
  });
  server.on("connect", async (req, client, head) => {
    try {
      const { url, address } = await destination(`https://${req.url}/`);
      const upstream = net.connect({
        host: address.address,
        family: address.family,
        port: Number(url.port || 443),
      });
      sockets.add(upstream);
      upstream.once("close", () => sockets.delete(upstream));
      upstream.setTimeout(20000, () => upstream.destroy());
      upstream.once("connect", () => {
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head.length) upstream.write(head);
        upstream.pipe(client);
        client.pipe(upstream);
      });
      upstream.on("error", () => client.destroy());
      client.on("error", () => upstream.destroy());
      client.on("close", () => upstream.destroy());
    } catch {
      client.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
    }
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: async () => {
      sockets.forEach((s) => s.destroy());
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
