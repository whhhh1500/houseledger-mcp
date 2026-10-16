# HouseLedger — a shared-household memory for Alexa+ (MCP server)

Alexa+ track · Build, Ship, Shape: Amazon Developer Hackathon 2026.

Families who moved to Alexa+ report three regressions in the most-used household features:
1. **No attribution** – the shared list no longer shows *who added what, when*, so misheard items ("papaya talons" for "paper towels") cannot be traced. ([r/alexa](https://www.reddit.com/r/alexa/comments/1qymofj/why_the_change/))
2. **All-or-nothing edits** – "remove 1 lb of hamburger" removes all 67 lb. (same thread)
3. **Reminders treated as tasks** – every announced reminder piles up as "Overdue". ([r/amazonecho](https://www.reddit.com/r/amazonecho/comments/1vhdev0/alexa_is_putting_every_reminder_into_overdue/))

HouseLedger is a self-hosted **MCP server (spec 2025-11-25, Streamable HTTP, official TypeScript SDK)** that Alexa+ (or any agent) calls to keep household state that is:
- **attributed** – every item stores speaker, timestamp and the raw heard utterance;
- **misheard-aware** – implausible item names are returned as `flagged`, so the agent asks instead of guessing;
- **quantity-precise** – `adjust_item` applies deltas, never wipes a line;
- **reminder ≠ task** – reminders announce once and archive; tasks stay open until completed;
- **undoable** – `undo_last` reverses any change;
- **cross-session** – `what_changed` gives each person a digest of what *others* changed since they last asked.

## Run
Requires Node.js 18+.
```bash
npm install
npm start               # MCP at http://127.0.0.1:8787/mcp ; simulator at http://127.0.0.1:8787/
npm run demo            # scripted MCP client smoke test (no LLM needed; run while the server is up)
```
Environment variables (all optional except for the LLM-driven simulator):

| Variable | Purpose |
|---|---|
| `PORT` | HTTP port (default `8787`) |
| `OPENAI_BASE_URL` (or `LLM_BASE_URL`) | Base URL of any OpenAI-compatible chat API, e.g. `https://api.openai.com/v1` |
| `OPENAI_API_KEY` (or `LLM_API_KEY`) | API key for that endpoint |
| `OPENAI_MODEL` (or `LLM_MODEL`) | Model name with tool-calling support (default `gpt-4o-mini`) |

```bash
OPENAI_BASE_URL=https://api.openai.com/v1 OPENAI_API_KEY=sk-... OPENAI_MODEL=gpt-4o-mini npm start
```
No keys are stored in this repo; the MCP server itself needs no LLM. Household data is kept in `data/ledger.json` (git-ignored).

The simulator (simulated Alexa+ experience) has speaker selection (voice-profile stand-in), mic input (Web Speech API), spoken replies, an Echo-Show-style list card and a live MCP tool trace.

## Tools
`add_items, adjust_item, remove_item, confirm_item, list_items, add_reminder, tick, complete_task, list_reminders, undo_last, what_changed` + resource `houseledger://list`.

## License
MIT

## Submit (Amazon Alexa+ track)
- Deadline: **2026-10-24 03:00 UTC+8** (2026-10-23 12:00 PDT).
- Recording script: [`DEMO_SCRIPT.md`](DEMO_SCRIPT.md)
- Devpost paste copy: [`SUBMISSION_COPY.md`](SUBMISSION_COPY.md)
- Status / remaining browser steps: [`STATUS.md`](STATUS.md)
