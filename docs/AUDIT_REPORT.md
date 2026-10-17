# NEXUS — Final acceptance report

Environment: Linux sandbox, Python 3.12.3, Node 22.22.2, run on 17 Oct 2026 UTC (= 18 Oct 2026 IST; file names use the IST date). **Not Windows. Not production-ready** (no auth/rate limiting; in-process thread lock; heuristic injection defence).

## 1. Actual results (final tree, uncommitted edits included)
Logs: `docs/verification/linux-suites-2026-10-18.log` (pip check, pytest offline/network, type checks, Vitest, build) and `docs/verification/playwright-linux-2026-10-18.log` (19 e2e tests). The fresh-clone run and the 2-spec e2e re-run were observed in the session but have no saved log.
| Check | Result |
|---|---|
| `pip install -r requirements.txt`, `pip check` | OK |
| `pytest -q` | 119 passed, 2 skipped |
| `RUN_NETWORK_TESTS=1 pytest -q` | 121 passed |
| `tsc -b --noEmit`, `tsc -p e2e/tsconfig.json --noEmit` | clean |
| `vitest run` | 21 passed |
| `npm run build` | OK |
| `npm run e2e` (19 tests) | **19 passed**, exit 0, 2.6 min — Chromium 131.0.6778.0 (npm package `@sparticuz/chromium@131`) via `PW_CHROMIUM_PATH`; log: `docs/verification/playwright-linux-2026-10-18.log` |
| e2e re-run after Windows harness edits | only the SIGKILL/restart and live-status specs re-run: 2 passed; full 19 not repeated |
| Fresh clone (temp clone, hash embedder): install, ingest, `uvicorn app.main:create_app --factory`, `demo_dialogue` | worked; booking confirmed with page-4 citation |

## 2. Playwright chronology (reconciled)
1. Original development run (README): 19 passed, Chromium 153, binary supplied via `PW_CHROMIUM_PATH` because Playwright's download was blocked.
2. First audit pass: `npx playwright install chromium` failed (download blocked) → 19 tests **not** re-run; the first report said "NOT RUN".
3. Later audit pass: Chromium 131 extracted from npm; two attempts aborted by the audit's own `pkill -f` killing its shell (not counted); third run complete → 19 passed.
4. Windows-portability edits, then partial re-run (2 specs) on Linux.
The earlier "NOT RUN" statement was true at its time and is superseded by step 3; README, checklist and interview guide now agree with this chronology.

## 3. Documentation inconsistencies found and fixed
- Old AUDIT_REPORT said Playwright "NOT RUN" and the matrix called browser claims unverified → replaced by this report.
- README/checklist said "19 passed" without browser version, date, or the blocked-download history → chronology and log reference added.
- PowerShell `NEXUS_PYTHON` was a relative path → now an absolute `Resolve-Path`.
- Interview guide and checklist wording on Playwright aligned (Linux, Chromium 131).
- README AI log: added entry 19 (audit harness mistakes). Two `TODO (author…)` placeholders remain for you.

## 4. Windows portability findings (nothing executed on Windows)
No hardcoded Linux paths, shell scripts, fork/signal use or `/tmp` assumptions in backend code, scripts or tests; paths use `pathlib`/`tempfile`, SQLite paths are `Path`s, `tzdata` is pinned, scripts force UTF-8 stdout. Two real defects fixed:
- `frontend/playwright.config.ts`: interpreter path in the webServer command was unquoted → breaks if the path contains spaces. Now quoted (Linux run confirmed).
- `frontend/e2e/restart.spec.ts`: `kill("SIGKILL")` on Windows would end only the venv's `python.exe` launcher, leaving the server child holding port 8002. Now `taskkill /T /F` on win32 (Linux branch unchanged and re-tested; the Windows branch is **untested**).
Residual risks: pytest/SQLite/Chroma temp-file cleanup on Windows; `Activate.ps1` execution policy. Exact sequence: `docs/FINAL_SUBMISSION_CHECKLIST.md` §11.

## 5. Security and Git findings
- No `.env`, venv, SQLite DB, Chroma data, PDF, `__pycache__`, `node_modules` or `dist` tracked (0 matches). `.env`, `.env.*` (except `.env.example`), `backend/data/`, `*.sqlite*`, `dist/`, `e2e-results/` are ignored; `!frontend/.env.direct` re-includes the one required file (loopback URL only).
- `.env.example` contains placeholders only.
- Key-pattern scan of tracked files and all 14 commits: no real keys. The only `gsk_` hits are the fake fixture in `backend/tests/test_api.py` (a leak-prevention test) and README text that mentions it.
- History untouched; nothing pushed.
- **Tracking status:** `docs/INTERVIEW_GUIDE.md`, `docs/FINAL_SUBMISSION_CHECKLIST.md`, `docs/AUDIT_REPORT.md`, `docs/verification/`, and the README/e2e edits are **uncommitted**. The ZIP contains `.git` (14 commits) plus these working-tree files, so after unzipping `git status` shows them as changes.

## 6. Remaining unverified
fastembed (download blocked: `Could not load model BAAI/bge-small-en-v1.5 from any source`) and its 0.40 threshold; real Groq/Gemini calls (no credentials, hosts unreachable); anything on Windows/macOS/Firefox/WebKit/real touch devices; the Windows `taskkill` branch; `npm run dev` interactively.

## 7. Requirement checklist (original assessment PDF still not provided — derived from the README's mapping)
| Requirement | Evidence | Status |
|---|---|---|
| LangGraph StateGraph, typed state, conditional routing | `graph/*`, test_graph | AUTO |
| Checkpointing by thread_id | `persistence/checkpointing.py`, restart tests, SIGKILL e2e | AUTO + BROWSER |
| Multi-turn booking, transactional persistence, idempotency | `booking_service.py`, tests, e2e DB check | AUTO + BROWSER |
| Context interleaving | demo run, tests, e2e | AUTO + BROWSER + MANUAL |
| PDF ingestion, vector retrieval, page citations | network tests, e2e | AUTO + BROWSER (hash embedder only) |
| FastAPI endpoints / error handling | test_api | AUTO |
| React UI, threads, loading, error recovery | 21 unit + 19 e2e | AUTO + BROWSER (Chromium/Linux) |
| AI Engineering Log | README §10 | present; 2 author TODOs |
| README, reproducible setup, artifacts | fresh clone | MANUAL (Linux) |
| fastembed semantic retrieval; real LLM answers; Windows | — | UNVERIFIED |
