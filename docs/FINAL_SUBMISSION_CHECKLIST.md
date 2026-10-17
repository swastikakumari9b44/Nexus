# NEXUS — Final Submission Checklist

Status legend: **AUTO** = automated-test verified · **BROWSER** = verified in real Chromium (Playwright) · **MANUAL** = run and observed by hand · **UNVERIFIED** = not executed.
Verification environment: Linux sandbox, Python 3.12.3, Node 22, run on 17 Oct 2026 UTC (= 18 Oct 2026 IST; file names use the IST date). **Nothing was run on Windows or macOS.** Not production-ready: no auth, no rate limiting, single-process locking.

## 1. Environment setup
Prerequisites: Python 3.10+ (tested 3.12), Node 18+ (tested 22), internet for first ingestion (PDF download; Hugging Face for fastembed).

```powershell
# Windows PowerShell — backend
cd backend
py -3 -m venv .venv
.venv\Scripts\Activate.ps1          # if blocked: Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
pip install -r requirements.txt
pip check
Copy-Item ..\.env.example .env      # edit .env; never commit it
python -m scripts.ingest --download --rebuild
```
Provider variables are in `.env.example`. Defaults: `LLM_PROVIDER=dev`, `EMBEDDING_PROVIDER=fastembed`. If the model download fails, set `EMBEDDING_PROVIDER=hash` and re-run ingestion with `--rebuild`. Keys (`GROQ_API_KEY`/`GEMINI_API_KEY`) go only in `backend/.env`.

## 2. Startup
```powershell
# window 1 (backend, venv active)
cd backend; uvicorn app.main:create_app --factory --port 8000
# window 2 (frontend)
cd frontend; npm ci; npm run dev            # http://localhost:5173
# verify
Invoke-RestMethod http://127.0.0.1:8000/api/health
cd backend; python -m scripts.demo_dialogue
```
Note: the entrypoint is `app.main:create_app --factory`. `app.main:app` does not work.
Status: backend start + health + demo dialogue **MANUAL** (Linux, hash embedder, dev answerer, fresh clone). `npm run dev` itself was not started; the production build was **BROWSER**-tested via `npm run e2e`.

## 3. Tests and verified results
| Command | Result | Status |
|---|---|---|
| `cd backend; pytest -q` | 119 passed, 2 skipped | AUTO |
| `$env:RUN_NETWORK_TESTS=1; pytest -q` | 121 passed | AUTO |
| `cd frontend; npm run typecheck; npm run typecheck:e2e` | clean | AUTO |
| `npm test` | 21 passed | AUTO |
| `npm run build` | success (306 KB JS, 95 KB gzip) | AUTO |
| `npm run e2e` | 19 passed (Linux, Chromium 131.0.6778.0 via `PW_CHROMIUM_PATH`, 2.6 min, exit 0; log in `docs/verification/`) | BROWSER |
| `npx playwright test e2e/restart.spec.ts e2e/ui.spec.ts -g "SIGKILLed|live node status"` (shell command; run after the Windows harness edits) | 2 passed (Linux) | BROWSER (partial re-run) |
| Same commands on Windows | not run | UNVERIFIED |

## 4. RAG ingestion and evaluation
```powershell
cd backend
python -m scripts.ingest --download --rebuild            # 11 pages -> 27 chunks (observed with hash embedder)
python -m scripts.evaluate --json eval\results_hash_embedder.json
# fastembed (UNVERIFIED — needs Hugging Face access):
$env:EMBEDDING_PROVIDER="fastembed"
python -m scripts.ingest --download --rebuild
python -m scripts.evaluate --json eval\results_fastembed.json   # then set RAG_MIN_SCORE from score_calibration
```
- Hash embedder ingestion: **MANUAL**. Committed hash-embedder evaluation results: from the original build; not regenerated in the final audit.
- fastembed: **UNVERIFIED**. Audit attempt failed with `ValueError: Could not load model BAAI/bge-small-en-v1.5 from any source` (Hugging Face blocked). Its default threshold 0.40 is uncalibrated.

