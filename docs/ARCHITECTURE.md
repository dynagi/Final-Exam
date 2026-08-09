# SecureAIExam — Real-Time Architecture

A national-scale, end-to-end secure examination platform that eliminates question paper leaks by removing every single point of failure: cryptographic dual control, per-copy forensic identity, real-time chain of custody, and tamper-evident audit logging.

---

## 1. Design Principles

| Principle | Implementation |
|---|---|
| **No single person can access the paper** | Paper is sealed with AES-256-GCM; the key is split into two shares — one held by the Paper Setter, one by the Admin. Both passphrases are required to reconstruct the key. |
| **The exam format is the source of truth** | Every exam is scheduled against a (format, year) pair from the Node service's catalogue. Question counts, types, marks and negative marking come from that blueprint — teachers and setters can fill it, never change it. |
| **Unlimited bank, exact paper** | The question bank has no cap: 500 banked Physics questions for a 25-question section is the intended shape. The limit binds when a *paper set* is composed — exactly the format's count of each type, per set. |
| **Every paper set is an independent paper** | The Admin decides how many sets exist (Set A…Set Z). Each set is composed and validated on its own, and by default no question may appear in two sets. |
| **A paper cannot be encrypted until it is complete and confirmed** | Sealing re-validates the composition against the blueprint and requires a `previewed_at` stamp that a Postgres trigger clears whenever the question list changes. |
| **Every printed copy has a unique identity** | Visible: signed QR payload per copy. Invisible: steganographic fingerprint embedded by the AI service. |
| **Physical custody is tracked in real time** | Every checkpoint scan inserts a `custody_events` row; Supabase Realtime pushes it to the Admin dashboard over WebSockets within milliseconds. |
| **Missing papers trigger instant alerts** | A `missing`/`leaked` custody event fires a Postgres trigger that inserts a `critical` alert, which is streamed live to every Admin device. |
| **Leak source is identifiable from a photo** | AI service extracts the steganographic fingerprint → maps to copy ID → full custody chain shows who held it last. |
| **Accountability can never be disputed** | `audit_log` and `custody_events` are hash-chained (each row's hash covers the previous row's hash) — any tampering breaks the chain. |

---

## 2. System Components

```mermaid
flowchart LR
    subgraph Mobile["React Native App (Expo)"]
        T[Teacher UI]
        S[Paper Setter UI]
        A[Admin UI]
    end

    subgraph Supabase["Supabase (Backend-as-a-Service)"]
        AUTH[Auth - JWT and roles]
        PG[(Postgres + RLS)]
        RT[Realtime - WAL to WebSocket]
    end

    subgraph Node["Node.js Crypto Service (Express)"]
        SEAL[Seal / Co-sign / Print ceremony]
        KEYS[Key split and wrap - scrypt + AES-256-GCM]
    end

    subgraph AI["Python AI Service (FastAPI / uvicorn)"]
        FP[Steganographic fingerprinting]
        ANOM[Custody anomaly detection]
        FOR[Leak forensics - photo to copy ID]
    end

    T -->|upload questions| PG
    S -->|compose drafts| PG
    A -->|manage exams / custody| PG
    Mobile <-->|email+password, JWT| AUTH
    RT -->|live alerts, custody, paper status| Mobile
    S -->|seal request + passphrase| SEAL
    A -->|co-sign / print ceremony| SEAL
    Node -->|service-role writes| PG
    Node -->|register / extract fingerprints| AI
    PG -.->|WAL changes| RT
```

**Why three services?**

- **Supabase** owns identity, data, row-level security, and the realtime fan-out. The mobile app talks to it directly for everything that is safe to do client-side.
- **Node crypto service** owns every operation that must *never* run on a client: key generation, key splitting, share wrapping, decryption ceremonies. It uses the Supabase *service-role* key and writes audit entries for every action.
- **Python AI service** owns the ML/forensics surface: invisible watermark embed/extract and custody anomaly scoring. Isolated so it can scale independently on exam day.

---

## 3. Roles & Access Matrix (enforced by Postgres RLS)

