// Simulated Alexa+ (text) — an LLM agent that calls the HouseLedger MCP server via the official MCP client.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import fs from "node:fs";

// LLM config comes from environment variables only (any OpenAI-compatible endpoint).
function env() {
  const e = process.env;
  return {
    base: (e.LLM_BASE_URL || e.OPENAI_BASE_URL || "").replace(/\/$/, ""),
    key: e.LLM_API_KEY || e.OPENAI_API_KEY,
    model: e.LLM_MODEL || e.OPENAI_MODEL || "gpt-4o-mini",
  };
}

const SYS = `You are Alexa+, a concise household voice assistant. Use the HouseLedger tools for lists, reminders, tasks.
Always pass "by" = the current speaker. Pass the user's exact words as "heard" when adding. If add_items returns flagged items,
ask the speaker to confirm them briefly. For "used/bought one" use adjust_item with a negative delta. Current time: {NOW}. Reply in 1-2 short spoken sentences.`;

export function mountSimulator(app, port) {
  app.get("/", (_q, r) => r.type("html").send(fs.readFileSync(new URL("../web/index.html", import.meta.url))));
  app.post("/api/say", async (req, res) => {
    const { speaker = "Sam", text } = req.body;
    const cfg = env();
    const client = new Client({ name: "alexa-plus-sim", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)));
    try {
      const { tools } = await client.listTools();
      const fns = tools.map(t => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.inputSchema } }));
      const msgs = [{ role: "system", content: SYS.replace("{NOW}", new Date().toISOString()) }, { role: "user", content: `[speaker: ${speaker}] ${text}` }];
      const trace = [];
      for (let step = 0; step < 6; step++) {
        const r = await fetch(`${cfg.base}/chat/completions`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${cfg.key}` },
          body: JSON.stringify({ model: cfg.model, messages: msgs, tools: fns, temperature: 0.2 }) });
        const m = (await r.json()).choices?.[0]?.message;
        if (!m) throw new Error("LLM returned no message");
        msgs.push(m);
        if (!m.tool_calls?.length) return res.json({ reply: m.content, trace, list: (await client.callTool({ name: "list_items", arguments: {} })).structuredContent });
        for (const c of m.tool_calls) {
          const args = JSON.parse(c.function.arguments || "{}");
          const out = await client.callTool({ name: c.function.name, arguments: args });
          trace.push({ tool: c.function.name, args, result: out.structuredContent });
          msgs.push({ role: "tool", tool_call_id: c.id, content: out.content[0].text });
        }
      }
      res.json({ reply: "Sorry, that took too many steps.", trace });
    } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
    finally { await client.close(); }
  });
}
