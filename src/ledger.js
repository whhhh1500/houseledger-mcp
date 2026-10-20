// HouseLedger core: attributed, auditable household list + reminder/task store.
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const FILE = process.env.LEDGER_FILE || path.resolve("data/ledger.json");
const COMMON = ("milk eggs bread butter cheese yogurt rice pasta flour sugar salt pepper oil olive coffee tea juice water apples bananas oranges lemons limes grapes berries strawberries tomatoes potatoes onions garlic carrots lettuce spinach cucumber broccoli peppers mushrooms chicken beef pork fish salmon tuna bacon ham turkey beans lentils cereal oats honey jam peanut cereal soap shampoo toothpaste detergent paper towels toilet tissue napkins foil wrap bags batteries diapers wipes dog cat food litter ice cream chips crackers cookies soda beer wine ketchup mustard mayo sauce soy vinegar spices cinnamon basil avocado papaya mango melon hamburger ground sausage tofu noodles bagels tortillas lightbulbs sponges trash").split(" ");
const now = () => new Date().toISOString();

function load() {
  try { return JSON.parse(fs.readFileSync(FILE, "utf8")); }
  catch { return { items: [], reminders: [], log: [], seen: {} }; }
}
let db = load();
function save() { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(db, null, 2)); }
function log(by, action, detail, undo) { db.log.push({ id: randomUUID().slice(0, 8), at: now(), by, action, detail, undo }); }

// Plausibility: every word should look like a household word (misheard "papaya talons" gets flagged).
function plausibility(name) {
  const words = name.toLowerCase().replace(/[^a-z ]/g, "").split(/\s+/).filter(Boolean);
  if (!words.length) return 0;
  const hit = words.filter(w => COMMON.includes(w) || COMMON.includes(w.replace(/s$/, ""))).length;
  return hit / words.length;
}
function find(name) {
  const n = name.toLowerCase().trim();
  return db.items.find(i => i.name.toLowerCase() === n && !i.done);
}

export function addItems({ items, by = "someone", heard }) {
  const out = [];
  for (const it of items) {
    const qty = it.qty ?? 1, unit = it.unit || "";
    const ex = find(it.name);
    if (ex && ex.unit === unit) {
      const before = ex.qty; ex.qty += qty; ex.history.push({ at: now(), by, delta: qty });
      log(by, "increase", `${it.name} ${before}->${ex.qty}${unit}`, { type: "setQty", id: ex.id, qty: before });
      out.push({ ...ex, merged: true });
      continue;
    }
    const p = plausibility(it.name);
    const rec = { id: randomUUID().slice(0, 6), name: it.name, qty, unit, addedBy: by, addedAt: now(), heard: heard || null,
      needsConfirmation: p < 1, done: false, history: [{ at: now(), by, delta: qty }] };
    db.items.push(rec);
    log(by, "add", `${qty}${unit} ${it.name}`, { type: "delete", id: rec.id });
    out.push(rec);
  }
  save();
  return { added: out, flagged: out.filter(o => o.needsConfirmation).map(o => ({ id: o.id, name: o.name, addedBy: o.addedBy, heard: o.heard })) };
}

export function adjustItem({ name, delta, by = "someone" }) {
  const it = find(name);
  if (!it) return { error: `"${name}" is not on the list` };
  const before = it.qty; it.qty = Math.max(0, +(it.qty + delta).toFixed(3));
  it.history.push({ at: now(), by, delta });
  if (it.qty === 0) it.done = true;
  log(by, delta < 0 ? "decrease" : "increase", `${name} ${before}->${it.qty}${it.unit}`, { type: "setQty", id: it.id, qty: before });
  save();
  return { item: it, removedEntirely: it.qty === 0 };
}

export function removeItem({ name, by = "someone" }) {
  const it = find(name);
  if (!it) return { error: `"${name}" is not on the list` };
  it.done = true; log(by, "remove", it.name, { type: "restore", id: it.id }); save();
  return { removed: it };
}

export function confirmItem({ id, correctedName, by = "someone" }) {
  const it = db.items.find(i => i.id === id);
  if (!it) return { error: "unknown id" };
  const old = it.name; if (correctedName) it.name = correctedName; it.needsConfirmation = false;
  log(by, "confirm", correctedName ? `${old} => ${correctedName}` : old, { type: "rename", id, name: old, flag: true }); save();
  return { item: it };
}

export function listItems({ includeDone = false } = {}) {
  const items = db.items.filter(i => includeDone || !i.done);
  return { count: items.length, items: items.map(({ history, ...r }) => r) };
}

export function addReminder({ text, at, kind = "reminder", by = "someone", forWhom }) {
  const r = { id: randomUUID().slice(0, 6), text, at, kind, by, forWhom: forWhom || by, createdAt: now(), status: "scheduled" };
  db.reminders.push(r); log(by, "schedule", `${kind}: ${text} @ ${at}`, { type: "dropReminder", id: r.id }); save();
  return { reminder: r };
}

// Fire everything due. Reminders archive after announcing (they never pile up as "overdue");
// tasks stay open until someone completes them.
export function tick({ asOf } = {}) {
  const t = asOf ? new Date(asOf) : new Date();
  const announced = [];
  for (const r of db.reminders) {
    if (r.status !== "scheduled" || new Date(r.at) > t) continue;
    if (r.kind === "reminder") r.status = "announced"; else r.status = "open";
    announced.push(r);
  }
  save();
  return { announced, openTasks: db.reminders.filter(r => r.status === "open") };
}

export function completeTask({ id, by = "someone" }) {
  const r = db.reminders.find(x => x.id === id);
  if (!r) return { error: "unknown id" };
  const prev = r.status; r.status = "done"; r.doneBy = by;
  log(by, "complete", r.text, { type: "status", id, status: prev }); save();
  return { task: r };
}

export function listReminders() {
  return { reminders: db.reminders.filter(r => r.status === "scheduled" || r.status === "open") };
}

export function undoLast({ by = "someone" }) {
  const e = [...db.log].reverse().find(x => x.undo && !x.undone);
  if (!e) return { error: "nothing to undo" };
  const u = e.undo, it = db.items.find(i => i.id === u.id), r = db.reminders.find(i => i.id === u.id);
  if (u.type === "delete") db.items = db.items.filter(i => i.id !== u.id);
  if (u.type === "setQty" && it) { it.qty = u.qty; it.done = false; }
  if (u.type === "restore" && it) it.done = false;
  if (u.type === "rename" && it) { it.name = u.name; it.needsConfirmation = u.flag; }
  if (u.type === "dropReminder") db.reminders = db.reminders.filter(i => i.id !== u.id);
  if (u.type === "status" && r) r.status = u.status;
  e.undone = true; log(by, "undo", `${e.action}: ${e.detail}`); save();
  return { undone: e };
}

// Cross-session context: what changed since this person last asked.
export function whatChanged({ who }) {
  const since = db.seen[who] || "1970-01-01";
  const changes = db.log.filter(e => e.at > since && e.by !== who);
  db.seen[who] = now(); save();
  return { who, since, changes: changes.map(({ undo, ...e }) => e), flagged: db.items.filter(i => i.needsConfirmation && !i.done) };
}

export function reset() { db = { items: [], reminders: [], log: [], seen: {} }; save(); }

// Read-only snapshot for the simulator's Echo-Show card (includes archived reminders).
export function snapshot() {
  return { items: db.items.filter(i => !i.done).map(({ history, ...r }) => r), reminders: db.reminders.map(r => ({ ...r })) };
}
