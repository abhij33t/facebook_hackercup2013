/**
 * Web Server — SuperAgent Playground
 *
 * Give it any problem. It analyzes, creates specialized agents,
 * runs them, and synthesizes a final answer — all streamed live.
 *
 * Run:  npm start
 *       PORT=8080 npm start
 *       ANTHROPIC_API_KEY=sk-... npm start
 */

import * as http from "http";
import * as url from "url";
import Anthropic from "@anthropic-ai/sdk";
import { SuperAgent, SuperAgentEvent } from "./super-agent";
import { html } from "./ui";

const PORT = parseInt(process.env.PORT ?? "3000", 10);

function sseHeaders(): Record<string, string> {
  return {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*",
  };
}

function sendSSE(res: http.ServerResponse, event: string, data: unknown) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function parseBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try { resolve(JSON.parse(body)); }
      catch { reject(new Error("Invalid JSON")); }
    });
  });
}

async function runSuperAgent(res: http.ServerResponse, client: Anthropic, goal: string) {
  const agent = new SuperAgent({ client });

  agent.on((event: SuperAgentEvent) => {
    sendSSE(res, event.phase, event.detail);
  });

  try {
    await agent.solve(goal);
  } catch {
    // Error already emitted via the handler
  }
  sendSSE(res, "done", {});
  res.end();
}

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url ?? "/", true);
  const path = parsed.pathname;

  if (req.method === "OPTIONS") {
    res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST,GET,OPTIONS", "Access-Control-Allow-Headers": "Content-Type" });
    res.end();
    return;
  }

  try {
    if (path === "/" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(html);
      return;
    }

    if (path === "/api/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (path === "/api/solve" && req.method === "POST") {
      const body = await parseBody(req);
      const apiKey = (body.apiKey as string) || process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "API key required" }));
        return;
      }
      const goal = (body.goal as string)?.trim();
      if (!goal) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Goal is required" }));
        return;
      }

      const client = new Anthropic({ apiKey });
      res.writeHead(200, sseHeaders());
      await runSuperAgent(res, client, goal);
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: msg }));
    } else {
      sendSSE(res, "error", { error: msg });
      res.end();
    }
  }
});

server.listen(PORT, () => {
  console.log(`\n  SuperAgent running at http://localhost:${PORT}\n`);
  if (process.env.ANTHROPIC_API_KEY) {
    console.log("  API key: loaded from environment");
  } else {
    console.log("  API key: enter in the browser UI");
  }
  console.log();
});