## 5. Real LLM smoke test (UNVERIFIED)
No credentials were configured in the audit environment and the Groq/Gemini hosts were unreachable. Mocked-transport tests are **AUTO**. To check locally:
```powershell
cd backend
$env:LLM_PROVIDER="groq"; $env:GROQ_API_KEY="<your key>"   # or gemini + GEMINI_API_KEY
uvicorn app.main:create_app --factory --port 8000
# other window:
Invoke-RestMethod http://127.0.0.1:8000/api/health        # expect llm_mode = groq
python -m scripts.evaluate --answerer configured
python -m scripts.demo_dialogue                           # answers must lack the "Dev mode" footer
```
Verify the model ids in `.env.example` are still current. Do not paste the key into any tracked file.

## 6. Browser testing
```powershell
cd frontend
npm ci
npx playwright install chromium
$env:NEXUS_PYTHON = (Resolve-Path ..\backend\.venv\Scripts\python.exe).Path
npm run e2e
```
**Chronology:** the original development run used Chromium 153; the first audit pass could not download Playwright's Chromium (so nothing was re-run then); a later audit run used Chromium 131.0.6778.0 extracted from the npm package `@sparticuz/chromium@131` and passed 19/19 (`docs/verification/playwright-linux-2026-10-18.log`). Behind a blocking proxy: `$env:PW_CHROMIUM_PATH="C:\path\to\chromium.exe"`. The run overwrites `docs/screenshots/`; after running, review `git status` and `git checkout -- docs/screenshots` if you want the committed images back. Coverage is Chromium only (BROWSER); Firefox/WebKit/real phone/Windows are UNVERIFIED.

## 7. Screenshots to include (already in `docs/screenshots/`, referenced by README §8)
01 empty state · 02 booking collecting · 03 FAQ mid-booking with citation · 04 source panel · 05 confirmation step · 06 confirmed with reference · 07 restored after refresh · 08 error with retry · 09 recovered after lost response · 10 layouts (desktop/tablet/mobile) · 11 mobile menu · 12 mobile booking drawer. They show a fallback system font (Google Fonts was unreachable when captured).

## 8. GitHub publishing checks
- [ ] Fill the two `TODO (author…)` items in README §10 (other tools; your own observations, including any checkpointer serialization failure you hit). These are the only placeholders left.
- [ ] `git status` — commit `docs/INTERVIEW_GUIDE.md`, `docs/FINAL_SUBMISSION_CHECKLIST.md`, README changes.
- [ ] `git ls-files | Select-String -Pattern "\.env$|\.venv|\.sqlite|node_modules|chroma"` returns nothing. (`.env.example` and `frontend/.env.direct` are intentionally tracked.)
- [ ] `git log --all --oneline -S"AIza"` returns nothing. `-S"gsk_"` will list the 2 commits that contain the **fake** key `gsk_SUPERS…` used by the leak-prevention test in `backend/tests/test_api.py` (and README text about it); that is expected and not a credential.
- [ ] Confirm `backend/.env` is absent from `git status`.
- [ ] Fresh clone smoke: clone to a temp folder, run section 1–3 commands.
- [ ] Confirm the screenshots are the ones you want public (largest is 196 KB).
- [ ] `git remote add origin <url>; git push -u origin main` (no force push).
- If a real key was ever committed: deleting the file is not enough. Revoke/rotate the key first, then (only if you choose) rewrite history with `git filter-repo` and force-push, and treat the old key as compromised. The audit found no such key.

## 9. Remaining limitations
- fastembed and real Groq/Gemini behaviour UNVERIFIED; E2E uses hash embedder + extractive answerer, so LLM answer quality is untested.
- Chromium-only browser coverage; no Windows/macOS execution.
- No authentication or rate limiting; thread UUID is the only access barrier. Per-thread lock is in-process (single worker).
- Injection defence is heuristic. English-only rule-based NLU. Only the Employee Handbook is ingested.
- No token streaming (SSE reports node completion); no Docker.
- Dependency advisories noted in README (chromadb server mode; npm dev tooling).

## 10. Assessment requirement mapping
The original assessment PDF was not available to the audit; this mapping follows the README's description of it.