| Capability | Teacher | Paper Setter | Admin |
|---|:---:|:---:|:---:|
| Upload questions (via the service, quota-checked) | ✅ (own) | — | — |
| Withdraw own unused question | ✅ (own) | — | — |
| Choose an exam format + year | — | — | ✅ |
| Decide how many paper sets exist, and the reuse policy | — | — | ✅ |
| Assign subjects to teachers | — | — | ✅ |
| Compose a specific paper set | — | ✅ (own) | — |
| Preview & confirm a paper before encryption | — | ✅ (own) | view only |
| View question pool | own only | ✅ all | ✅ all |
| Approve questions | — | ✅ | ✅ |
| Compose draft papers | — | ✅ (own) | — |
| Seal paper (share 1 of key) | — | ✅ | — |
| Co-sign paper (share 2 of key) | — | — | ✅ |
| Print ceremony (needs BOTH passphrases) | — | participates | ✅ initiates |
| View papers | — | own | ✅ all |
| Manage exams | — | — | ✅ |
| Scan custody checkpoints | — | — | ✅ (invigilators in production) |
| View live alerts / custody / audit log | — | — | ✅ |
| Read sealed paper content | ❌ nobody — requires both passphrases in the print ceremony | | |

---

## 4. Data Model

| Table | Purpose | Realtime? |
|---|---|:---:|
| `profiles` | User → role mapping (`teacher`, `paper_setter`, `admin`), created by trigger on signup | — |
| `questions` | Question bank uploaded by teachers (`submitted → approved → used`), tagged with the blueprint `section_name` it fills | ✅ INSERT |
| `teacher_subjects` | Per-exam subject assignment; restricts a teacher's subject dropdown | ✅ |
| `papers` | One paper per (exam, `set_label`). Lifecycle `draft → sealed → sealed_dual → printed`, plus `previewed_at` (the seal gate) | ✅ UPDATE |
| `paper_questions` | Which questions are in which paper (draft stage) | — |
| `paper_secrets` | Ciphertext + wrapped key shares. **No RLS policies → invisible to all clients; service-role only.** | — |
| `exams` | Exam scheduling, `format_code` + `format_year` + a display copy of the resolved blueprint, `paper_set_count`, `allow_question_reuse` | — |
| `paper_copies` | One row per printed copy: copy number, signed QR payload, fingerprint hash, live status/location | — |
| `custody_events` | Hash-chained checkpoint scans per copy (`printed → in_transit → at_center → delivered`, or `missing`/`leaked`) | ✅ INSERT |
| `qr_detections` | Frame-level watermark sightings: copy, page, frame, when, who saw it, where, confidence, repeat count | ✅ |
| `alerts` | Real-time alerts (severity `info`/`warning`/`critical`) | ✅ INSERT |
| `audit_log` | Hash-chained, append-only record of every sensitive action | — |

---

## 5. Real-Time Architecture

Supabase Realtime tails the Postgres write-ahead log (WAL) and fans out changes over WebSockets. **RLS policies are evaluated per subscriber**, so an Admin's JWT receives alert rows while a Teacher's JWT receives nothing — the security model is identical for REST and realtime.

| Channel | Table / event | Subscriber | Powers |
|---|---|---|---|
| `alerts-admin` | `alerts` INSERT | Admin | Live alert feed on dashboard (missing copy → red banner in <1s) |
| `custody-live` | `custody_events` INSERT | Admin | Live chain-of-custody feed |
| `papers-setter-{id}` | `papers` UPDATE (filtered `setter_id=eq.{id}`) | Paper Setter | Setter sees status flip to *Dual-Sealed* the moment Admin co-signs |
| `questions-pool` | `questions` INSERT | Paper Setter | New teacher uploads appear in the pool live |

---

## 6. End-to-End Flows

### Flow 0 — Exam Format Selection (Admin)

The Node service holds the examination format catalogue
(`server/src/examFormats.js`): sections, subjects, per-type question counts,
marks per correct answer, negative marking, unattempted marks and duration,
resolved per **year** because patterns change between sittings. Years past the
last published notification are carried forward and flagged `provisional`.

```mermaid
sequenceDiagram
    actor Admin
    participant App as RN App
    participant CS as Node Crypto Service
    participant SB as Supabase

    Admin->>App: Create Exam → pick format + year (e.g. "JEE Main 2026")
    App->>CS: GET /api/exam-formats/:code/:year
    CS-->>App: blueprint (sections, quotas, marking, duration)
    Note over App: Structure and duration are shown and pre-filled;<br/>the Admin confirms name, date, slots,<br/>number of paper sets and the reuse policy.
    App->>CS: POST /api/exams { formatCode, formatYear, paperSetCount, … }
    Note over CS: The blueprint is re-resolved from the catalogue —<br/>the client only names the format, never its contents.
    CS->>SB: INSERT exams(format_code, format_year, format_blueprint,<br/>paper_set_count, allow_question_reuse) + exam_slots
    Admin->>CS: later: PATCH /api/exams/:id/paper-sets { paperSetCount }
    Note over CS: Sets can be added or removed until their paper<br/>is sealed; a sealed set can never be dropped.
```

