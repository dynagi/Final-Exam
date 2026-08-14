# SecureAIExam 🛡️

National-scale secure examination platform — eliminates question paper leaks for NEET, UPSC and Board exams by removing every single point of failure.

**Full architecture, flows and threat model:** [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

```
SecureAIExam/
├── mobile/        React Native app (Expo SDK 56) — Teacher, Paper Setter, Admin & Center/Invigilator logins
├── server/        Node.js crypto service — sealing, co-sign, print ceremony, forensics
├── ai-service/    Python FastAPI (uvicorn) — fingerprinting & anomaly detection
├── supabase/      Postgres schema: RLS, hash-chained audit, realtime triggers
├── monitoring/    Prometheus + Grafana stack (optional) — metrics from server/ and ai-service/
└── docs/          Architecture documentation
```

**This build adds:** a redesigned UI with a live **light/dark toggle** (sun/moon icon in every header, persisted), teacher question upload for **both MCQ and theoretical** questions, **PDF question import with NLP** (Claude + offline fallback), a **QR-stamped printable question paper with print preview**, **dynamic exam scheduling** (2–3 daily slots with start/end/duration), and **exam-center custody**: the Admin provisions a **center login** (code + password), copies are allocated centerwise, the **invigilator scans each QR** (camera or paste) which verifies it, clears it from the pending set, and **notifies the Admin in real time**, and any **unscanned copies raise a CRITICAL alert ~20 min before the slot**. All lists (subjects, filters, paper composition) are data-driven — no hardcoded categories.

---

## 1. Supabase setup (one time)

1. Create a free project at [supabase.com](https://supabase.com).
2. Open **SQL Editor** → paste the entire contents of [`supabase/schema.sql`](supabase/schema.sql) → **Run**. (Run once on a fresh project.)
   > **Already ran schema.sql before?** Run, in order, [`supabase/patch-1-digest-and-exams.sql`](supabase/patch-1-digest-and-exams.sql) (fixes the `digest()` sealing error + adds exam categories), [`supabase/patch-2-question-types.sql`](supabase/patch-2-question-types.sql) (MCQ **and** theoretical question types, per-question marks, PDF-sourced questions), [`supabase/patch-3-centers-and-scan.sql`](supabase/patch-3-centers-and-scan.sql) (exam centers, per-copy allocation, invigilator scan-in, pre-exam reconciliation), [`supabase/patch-4-slots-and-invigilator.sql`](supabase/patch-4-slots-and-invigilator.sql) (dynamic exam slots + the invigilator/center login role), [`supabase/patch-5-exam-formats.sql`](supabase/patch-5-exam-formats.sql) (exam formats per year, blueprint sections on questions, numerical/MSQ question types, teacher subject assignment, and the preview-before-encryption gate), [`supabase/patch-6-paper-sets.sql`](supabase/patch-6-paper-sets.sql) (Admin-controlled paper sets, an unlimited question bank, and cross-set question uniqueness), [`supabase/patch-7-qr-watermark.sql`](supabase/patch-7-qr-watermark.sql) (per-copy trace code), and [`supabase/patch-8-qr-detections.sql`](supabase/patch-8-qr-detections.sql) (frame-level QR watermark security events). All are idempotent.
   > The crypto service checks all of these at boot and prints exactly which are missing, so start it once and read the log if anything looks wrong. *(patch-4 adds an enum value — if Supabase complains about "unsafe use of new value of enum type", run that first `ALTER TYPE` line on its own, then the rest.)*
3. From **Project Settings → API**, note three values:
   - Project URL
   - `anon` public key
   - `service_role` secret key

## 2. Node crypto service

```powershell
cd server
copy .env.example .env     # then edit .env with your URL, service_role key, and a random SERVER_SECRET
npm install
npm start                  # -> listening on http://0.0.0.0:4000
```

> Optional: set `DETECTOR_KEY` in `server/.env` to let an unattended monitoring
> client post QR sightings with an `x-detector-key` header instead of a
> user session. `DETECTION_DEDUP_SEC` (default 120) is how long repeat sightings
> of the same code by the same scanner fold into one event.
>
> This service owns the examination format catalogue
> ([`server/src/examFormats.js`](server/src/examFormats.js)) and enforces it. Scheduling an
> exam, adding questions, composing a draft, previewing it and sealing it all go through it,
> so it must be running for those steps — a client cannot write a paper that breaks its
> exam format even by calling Supabase directly.

## 3. Python AI service (now required for PDF question import)

Requires Python 3.10+ (install from [python.org](https://python.org) if needed).

```powershell
cd ai-service
pip install -r requirements.txt
# Optional — enables Claude-powered PDF parsing (hybrid). Without it,
# the service uses its built-in offline rule-based parser automatically.
$env:ANTHROPIC_API_KEY = "sk-ant-..."
uvicorn main:app --host 0.0.0.0 --port 8080
```

This service now does three things: per-copy fingerprinting, custody anomaly scoring, **and** NLP question extraction from uploaded PDFs (`POST /extract/questions`).

> **Hybrid NLP:** with `ANTHROPIC_API_KEY` set, PDFs are parsed by Claude (model overridable via `AI_EXTRACT_MODEL`, default `claude-sonnet-4-6`); on any failure or with no key, it falls back to an offline regex/heuristic parser — so PDF import always works.
> If the AI service is offline entirely, fingerprinting falls back to local HMAC, but PDF import is unavailable (manual question entry still works).

## 4. App (mobile + web)

1. Edit [`mobile/src/lib/config.ts`](mobile/src/lib/config.ts):
   - `SUPABASE_URL` and `SUPABASE_ANON_KEY` from step 1
   - `CRYPTO_SERVER_URL` (the web browser case is picked automatically via `Platform.OS`):
     | Where the app runs | Value |
     |---|---|
     | Web browser | `http://localhost:4000` (automatic) |
     | Android emulator | `http://10.0.2.2:4000` |
     | iOS simulator | `http://127.0.0.1:4000` |
     | Physical phone (Expo Go) | `http://<your PC's LAN IP>:4000` (run `ipconfig`) — phone and PC on the same Wi-Fi |

2. Run it:

```powershell
cd mobile
npm install        # already done if you used the setup script
npx expo start     # scan the QR with the Expo Go app, or press "w" for the browser
```

   Or go straight to the web version:

```powershell
npx expo start --web    # opens http://localhost:8081 in your browser
```

   For a production web build: `npx expo export --platform web` outputs a static site to `mobile/dist/` that any static host (Vercel, Netlify, nginx) can serve.

> **Web tip:** two roles side by side is easy in the browser — open one of them in an incognito window so the sessions don't share storage.

---

## 5. Demo walkthrough (the full leak-proof lifecycle)

Create three accounts from the app's **Create account** screen (use the role tabs):

| Role | Example email |
|---|---|
| Teacher | teacher@demo.in |
| Paper Setter | setter@demo.in |
| Admin | admin@demo.in |

> **Invigilator / center accounts are not self-signup** — the Admin creates them in the *Centers* tab (code + password), and the invigilator signs in via the **"Exam center / invigilator login"** link.

Then run the lifecycle — ideally with two devices/emulators side by side to see the realtime updates:

1. **Admin** → *Exams* → **Create Exam** → pick an **exam format and year** from the dropdown (e.g. *JEE Main — Paper 1 2026*, or its 2027 carry-forward). The predefined structure loads immediately — sections, subjects, questions per section, question types, marks per correct answer, negative marking, unattempted marks, total marks and duration. Set the **number of paper sets** (`4` → Set A, B, C, D) and whether questions may be reused across them (off by default). Confirm the name, date and 2–3 daily slots (slot lengths are pre-filled from the format's duration). **Manage paper sets** on the exam card raises or lowers the count later — sealed sets can never be dropped. Optionally use **Assign subjects to teachers** to restrict who may write for which subject. *(Teacher/Setter screens unlock live.)*
2. **Teacher** → *Upload* tab. The **Subject dropdown comes from the selected exam format** (narrowed to your assigned subjects, if any). Picking a section quota fixes the question type and marks — you cannot change the format's marking scheme — and **each slot is capped at twice what the exam consumes** (`max per paper × paper sets × 2`), so there is room to choose between questions without the bank growing without bound. The meters show bank depth against what all the sets together need, plus that ceiling (`Physics · MCQ · 4 marks 63/80 · ceiling 160`); a full slot stops accepting uploads until someone withdraws one. Two modes feed the same secure bank:
   - **Type one** — write the question (MCQ, MSQ, numerical or subjective, per the format) and submit. *(Setter's bank updates live.)*
   - **Import PDF** — choose a PDF → the AI service runs NLP and returns structured questions → review, deselect any, and bulk-import into the chosen quota.
   *Withdraw* a question from *My Questions* to take one back out of the bank.
3. **Paper Setter** → *Compose* → pick the exam → **pick a paper set** (Set A…) → title + select questions (or **Auto-fill**). Each set is an independent paper: bank items already committed to another set show **"Already used in Set A"** and cannot be picked, and a section that has reached its quota stops accepting more (`Maximum questions reached`). The per-section meters must all read `✓` before **Preview Paper** enables. The preview shows the **exact final paper** in the standard exam skeleton — header, duration/marks/paper-set strip, candidate block, instructions, subject sections split into `Section A — MCQ` / `Section B — Numerical Value`, continuous numbering, per-question marks and negatives. Press **← Back to Edit**, or **Confirm & Encrypt Paper** → enter a setter passphrase (≥8 chars — remember it!). That set goes to `SEALED (1/2)`; switch to Set B and repeat. The *Dashboard* tab shows every set's completion at a glance.
4. **Admin** → *Papers* → **Co-sign** → enter an admin passphrase. *(Watch the setter's My Papers flip to `DUAL-SEALED` in real time.)* From this moment, nobody can decrypt the paper alone.
5. **Admin** → *Papers* → **Print Ceremony** → enter **both** passphrases + copy count. Each copy is minted with a signed QR + invisible fingerprint, and its chain of custody opens. The decrypted paper then opens in the **Print Preview** tab: a fully rendered, per-copy question paper with its signed **QR code** printed in the header — hit **Print this copy** (browser print on web, native print/share-as-PDF on mobile).
6. **Admin** → *Centers* → pick the exam → **Add Center** (name, **login code**, **password**, and which **slot** it runs — for the demo pick a slot starting ~25 min ahead). This **provisions a center login account**. Then **Allocate copies** to that center: those copies' QRs become center-wise in the database. *(Save the code+password shown — they're the invigilator's login.)*
7. **Center / invigilator login:** sign out → on the login screen tap **"Exam center / invigilator login"** → enter the **center code + password**. The center app is a single **Scan-in** screen: scan each paper's QR with the camera (native) or paste the QR payload (web). Each scan is signature-verified (forged QRs rejected), the copy leaves the pending list (`scanned_at` set — row preserved for the custody chain), and **a real-time notification fires to the Admin dashboard** (`COPY_SCANNED`).
8. **The reconciliation alarm:** leave at least one copy **unscanned**. The crypto service sweeps every minute and, ~20 min before the center's slot start, fires a **CRITICAL `UNSCANNED_COPIES` alert** on the Admin dashboard listing how many copies are missing at that center. *(Tune the window with `RECONCILE_WINDOW_MIN`.)*
9. **Admin** → *Custody* → *Copies* → tap a copy → advance it through checkpoints: `Dispatch → Arrive at Center → Deliver to Exam Hall`. *(The Live Feed streams every scan.)*
10. **The money shot:** tap a copy → **Report MISSING** → a CRITICAL alert appears on the Admin dashboard **instantly** via Supabase Realtime.
11. **Admin** → *Audit* → see the hash-chained, tamper-evident record of everything that just happened.

---

## 6. Monitoring (optional): Prometheus + Grafana

Both backend services expose Prometheus metrics at `GET /metrics` — request rate/latency/errors, plus business events (paper sealed/co-signed/printed, copies scanned, CRITICAL unscanned-copy alerts, PDF-extraction engine used, fingerprint ops, custody anomaly scores).

Requires [Docker Desktop](https://www.docker.com/products/docker-desktop/). With the crypto service (step 2) and AI service (step 3) already running natively on your host:

```powershell
cd monitoring
docker compose up -d
```

- **Prometheus** (scrapes `host.docker.internal:4000/metrics` and `:8080/metrics` every 5s): [http://localhost:9090](http://localhost:9090)
- **Grafana**, pre-provisioned with the Prometheus datasource and a "SecureAIExam" dashboard: [http://localhost:3001](http://localhost:3001) (login `admin` / `admin`)

`docker compose down` to stop. This only monitors the Node/Python services — the mobile app and Supabase aren't instrumented.

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Not configured yet" banner on login | Fill in `mobile/src/lib/config.ts` |
| Sign-up fails with "Cannot reach crypto service" | Sign-up goes through the Node server (accounts are created pre-confirmed — no emails, no Supabase mailer rate limit). Start the server first (step 2) |
| "Cannot reach crypto service" | Server running? Correct `CRYPTO_SERVER_URL` for your device type? Windows Firewall may need to allow Node on port 4000 |
| Sealing fails: "function digest(text, unknown) does not exist" | Run [`supabase/patch-1-digest-and-exams.sql`](supabase/patch-1-digest-and-exams.sql) in the SQL Editor (pgcrypto lives in the `extensions` schema; the hash-chain triggers needed it on their search_path) |
| Teacher's Upload tab says "No exams scheduled yet" | By design — the Admin must schedule an exam first (*Exams* tab); questions belong to an exam |
| Exam format dropdown is empty | The catalogue is served by the Node crypto service — start it (step 2) and reopen the dialog |
| "Preview the paper and confirm it before sealing" | Open **Preview Paper**, review it, then **Confirm & Encrypt Paper**. Adding or removing a question clears a previous confirmation on purpose |
| "Maximum questions reached" while selecting | That section of *this set* already holds exactly what the format requires. Deselect one, or switch to another set |
| A bank question shows "Already used in Set A" | Sets must contain different questions. Pick another, or have the Admin enable **Allow question reuse across sets** |
| "Cannot reduce to N sets — Set D has already been sealed" | Sealed sets are immutable. Reduce only to a count that keeps every sealed set |
| Realtime not updating | Ensure the `alter publication supabase_realtime …` lines at the end of `schema.sql` ran without error |
| "This account is registered as X" on login | You picked the wrong role tab — roles are enforced, not cosmetic |

## Security model (demo vs production)

This is a fully working demonstration of the architecture. The honest list of demo simplifications (escrow window, LSB vs DCT watermarking, self-selected roles, plaintext question bank) and their production replacements is in [docs/ARCHITECTURE.md §7](docs/ARCHITECTURE.md).
