#!/usr/bin/env node
// HouseLedger MCP server — MCP spec 2025-11-25 over Streamable HTTP (official SDK).
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import * as L from "./ledger.js";
import { mountSimulator } from "./simulator.js";

const PORT = Number(process.env.PORT || 8787);
const who = z.string().describe("Household member speaking (from Alexa+ voice ID / profile)").default("someone");
const j = (o) => ({ content: [{ type: "text", text: JSON.stringify(o) }], structuredContent: o });

export function buildServer() {
  const s = new McpServer({ name: "houseledger", version: "1.0.0" });
  s.registerTool("add_items", { title: "Add to shared list", description: "Add items to the household list with who said it and the raw heard text. Implausible names come back in `flagged` — ask the speaker to confirm instead of guessing.",
    inputSchema: { items: z.array(z.object({ name: z.string(), qty: z.number().optional(), unit: z.string().optional() })), by: who, heard: z.string().optional() } }, (a) => j(L.addItems(a)));
  s.registerTool("adjust_item", { title: "Change quantity", description: "Change quantity by a delta (e.g. -1 lb). Never removes the whole line unless it reaches 0.",
    inputSchema: { name: z.string(), delta: z.number(), by: who } }, (a) => j(L.adjustItem(a)));
  s.registerTool("remove_item", { title: "Remove item", description: "Remove an item line (check it off).", inputSchema: { name: z.string(), by: who } }, (a) => j(L.removeItem(a)));
  s.registerTool("confirm_item", { title: "Confirm/correct item", description: "Confirm or correct a flagged (possibly misheard) item.", inputSchema: { id: z.string(), correctedName: z.string().optional(), by: who } }, (a) => j(L.confirmItem(a)));
  s.registerTool("list_items", { title: "Show list", description: "Show the list with who added each item and when.", inputSchema: { includeDone: z.boolean().optional() } }, (a) => j(L.listItems(a)));
  s.registerTool("add_reminder", { title: "Reminder or task", description: "kind=reminder: announce once then archive (never 'overdue'). kind=task: stays open until completed. `at` is ISO 8601.",
    inputSchema: { text: z.string(), at: z.string(), kind: z.enum(["reminder", "task"]).default("reminder"), by: who, forWhom: z.string().optional() } }, (a) => j(L.addReminder(a)));
  s.registerTool("tick", { title: "Fire due items", description: "Announce everything due; reminders archive, tasks become open.", inputSchema: { asOf: z.string().optional() } }, (a) => j(L.tick(a)));
  s.registerTool("complete_task", { title: "Complete task", description: "Mark a task done.", inputSchema: { id: z.string(), by: who } }, (a) => j(L.completeTask(a)));
  s.registerTool("list_reminders", { title: "Upcoming", description: "Scheduled reminders and open tasks.", inputSchema: {} }, () => j(L.listReminders()));
  s.registerTool("undo_last", { title: "Undo", description: "Undo the most recent change by anyone.", inputSchema: { by: who } }, (a) => j(L.undoLast(a)));
  s.registerTool("what_changed", { title: "What changed since I last asked", description: "Per-person digest of changes made by others since this person last checked, plus items awaiting confirmation. State persists across sessions.",
    inputSchema: { who: z.string() } }, (a) => j(L.whatChanged(a)));
  s.registerResource("ledger", "houseledger://list", { mimeType: "application/json", description: "Current household list" },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(L.listItems()) }] }));
  return s;
}

const app = express();
app.use(express.json());
// Stateless Streamable HTTP: fresh server+transport per request; durable state lives in the ledger file.
app.post("/mcp", async (req, res) => {
  const server = buildServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on("close", () => { transport.close(); server.close(); });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});
app.get("/mcp", (_q, r) => r.status(405).json({ error: "SSE stream not offered in stateless mode" }));
app.get("/health", (_q, r) => r.json({ ok: true }));
mountSimulator(app, PORT);
app.listen(PORT, "0.0.0.0", () => console.log(`HouseLedger MCP on http://127.0.0.1:${PORT}/mcp  simulator: /`));
