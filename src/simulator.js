// Simulated Alexa+ (text) — an LLM agent that calls the HouseLedger MCP server via the official MCP client.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import fs from "node:fs";
import { snapshot } from "./ledger.js";

// LLM config comes from environment variables only (any OpenAI-compatible endpoint).
function env() {
  const e = process.env;
  return {
    base: (e.LLM_BASE_URL || e.OPENAI_BASE_URL || "").replace(/\/$/, ""),
    key: e.LLM_API_KEY || e.OPENAI_API_KEY,
    model: e.LLM_MODEL || e.OPENAI_MODEL || "gpt-4o-mini",
  };
}

const SYS = `You are Alexa+, a concise household voice assistant. Use the HouseLedger MCP tools for lists, reminders and tasks; never just claim a change without calling a tool.
Rules:
- Always pass "by" = the current speaker. When adding, pass the speaker's exact words as "heard". Use units like "lb" for pounds.
- If add_items returns flagged items, do not guess: ask the speaker to confirm the flagged name.
- If the speaker corrects an item ("I meant X"), call confirm_item with the flagged item's id (see pending list below) and correctedName = X.
- "we used / ate one pound of X" => adjust_item with a negative delta (never remove the whole line).
- "remind me ..." => add_reminder kind="reminder"; "add a task / to-do ..." => add_reminder kind="task". If no time is given use at = "{NOW}".
- "what's due" / "announce" => call tick. "what changed" => what_changed with who = speaker. "undo" => undo_last.
Current time: {NOW}. Items awaiting confirmation: {PENDING}.
Reply in 1-2 short spoken sentences.`;

async function llm(cfg, body) {
  let last;
  for (let a = 0; a < 3; a++) {
    try {
      const r = await fetch(`${cfg.base}/chat/completions`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${cfg.key}` },
        body: JSON.stringify(body), signal: AbortSignal.timeout(120000) });
      const m = (await r.json()).choices?.[0]?.message;
      if (m) return m;
      last = new Error("LLM returned no message");
    } catch (e) { last = e; }
  }
  throw last;
}

export function mountSimulator(app, port) {
  app.get("/", (_q, r) => r.type("html").send(fs.readFileSync(new URL("../web/index.html", import.meta.url))));
  // Local demo-recording helpers (self-playing page + timing marks).
  app.get("/demo", (_q, r) => r.type("html").send(fs.readFileSync(new URL("../web/demo.html", import.meta.url))));
  app.get("/api/state", (_q, r) => r.json(snapshot()));
  app.post("/api/demo-mark", (req, r) => {
    const line = JSON.stringify({ t: Date.now(), ...req.body });
    if (process.env.DEMO_MARKS) fs.appendFileSync(process.env.DEMO_MARKS, line + "\n");
    console.log("MARK", line); r.json({ ok: true });
  });
  app.post("/api/say", async (req, res) => {
    const { speaker = "Sam", text } = req.body;
    const cfg = env();
    const client = new Client({ name: "alexa-plus-sim", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)));
    try {
      const { tools } = await client.listTools();
      const fns = tools.map(t => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.inputSchema } }));
      const pending = JSON.stringify(snapshot().items.filter(i => i.needsConfirmation).map(i => ({ id: i.id, name: i.name, addedBy: i.addedBy })));
      const msgs = [{ role: "system", content: SYS.replaceAll("{NOW}", new Date().toISOString()).replace("{PENDING}", pending) }, { role: "user", content: `[speaker: ${speaker}] ${text}` }];
      const trace = [];
      for (let step = 0; step < 6; step++) {
        const m = await llm(cfg, { model: cfg.model, messages: msgs, tools: fns, temperature: 0.2 });
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
