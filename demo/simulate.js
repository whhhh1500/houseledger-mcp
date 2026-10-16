#!/usr/bin/env node
// Scripted smoke test using the official MCP client (no LLM needed).
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
const c = new Client({ name: "smoke", version: "1" });
await c.connect(new StreamableHTTPClientTransport(new URL(process.env.MCP_URL || "http://127.0.0.1:8787/mcp")));
const call = async (name, args) => { const r = await c.callTool({ name, arguments: args }); console.log(`> ${name}`, JSON.stringify(r.structuredContent).slice(0, 220)); return r.structuredContent; };
console.log("protocol:", c.getServerVersion(), "tools:", (await c.listTools()).tools.length);
const a = await call("add_items", { items: [{ name: "papaya talons" }, { name: "hamburger", qty: 67, unit: "lb" }], by: "Mia", heard: "add paper towels and 67 pounds of hamburger" });
await call("adjust_item", { name: "hamburger", delta: -1, by: "Sam" });
await call("confirm_item", { id: a.flagged[0].id, correctedName: "paper towels", by: "Mia" });
await call("add_reminder", { text: "take out trash", at: "2020-01-01T00:00:00Z", kind: "reminder", by: "Sam" });
await call("add_reminder", { text: "refill Grandpa's pills", at: "2020-01-01T00:00:00Z", kind: "task", by: "Sam" });
await call("tick", {});
await call("undo_last", { by: "Sam" });
await call("what_changed", { who: "Sam" });
await call("list_items", {});
await c.close();
