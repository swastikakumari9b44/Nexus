# NEXUS — Technical Interview Guide

Written from the source in this repository (file references in brackets). Anything I could not establish from the code is marked **[VERIFY]** — check it yourself before stating it in an interview. Do not claim things marked "unverified".

---

## 1. 60-second introduction

NEXUS is a stateful assistant for an HR scenario. It does two things in one conversation: it answers questions about an Employee Handbook PDF with page citations (RAG), and it books a "Performance Review" appointment through a multi-turn flow that collects name and email, offers slots, asks for confirmation and writes the booking to SQLite.

The interesting part is that the two interleave. If you ask a handbook question in the middle of a booking, it answers with a citation and then returns to the booking where you left off.

It is a LangGraph `StateGraph` with typed state and a SQLite checkpointer, behind FastAPI, with a React/Vite UI. I made one deliberate design choice: **everything transactional is deterministic code** (rule-based turn analysis, validators, a SQLite service). The LLM is used only to phrase grounded answers in the RAG node, so it cannot be talked into booking, double-booking or skipping confirmation.

## 2. 3-minute architecture walkthrough

1. **React UI** (`frontend/src`) generates a thread UUID (kept in `localStorage`, `lib/thread.ts`), and for each user message sends `POST /api/chat/stream` with `thread_id`, `message` and a `client_message_id`.
2. **FastAPI** (`backend/app/api/routes/api.py`) takes a per-thread `asyncio.Lock`, checks whether that `client_message_id` was already answered (idempotent retry), then runs the compiled graph with `configurable.thread_id`.
3. **Graph** (`graph/builder.py`): `router → (rag | booking | clarify | finalize)`, `rag → (booking | finalize)`, `booking → finalize`, `clarify → finalize`, `finalize → END`. The graph is acyclic inside a turn.
4. **Router** runs `analyze_turn` (`graph/nlu.py`): regex/rule-based extraction of question text, booking intent, name, email, slot choice, yes/no, cancel, and an injection/leak flag.
5. **RAG node** retrieves from Chroma, asks the answerer for a grounded reply, then `validate_citations` strips any citation that was not actually retrieved.
6. **Booking node** is a small state machine over `collecting → awaiting_slot → awaiting_confirmation → confirmed/cancelled`. It only calls `BookingService.book()` after an explicit yes.
7. **Finalize** joins `reply_parts` into one `AIMessage` carrying citations/trace/intent in `additional_kwargs`.
8. **Persistence:** the AsyncSqliteSaver checkpointer stores conversation + booking draft per thread; a separate SQLite file stores confirmed bookings. Both live under `backend/data/` (git-ignored, regenerated).
9. The response (`ChatResponse`) goes back as the SSE `final` event; the UI renders the reply, citations (source drawer) and the booking panel.

## 3. LangGraph: nodes, edges, state, checkpointing

**Nodes** (`graph/builder.py`): `router`, `rag`, `booking`, `clarify`, `finalize`.

**Edges / conditional routing** (`graph/routing.py`):
- `after_router`: if `turn.blocked` → `booking` when a booking is active else `finalize`; elif there is a question → `rag`; elif booking active or start_booking → `booking`; else `clarify`.
- `after_rag`: → `booking` if a booking is active or a booking was requested this turn, else `finalize`.

**State** (`graph/state.py`): `AgentState` is a `TypedDict(total=False)`. Only `messages` has a reducer (`add_messages`, which de-duplicates by message id). The rest (`turn`, `booking`, `citations`, `reply_parts`, `trace`, `error`, `reply`, …) is last-write-wins. `BookingDraft` holds `status`, `name`, `email`, `offered_slot_ids`, `slot_id`, `reference`, `booking`, `last_error`. `booking` (the persisted record) is set only after the DB transaction succeeds.

**Checkpointing** (`persistence/checkpointing.py`): `AsyncSqliteSaver.from_conn_string(path)` opened once for the app lifetime; the graph is compiled with `checkpointer=...`. State is saved per `thread_id`, so a server restart or page refresh resumes the same booking. `GET /api/threads/{id}` reads the checkpoint to restore the UI.

## 4. Context interleaving, step by step

Example from `scripts/demo_dialogue.py` (I re-ran this against a fresh clone during the audit; output matched):