### Flow A — Question Intake (Teacher)

Questions no longer reach Postgres from the client: patch-5 removes the
teacher insert policy, so `POST /api/questions` is the only way in.

**The bank itself is unlimited.** What the service checks is *alignment*, not
volume: a question must name a real section of the format and carry a type and
marks value that section uses, otherwise it could never be selected into a
paper. Banking 500 Physics MCQs for a 25-question section is the intended
shape — the exact-count rule lives on the paper set, not here.

```mermaid
sequenceDiagram
    actor Teacher
    participant App as RN App
    participant CS as Node Crypto Service
    participant SB as Supabase (Postgres+RLS)
    participant Setter as Paper Setter App

    Teacher->>App: Login → pick exam
    Note over App: Subject dropdown = the format's sections,<br/>narrowed to teacher_subjects when assigned.<br/>Type and marks are fixed by the chosen quota.
    Teacher->>App: Write question → Submit
    App->>CS: POST /api/questions { examId, questions }
    CS->>SB: Read exam blueprint + current bank
    Note over CS: Reject: wrong section, wrong type,<br/>wrong marks, quota already full,<br/>unassigned subject
    CS->>SB: INSERT questions (service role)
    SB-->>Setter: Realtime INSERT → question appears in pool live
```

### Flow B — Compose a Set, Preview & Seal (Paper Setter, share 1 of 2)

The setter works **one paper set at a time**. Saving is idempotent per
(exam, set): re-saving Set A rewrites that set rather than piling up
duplicates, so A, B, C… can be built over several sittings.

Encryption has four preconditions, all checked server-side: the set satisfies
the exam format exactly, no question is shared with another set (unless the
Admin allowed it), the setter has confirmed the preview, and the preview is of
*this* question list — a Postgres trigger clears `previewed_at` whenever
`paper_questions` changes.

```mermaid
sequenceDiagram
    actor Setter as Paper Setter
    participant App as RN App
    participant CS as Node Crypto Service
    participant SB as Supabase

    Setter->>App: Pick exam → pick Set B
    App->>CS: GET /api/exams/:id/sets
    CS-->>App: per-set completion + which question belongs to which set
    Note over App: Bank items owned by Set A are marked<br/>"Already used in Set A" and are not selectable.<br/>A section at 25/25 stops accepting more.
    Setter->>App: Select questions (Physics 25/25 ✓ · Chemistry 24/25 ⚠)
    App->>CS: POST /api/papers { examId, setLabel, title, questionIds }
    Note over CS: A draft may be short of the quota, never over it,<br/>never hold a question the blueprint has no slot for,<br/>and never reuse another set's questions.
    CS->>SB: UPSERT papers(set_label, status=draft) + replace paper_questions
    Setter->>App: Preview Paper
    App->>CS: GET /api/papers/:id/preview
    CS-->>App: the exact student-facing document<br/>(sections, sub-sections, final numbering, marks, negatives)
    Setter->>App: Confirm & Encrypt Paper
    App->>CS: POST /api/papers/:id/confirm-preview
    CS->>SB: UPDATE papers SET previewed_at = now() · audit_log
    Setter->>App: Enter Setter passphrase
    App->>CS: POST /api/papers/:id/seal (JWT + passphrase)
    Note over CS: Re-validate composition + reuse · require previewed_at<br/>K = random 256-bit key<br/>ciphertext = AES-256-GCM(paper JSON + rendered view, K)<br/>shareA = random, shareB = K ⊕ shareA<br/>wrap shareA with Setter passphrase (scrypt)<br/>wrap shareB in server escrow (until co-sign)
    CS->>SB: INSERT paper_secrets (no client can ever read)
    CS->>SB: UPDATE papers SET status='sealed' · mark questions 'used' · audit_log
    SB-->>App: Realtime UPDATE → status badge flips to SEALED
    Note over Setter: Switch to Set C and repeat.
```

The rendered document is sealed *inside* the ciphertext, so the copies printed
in Flow D are the same paper the setter confirmed — preview, sealed blob and
print all come from one builder (`buildPaperView`), laid out as a real paper:
subject sections split into typed sub-sections ("Section A — MCQ",
"Section B — Numerical Value") with continuous question numbering.

### Flow C — Co-Sign (Admin, share 2 of 2 → dual control complete)

