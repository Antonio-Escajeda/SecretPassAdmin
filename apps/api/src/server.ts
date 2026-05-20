import { createServer } from "node:http";
import { config } from "./config.js";
import { secretRoutes } from "./routes/secrets.routes.js";
import {
  parseBody,
  sendJson,
  getIp,
  applySecurityHeaders,
  generateRequestId,
} from "./http.js";
import { renderMetrics, increment } from "./metrics.js";
import { checkRateLimit } from "./ratelimit.js";

const routes = secretRoutes();

if (config.NODE_ENV === "production" && !config.TRUST_PROXY) {
  process.stdout.write(
    JSON.stringify({
      level: "warn",
      msg: "NODE_ENV=production but TRUST_PROXY=false — TLS termination may not be configured. Set TRUST_PROXY=true if running behind a reverse proxy.",
    }) + "\n"
  );
}

const server = createServer(async (req, res) => {
  try {
    const id = generateRequestId();
    const method = req.method ?? "GET";
    const rawUrl = req.url ?? "/";
    const url = rawUrl.split("?").at(0) ?? "/";
    const ip = getIp(req);

    applySecurityHeaders(res, id);

    // TLS enforcement — production only
    if (config.NODE_ENV === "production") {
      const proto = req.headers["x-forwarded-proto"];
      if (proto !== "https") {
        res.writeHead(301, { Location: `https://${req.headers.host ?? ""}${rawUrl}` });
        res.end();
        return;
      }
    }

    // Global rate limit: 500 req/min
    const globalRl = await checkRateLimit(ip, {
      max: 500,
      windowMs: 60_000,
      routeKey: "global",
    });
    if (!globalRl.allowed) {
      sendJson(res, 429, { error: "Too Many Requests" });
      return;
    }

    // Health check
    if (method === "GET" && url === "/health") {
      increment("http_requests_total", { method, route: "/health", status_code: "200" });
      sendJson(res, 200, { ok: true });
      return;
    }

    // Metrics — localhost-only in production
    if (method === "GET" && url === "/metrics") {
      if (config.NODE_ENV === "production" && ip !== "127.0.0.1" && ip !== "::1") {
        sendJson(res, 403, { error: "Forbidden" });
        return;
      }
      res.writeHead(200, { "Content-Type": "text/plain; version=0.0.4; charset=utf-8" });
      res.end(renderMetrics());
      return;
    }

    // Body parsing for POST/PUT/PATCH
    let body: unknown = null;
    if (method === "POST" || method === "PUT" || method === "PATCH") {
      try {
        body = await parseBody(req);
      } catch (err) {
        sendJson(res, 400, { error: err instanceof Error ? err.message : "Bad request" });
        return;
      }
    }

    // Route dispatch
    const handled = await routes.dispatch({ req, res, method, url, ip, id, body, params: {} });

    if (!handled) {
      increment("http_requests_total", { method, route: "unknown", status_code: "404" });
      sendJson(res, 404, { error: "Not found" });
    }
  } catch (err) {
    process.stderr.write(
      JSON.stringify({ level: "error", msg: "Unhandled request error", error: String(err) }) + "\n"
    );
    sendJson(res, 500, { error: "Internal server error" });
  }
});

server.listen(config.PORT, "0.0.0.0", () => {
  process.stdout.write(
    JSON.stringify({ level: "info", msg: `Listening on 0.0.0.0:${config.PORT}` }) + "\n"
  );
});