1. User: "I need to book a performance review" → router sets `start_booking`; `after_router` → `booking`; draft becomes `collecting`; reply asks for name + email.
2. User: "Alex Chen (alex.chen@example.com). Wait, how often are performance reviews conducted?" → `analyze_turn` extracts **name, email and a question** in the same message.
3. `after_router`: a question exists → `rag` first. RAG answers with `[Source: employee_handbook.pdf, page 4]` and appends it to `reply_parts`.
4. `after_rag`: booking is active → `booking`. The booking node sees `reply_parts` is non-empty (`interleaved = True`), validates and stores name/email, then offers slots with the lead "Returning to your booking, Alex - available slots:".
5. `finalize` joins both parts into one reply. Trace in the response: `router>rag>booking>finalize`.
6. Because the draft lives in checkpointed state and the RAG node never touches `booking`, the booking is intact. The user continues with "2" → confirmation → "yes" → `book()`.

The key mechanism is that RAG and booking are separate nodes writing separate state keys, with routing deciding to pass through both on one turn.

## 5. RAG pipeline

- **Ingest** (`rag/ingestion.py`, `scripts/ingest.py`): download the PDF (`httpx`, checks `%PDF` header) → `pypdf` per-page text extraction (1-based page numbers; pages with <20 chars skipped; de-hyphenation and whitespace cleanup) → character-window chunks of 800 with 150 overlap, preferring sentence boundaries → embed → Chroma `PersistentClient`, cosine space, deterministic ids (`doc:pNN-cNN`) with `upsert`. Metadata includes page and embedder name; ingesting with a different embedder raises unless `--rebuild`.
- **Embedders** (`rag/embeddings.py`): `fastembed` (`BAAI/bge-small-en-v1.5`, local semantic) or `hash` (offline lexical fallback, not semantic).
- **Retrieve** (`rag/retriever.py`): top-k (default 4) by cosine similarity, filtered by a per-embedder floor (0.07 for hash — calibrated; 0.40 for fastembed — **uncalibrated guess**). Stale Chroma handles are reopened once.
- **Answer** (`llm/answerers.py`): `dev` extractive answerer (no LLM), or Groq/Gemini via `httpx`. The prompt puts passages in a `<context>` block and tells the model they are untrusted data.
- **Cite:** `validate_citations` keeps only `[Source: x, page N]` markers that match a retrieved (source, page); fabricated markers are dropped; if none are valid, the top passage is cited. When several chunks share a page, the chunk best matching the cited text is chosen (this fixed a real bug, see §12).
- **No evidence:** an `INSUFFICIENT` signal or empty retrieval gives a "couldn't find that in the handbook" fallback rather than a guess.

## 6. Why SQLite

Zero-infrastructure, durable, transactional, and reproducible from a fresh clone (no service to run). LangGraph ships an SQLite checkpointer, and the booking service needs real transactions and a unique index. Trade-off: single-node. The per-thread lock is in-process (`ThreadLocks`), so multiple workers would need a distributed lock and probably a Postgres checkpointer (README lists this as future work). SQLite WAL is enabled for the bookings DB (`PRAGMA journal_mode=WAL`). **[VERIFY]** whether the checkpointer DB also uses WAL — I did not check the library defaults.

## 7. Idempotency, transactions, retries, conflicts

(`services/booking_service.py`)
- `book()` validates name/email, then runs `BEGIN IMMEDIATE` (takes the write lock up front).
- **Idempotency key** = SHA-256 of `thread_id|slot_id|email|appointment_type`, stored in a `UNIQUE` column. If a confirmed row with that key exists, it returns it with `created=False` (the UI says "already confirmed earlier – no duplicate").
- **Conflict:** if the slot is already confirmed → `SlotUnavailable`. A **partial unique index** `uq_confirmed_slot ON bookings(slot_id) WHERE status='confirmed'` is the final backstop; an `IntegrityError` is converted to `SlotUnavailable` after rollback. The booking node then says nothing was booked and re-offers fresh slots.
- **Unknown outcome:** if `book()` raises an unexpected exception, the node calls `find_by_key` to ask the database whether the commit actually happened, rather than guessing. If found → confirmed; if not → stays in `awaiting_confirmation` and tells the user retrying is safe.
- **Retries:** there is **no automatic retry/backoff** in the server code (I found none in the LLM client either). Retries are client-driven and safe because of (a) `client_message_id` dedup in the API (`find_processed`) and (b) the booking idempotency key. The UI's retry reuses the same `client_message_id` (`useChat.ts`).
- Reference ids are `REV-` + 6 chars from an unambiguous alphabet via `secrets.choice`, collision-checked in-transaction.