```mermaid
sequenceDiagram
    actor Admin
    participant App as RN App
    participant CS as Node Crypto Service
    participant SB as Supabase
    actor Setter as Setter's App

    Admin->>App: Papers → "Co-sign" → enter Admin passphrase
    App->>CS: POST /api/papers/:id/cosign
    Note over CS: unwrap shareB from escrow<br/>re-wrap shareB with Admin passphrase<br/>delete escrow copy
    CS->>SB: UPDATE paper_secrets · papers.status='sealed_dual' · audit_log
    SB-->>Setter: Realtime → Setter sees "DUAL-SEALED" instantly
    Note over CS,SB: From here, decryption requires BOTH passphrases.<br/>No single person — including the server operator —<br/>can read the paper alone.
```

### Flow D — Print Ceremony & Fingerprinting (two-person rule)

```mermaid
sequenceDiagram
    actor Both as Setter + Admin (together)
    participant App as RN App (Admin)
    participant CS as Node Crypto Service
    participant AI as Python AI Service
    participant SB as Supabase

    Both->>App: Print ceremony → BOTH passphrases + copy count + press location
    App->>CS: POST /api/papers/:id/print
    Note over CS: unwrap shareA (Setter pass) + shareB (Admin pass)<br/>K = shareA ⊕ shareB → decrypt & verify GCM tag<br/>key exists ONLY in memory, zeroed after
    loop For each copy 1..N
        CS->>AI: POST /fingerprint/register {copy_id}
        AI-->>CS: fingerprint_hash (invisible watermark identity)
        Note over CS: QR payload = {copy_id, paper_id, n, HMAC signature}
    end
    CS->>SB: INSERT paper_copies (N rows) + custody_events('printed')
    CS->>SB: papers.status='printed' · audit_log
    SB-->>App: Realtime → custody feed shows N copies born
```

### Flow E — Real-Time Chain of Custody

```mermaid
sequenceDiagram
    participant Scan as Checkpoint scan (invigilator / transport)
    participant SB as Supabase
    participant TRG as Postgres Triggers
    participant Admin as Admin Dashboard (live)

    Scan->>SB: INSERT custody_events(copy_id, event_type, location)
    TRG->>TRG: hash = sha256(prev_hash ∥ event) — per-copy chain
    TRG->>SB: UPDATE paper_copies SET status, current_location
    SB-->>Admin: Realtime INSERT → feed updates in <1s
    Note over Admin: printed → in_transit → at_center → delivered<br/>Every handoff is timestamped, attributed, chained.
```

### Flow E2 — Frame Watermark Detection

Every printed page is divided into a **5 × 7 grid of frames**, each carrying
its own QR. The token is `SAE:<trace12><page2><frame2><tag4>` — 24 characters,
a QR version 3 at ECC H — where `tag` is an HMAC over (copy, page, frame).
Nothing per-frame is stored: the copy resolves through
`paper_copies.trace_code` and the tag is recomputed to prove this server
minted the token, so a 500-copy run does not write 17 500 rows nobody reads.

```mermaid
sequenceDiagram
    participant Cam as Camera / monitoring client
    participant CS as Node Crypto Service
    participant SB as Supabase
    participant Admin as Admin Dashboard (live)

    Cam->>CS: POST /api/detections { qr_token, scanner_id, confidence, geo… }
    Note over CS: x-detector-key, or an admin/invigilator JWT
    CS->>SB: resolve trace_code -> copy -> paper -> exam
    Note over CS: recompute HMAC tag for (copy, page, frame)<br/>mismatch = forged/altered copy, rejected + audited
    CS->>SB: same token + scanner seen within DETECTION_DEDUP_SEC?
    alt repeat sighting
        CS->>SB: UPDATE qr_detections SET detection_count += 1, last_detected_at
        CS-->>Cam: { deduplicated: true }  — no new alert
    else new sighting
        CS->>SB: INSERT qr_detections (page, frame, device, IP, geo, confidence…)
        CS->>SB: INSERT alerts (critical on first sighting of a copy, else warning)
        SB-->>Admin: 🔴 Realtime push — event on the Detections tab in <1s
    end
```

A capture of roughly **68 × 68 mm** — about a quarter of an A4 page — is
guaranteed to contain one complete frame wherever the shot is framed, because
the guarantee window is (cell + symbol) = 42 + 26 mm.

### Flow F — Missing Copy / Leak Forensics