| Requirement | Implementation | Status |
|---|---|---|
| StateGraph, typed state, conditional routing | `graph/builder.py`, `state.py`, `routing.py` | AUTO |
| Checkpointing by thread_id | `persistence/checkpointing.py` | AUTO + BROWSER (SIGKILL/restart test) |
| Multi-turn booking, transactional persistence | `nodes/booking.py`, `services/booking_service.py` | AUTO + BROWSER + MANUAL |
| Context interleaving | router → rag → booking | AUTO + BROWSER + MANUAL |
| PDF ingestion, retrieval, page citations | `rag/*`, `llm/answerers.py` | AUTO (network tests) + BROWSER; hash embedder only |
| FastAPI endpoints and errors | `api/routes/api.py`, `main.py` | AUTO |
| React UI, threads, loading, error recovery | `frontend/src` | AUTO (21) + BROWSER (19) |
| AI Engineering Log | README §10 | Present; 2 author TODOs remain |
| README, setup, verification artifacts | README, `requirements.txt`, lockfile | MANUAL (fresh clone, Linux) |
| fastembed semantic retrieval; real LLM answers | `rag/embeddings.py`, `llm/answerers.py` | UNVERIFIED |

## 11. Windows verification sequence (UNVERIFIED until you run it)
Nothing in this repository has been executed on Windows. Run this in PowerShell from the repo root and record the outcome; only then may the README say "verified on Windows".
```powershell
python --version; node --version; git --version
# backend
cd backend
py -3 -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt; pip check
$env:EMBEDDING_PROVIDER="hash"        # fastembed needs the Hugging Face download; hash is the offline path
python -m scripts.ingest --download --rebuild
pytest -q                             # expect 119 passed, 2 skipped
$env:RUN_NETWORK_TESTS="1"; pytest -q; Remove-Item Env:RUN_NETWORK_TESTS   # expect 121 passed
# start the server in a second window: cd backend; .venv\Scripts\Activate.ps1; uvicorn app.main:create_app --factory --port 8000
Invoke-RestMethod http://127.0.0.1:8000/api/health
python -m scripts.demo_dialogue       # must print the booking + "Returning to your booking" + a #REV- reference
# frontend
cd ..\frontend
npm ci; npm run typecheck; npm run typecheck:e2e; npm test; npm run build
npx playwright install chromium
$env:NEXUS_PYTHON = (Resolve-Path ..\backend\.venv\Scripts\python.exe).Path
npm run e2e                           # expect 19 passed; includes the SIGKILL/restart test (uses taskkill /T on Windows)
cd ..; git checkout -- docs/screenshots   # e2e overwrites the committed screenshots
```
Things most likely to differ on Windows: the SIGKILL/restart spec (process-tree kill, port 8002 release), pytest temp-directory cleanup of SQLite/Chroma files, console encoding of the middle dot in slot labels (scripts reconfigure stdout to UTF-8), and execution-policy blocking `Activate.ps1`.

## 12. Files to commit (exact set)
```powershell
git status --short
git add README.md frontend/playwright.config.ts frontend/e2e/restart.spec.ts
git add docs/AUDIT_REPORT.md docs/FINAL_SUBMISSION_CHECKLIST.md docs/INTERVIEW_GUIDE.md docs/verification
git status --short          # nothing else should be staged; docs/screenshots must be unchanged
git commit -m "Final audit: docs, verification logs, Windows e2e harness fixes"
git push -u origin main     # normal push only; never --force
```
| File | Why |
|---|---|
| `README.md` | verified-results wording, Playwright chronology, Linux-only qualifiers, AI-log entry 19, TODO markers |
| `frontend/playwright.config.ts` | quote interpreter path (spaces on Windows) |
| `frontend/e2e/restart.spec.ts` | kill the process tree on Windows (`taskkill /T /F`); Linux path unchanged |
| `docs/AUDIT_REPORT.md`, `docs/FINAL_SUBMISSION_CHECKLIST.md`, `docs/INTERVIEW_GUIDE.md` | final documentation |
| `docs/verification/*.log` | evidence for the Linux results (Playwright run; unit/build suites) |

## 13. Windows result record (fill in after you run §11 — until then Windows is UNVERIFIED)
| Command | Expected | Your result |
|---|---|---|
| `pytest -q` (backend) | 119 passed, 2 skipped | |
| `$env:RUN_NETWORK_TESTS="1"; pytest -q` | 121 passed | |
| `npm test` | 21 passed | |
| `npm run build` | success | |
| `npm run e2e` | 19 passed | |