## 8. How FastAPI talks to React

JSON over HTTP: `POST /api/chat`, `POST /api/chat/stream` (SSE), `GET /api/threads/{id}`, `GET /api/slots`, `GET /api/bookings/{ref}`, `GET /api/health`. Pydantic schemas are in `schemas/api.py`. In dev, Vite proxies `/api` to port 8000; CORS origins come from `CORS_ORIGINS`. The frontend uses `fetch` with `res.body.getReader()` for the stream (`lib/api.ts`), not `EventSource` (POST body is needed). Errors: 413 for long messages / oversized bodies, 422 for a non-UUID thread id, 504 on a 90-second turn timeout, 404 for unknown bookings.

## 9. SSE status events

`/api/chat/stream` runs `graph.astream(..., stream_mode="updates")` and emits one `node` event as each node completes, then one `final` event with the same payload as `POST /api/chat`; or an `error` event on timeout/exception.

**What it gives:** real backend progress (which node just finished) for the loading indicator.
**What it does not give:** token streaming (the answer arrives whole in `final`), progress *within* a node, or delivery guarantees. A dropped connection can happen after the booking commits, so the UI reconciles with `GET /api/threads/{id}` instead of declaring failure (`useChat.ts: reconcile`).

## 10. Prompt injection, unsafe rendering, thread isolation

- **Injection / leakage:** `LEAK` regex in `nlu.py` flags attempts to reveal system prompts, keys, env vars, or "ignore previous instructions"; the router replies with a refusal and routes around RAG. Retrieved text is delimited as untrusted data in the prompt. **This is heuristic, not a guarantee** (README says so). More important structurally: booking decisions never go through the LLM, so injection cannot create or alter a booking.
- **Unsafe rendering:** `MessageBubble.tsx` uses `react-markdown` without `rehype-raw` and no `dangerouslySetInnerHTML` anywhere in `frontend/src` (I grepped), so raw HTML in model/PDF text is escaped.
- **Thread isolation:** state is keyed by `thread_id` in the checkpointer; `thread_id` must be a UUID (`validate_thread_id`); a per-thread lock serialises turns. `GET /api/bookings/{ref}` masks email and shortens the name, since there is no auth. **There is no authentication**, so anyone who knows a thread UUID can read that thread — UUIDs are the only barrier. Say this plainly.

## 11. What is tested, mocked, unverified

Measured in the audit (Linux, Python 3.12.3, Node 22):

| Area | Result |
|---|---|
| Backend offline | 119 passed, 2 skipped |
| Backend with `RUN_NETWORK_TESTS=1` | 121 passed (includes real handbook ingest, page 4 citation, full booking scenario) |
| Browser (Playwright, Chromium 131 on Linux) | 19 passed, exit 0, 2.6 min — real backend, hash embedder, dev (extractive) answerer |
| Frontend | strict `tsc` clean; 21 Vitest tests pass; production build OK |
| Fresh clone | install, ingest (hash embedder), serve, demo dialogue all worked |

**Mocked:** Groq/Gemini via `httpx` mock transports; the clock is injected; the hash embedder and dev answerer are used in E2E and most tests.
**Unverified:** `fastembed` embeddings and its threshold (model download blocked), real Groq/Gemini answers (no credentials, hosts unreachable), anything on Windows/macOS/Firefox/Safari/real phones. The E2E suite exercises integration behaviour, not LLM answer quality. These are also listed as unverified in the README.

## 12. Five genuine bugs (from the README's AI Engineering Log)