```mermaid
sequenceDiagram
    actor Inv as Invigilator
    participant SB as Supabase
    participant TRG as Triggers
    participant Admin as All Admin devices
    participant CS as Node Crypto Service
    participant AI as AI Service

    Inv->>SB: Copy not in box → custody event 'missing'
    TRG->>SB: INSERT alerts(severity='critical', COPY_MISSING)
    SB-->>Admin: 🔴 Realtime push — alert banner on every Admin dashboard

    Note over Admin,AI: Later: a photo of a leaked paper surfaces online
    Admin->>CS: POST /api/forensics/identify {image}
    CS->>AI: POST /fingerprint/extract
    AI-->>CS: copy_id (decoded from invisible watermark)
    CS->>SB: Mark copy 'leaked' + critical alert + audit
    CS-->>Admin: Copy #37, Press X → District Vault Y → Center Z<br/>+ full hash-chained custody trail = exact leak source
```

---

## 7. Cryptography Details

**Sealing (dual control):**
- `K` = 32 random bytes (AES-256-GCM key), generated server-side, never persisted.
- `shareA` = 32 random bytes → wrapped with the **Setter's passphrase** (scrypt N=16384 → AES-256-GCM).
- `shareB` = `K ⊕ shareA` → held in **server escrow** until the Admin co-signs, then re-wrapped with the **Admin's passphrase** and the escrow copy destroyed.
- XOR splitting is information-theoretically secure: one share reveals *zero* bits of `K`.

**Per-copy identity:**
- QR payload: `{copy_id, paper_id, copy_number, sig}` where `sig = HMAC-SHA256(server_secret, …)` — forged QR codes fail verification.
- Fingerprint: AI service derives `HMAC(ai_secret, copy_id)` and can embed `copy_id` into page images via LSB steganography (demo) — production would use DCT/DWT watermarks that survive print-photograph round trips.

**Tamper evidence:**
- `audit_log.hash = sha256(prev_hash ∥ actor ∥ action ∥ entity ∥ details ∥ timestamp)` — a global chain.
- `custody_events` chains the same way **per copy**. Rewriting history requires recomputing every subsequent hash, which the append-only RLS policy prevents.

**Demo trade-offs (be honest about these):**
1. Between *seal* and *co-sign*, `shareB` sits in server escrow — so Setter + server collusion is theoretically possible in that window. Production: encrypt `shareB` directly to an Admin hardware token (or true Shamir t-of-n with an HSM ceremony), so the window never exists.
2. Question plaintext remains in `questions` (status `used`) for reuse in mock exams; production would purge or re-encrypt the bank after sealing.
3. LSB steganography does not survive JPEG/print-photo; production uses robust frequency-domain watermarking.
4. Roles are self-selected at signup for demo convenience; production is invite-only provisioning by the board.

---

## 8. Threat → Mitigation Map

| Threat | Mitigation |
|---|---|
| Insider (setter/admin/printer) opens paper early | Dual-control key split — no single passphrase decrypts anything |
| Database breach | `paper_secrets` holds only ciphertext + passphrase-wrapped shares; RLS hides it from every client JWT |
| Stolen copy in transit | Per-copy custody chain → missed checkpoint = instant critical alert with last known holder |
| Leaked photo on social media | Invisible fingerprint → exact copy → exact custody trail → exact person |
| Forged "official" paper copies | QR payloads are HMAC-signed; verification fails for fakes |
| Log tampering to hide involvement | Hash-chained, append-only audit log; any edit breaks every later hash |
| Client app tampering | All authorization is server-side (RLS + JWT role checks); the app is untrusted |
| Frontend validation bypassed to submit a malformed paper | Question inserts have no client RLS policy at all; section/type/marks alignment is checked in `POST /api/questions`, and `/api/papers`, `/confirm-preview` and `/seal` each re-run the full per-set composition and reuse check |
| Two sets shipped with the same questions | Cross-set uniqueness is enforced at save, confirm and seal against `paper_questions`, not in the UI; the Admin must explicitly set `allow_question_reuse` to lift it |
| A paper sealed differing from what was reviewed | The rendered document is built once and encrypted with the paper; the preview, the sealed blob and the printed copies are the same bytes |

---

## 9. Scale Notes (national exam day)

- **Reads/scans:** custody scans are single-row inserts — Postgres handles tens of thousands/min; partition `custody_events` by exam for archives.
- **Realtime fan-out:** Supabase Realtime multiplexes WebSockets; admin dashboards subscribe to filtered channels only.
- **AI service:** stateless FastAPI → horizontal scale behind a load balancer; fingerprint registration is precomputed at print time, not on the hot path.
- **Crypto service:** stateless except Supabase I/O; ceremonies are rare events (per paper, not per copy).
