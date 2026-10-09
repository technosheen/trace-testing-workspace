import express from "express";
import { Readable } from "node:stream";
import { resolve } from "node:path";
import { createGateway } from "./gateway.mjs";

export function createAzureApp(env = process.env) {
  const app = express();
  const gateway = createGateway({ ...env, TRACE_RUNNER_URL: "http://127.0.0.1:4310" }, fetch, { allowLocalRunner: true });
  app.disable("x-powered-by");
  app.get("/api/health", async (_req, res) => {
    try {
      const response = await fetch("http://127.0.0.1:4310/api/health", { signal: AbortSignal.timeout(3000) });
      res.status(response.ok ? 200 : 503).json({ status: response.ok ? "ok" : "unavailable" });
    } catch { res.status(503).json({ status: "unavailable" }); }
  });
  app.use(express.raw({ type: () => true, limit: "64kb" }));
  app.use(async (req, res, next) => {
    if (!/^\/(api(?:\/|$)|artifacts(?:\/|$)|demo(?:\/|$))/.test(req.path)) return next();
    try {
      const headers = new Headers();
      for (const [name, value] of Object.entries(req.headers)) if (typeof value === "string") headers.set(name, value);
      // Use the configured public origin, rather than trusting a caller's Host header.
      const origin = env.TRACE_PUBLIC_ORIGIN;
      if (!origin || new URL(origin).protocol !== "https:") return res.status(503).json({ error: "Public origin is not configured." });
      const options = { method: req.method, headers };
      if (!["GET", "HEAD"].includes(req.method)) options.body = req.body;
      if (!req.originalUrl.startsWith("/") || req.originalUrl.startsWith("//")) return res.status(404).end();
      const response = await gateway(new Request(origin + req.originalUrl, options));
      res.status(response.status);
      response.headers.forEach((value, name) => res.setHeader(name, value));
      if (!response.body || req.method === "HEAD") return res.end();
      Readable.fromWeb(response.body).pipe(res);
    } catch { res.status(502).json({ error: "The testing service is unavailable." }); }
  });
  app.use(express.static(resolve("dist"), { index: "index.html" }));
  app.use((error, _req, res, _next) => res.status(error.status === 413 ? 413 : 400).json({ error: error.status === 413 ? "Request too large." : "Invalid request." }));
  return app;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  createAzureApp().listen(Number(process.env.PORT || 8080), "0.0.0.0");
}