1. **State overwrite across nodes (#2).** The booking node reset `error = None`, erasing the RAG node's `llm_unavailable` flag when both ran in one turn. Found by `test_llm_outage_degrades_and_keeps_booking`; fixed by initialising from `state.get("error")`. A last-write-wins pitfall.
2. **Green synthetic test, wrong real answer (#3).** The extractive answerer passed its fixture but answered "how often are reviews conducted?" with an unrelated tied sentence on the real PDF. Found by replaying the dialogue against the real handbook; fixed with question-type cues and a real-PDF regression test.
3. **Header-only size limit (#11).** The body limit trusted `Content-Length`; a chunked upload bypassed it. Fixed with a byte-level check, and the 413 is sent from the middleware because FastAPI turned a body-read exception into a 400 (#10).
4. **Optimistic UI failure (#12).** The UI declared a turn failed on any dropped stream, which can contradict a completed server-side booking. Fixed with server reconciliation.
5. **Citation → chunk mapping (#14).** Retrieved passages were keyed by (source, page), so two chunks on one page collapsed and the source panel showed text the answer never used. Unit fixtures had one chunk per page; the first browser run exposed it; fixed test-first.

## 13. Trade-offs, limitations, future work

- Rule-based NLU is predictable and testable but English-only and brittle to unusual phrasing.
- Heuristic injection filter; no auth or rate limiting; single-process lock.
- `hash` embedder is lexical: the evaluation (15 answerable + 7 out-of-scope) showed 4 wrongly declined answerable questions. `fastembed` and LLM configurations are not evaluated.
- Only the Employee Handbook is ingested, not the secondary benefits PDF.
- No token streaming, no Docker (both deliberate scope decisions).
- Future: calibrate `fastembed` threshold, LLM-assisted intent behind deterministic validators, Postgres checkpointer, auth, cancel/reschedule endpoints.

## 14. Fifteen likely questions

1. **Why LangGraph rather than a plain function?** It gives explicit nodes and conditional edges, typed state, and a checkpointer for durable per-thread state. The routing is inspectable (`trace` is returned in every response).
2. **How does the graph avoid loops?** Routing functions only go forward and every path ends at `finalize → END`; the graph is acyclic within a turn.
3. **Why a reducer only on `messages`?** `add_messages` appends and de-duplicates by id. Other keys are each written by one node per turn, so last-write-wins is safe — except where a later node can overwrite an earlier one, which caused bug #1.
4. **How does a booking survive a restart?** The draft is in the SQLite checkpoint for the thread id; the confirmed row is in the bookings DB. The E2E restart spec (backend SIGKILLed mid-booking; passed in the final audit run) and a backend restart test cover it.
5. **How do you prevent double booking?** Idempotency key, an in-transaction availability check under `BEGIN IMMEDIATE`, and a partial unique index as backstop.
6. **What if the response is lost after commit?** The client retries with the same `client_message_id`; the API returns the stored answer. Inside the graph, `find_by_key` checks the DB after an unexpected error.
7. **Why not let the LLM drive booking via tool calls?** Determinism and testability: confirmation can't be skipped by wording, and every transition is unit-testable. Cost: brittle NLU.
8. **How are citations kept honest?** Markers are validated against retrieved (source, page); invalid ones are removed; if none remain, the top passage is cited. This guarantees the cited page was retrieved, not that the model's claim is faithful to it.
9. **How do you handle out-of-scope questions?** A similarity floor plus a coverage gate in the extractive answerer; on failure it declines. For LLM mode the model is told to emit an insufficiency marker.
10. **Why chunk by characters?** Simple, deterministic and page-preserving (chunks never cross pages, so page citations are exact). Trade-off: may split mid-topic; overlap mitigates.
11. **Why SSE over WebSocket?** One-way server-to-client progress, plain HTTP, easy to proxy. It reports node completion only.
12. **Why `fetch` streaming rather than `EventSource`?** `EventSource` is GET-only; this needs a POST body.
13. **How do you handle concurrent messages in a thread?** A per-thread `asyncio.Lock`; valid for one worker only.
14. **What are the security gaps?** No auth, heuristic injection defence, UUID-only thread access, dependency advisories noted in README (chromadb server-mode, npm dev tooling).
15. **What would you do next?** Calibrate/evaluate fastembed and a real LLM end to end, add auth + per-user bookings, a distributed lock/Postgres checkpointer, and run the browser suite across browsers.

## Things to verify yourself before the interview

- Run the fastembed evaluation and a real Groq/Gemini smoke test on your machine (commands in `docs/FINAL_SUBMISSION_CHECKLIST.md`); re-run Playwright on Windows if you want to claim Windows support.
- Whether the checkpointer SQLite DB uses WAL **[VERIFY]**.
- Exact SSE parsing/abort behaviour in `frontend/src/lib/api.ts` beyond `getReader` **[VERIFY]**.
- Real Groq/Gemini model ids still current.
