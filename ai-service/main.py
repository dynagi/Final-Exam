"""
SecureAIExam — AI Forensics Service (FastAPI / uvicorn)

Endpoints:
  POST /fingerprint/register  -> derive a per-copy fingerprint identity
  POST /fingerprint/embed     -> embed copy_id invisibly into a page image (LSB)
  POST /fingerprint/extract   -> recover copy_id from a watermarked image
  POST /anomaly/check         -> rule-based custody chain anomaly scoring
  GET  /health

Demo note: LSB steganography survives lossless formats (PNG) but not
JPEG re-compression or print-photograph round trips. Production would use
frequency-domain (DCT/DWT) watermarking. The *architecture* — unique
invisible identity per copy, extracted from a leaked image and mapped to
a custody chain — is identical.

Run:  uvicorn main:app --host 0.0.0.0 --port 8080
"""
import base64
import hashlib
import hmac
import io
import json
import os
import re
import time
from datetime import datetime, timezone

import numpy as np
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from PIL import Image
from prometheus_client import CONTENT_TYPE_LATEST, CollectorRegistry, Counter, Histogram, generate_latest
from pydantic import BaseModel

SECRET = os.getenv("AI_SECRET", "demo-ai-secret")
MAGIC = b"SAIX1"  # watermark header
HEADER_BYTES = len(MAGIC) + 2  # magic + 2-byte payload length

# NLP extraction config. With an Anthropic key set we use Claude to parse
# arbitrary PDFs into structured questions; otherwise we fall back to a
# fully-offline rule-based parser so the feature always works.
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "").strip()
EXTRACT_MODEL = os.getenv("AI_EXTRACT_MODEL", "claude-sonnet-4-6")

app = FastAPI(title="SecureAIExam AI Service", version="1.0.0")
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"]
)

# --------------------------- Prometheus metrics -------------------------------
# Scraped by Prometheus and visualized in Grafana (see /monitoring at repo root).

METRICS = CollectorRegistry()
HTTP_REQUESTS_TOTAL = Counter(
    "secureaiexam_ai_http_requests_total",
    "Total HTTP requests",
    ["method", "route", "status"],
    registry=METRICS,
)
HTTP_REQUEST_DURATION = Histogram(
    "secureaiexam_ai_http_request_duration_seconds",
    "HTTP request duration in seconds",
    ["method", "route", "status"],
    buckets=(0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5, 10),
    registry=METRICS,
)
FINGERPRINT_OPS_TOTAL = Counter(
    "secureaiexam_fingerprint_ops_total",
    "Fingerprint operations, by op",
    ["op"],
    registry=METRICS,
)
EXTRACT_ENGINE_TOTAL = Counter(
    "secureaiexam_extract_engine_total",
    "PDF question-extraction runs, by engine used",
    ["engine"],
    registry=METRICS,
)
ANOMALY_SCORE = Histogram(
    "secureaiexam_anomaly_score",
    "Custody anomaly scores returned by /anomaly/check",
    buckets=(0.0, 0.2, 0.3, 0.4, 0.5, 0.7, 1.0),
    registry=METRICS,
)


@app.middleware("http")
async def prometheus_middleware(request: Request, call_next):
    start = time.perf_counter()
    response = await call_next(request)
    route = request.scope.get("route")
    path = route.path if route else request.url.path
    labels = {"method": request.method, "route": path, "status": response.status_code}
    HTTP_REQUEST_DURATION.labels(**labels).observe(time.perf_counter() - start)
    HTTP_REQUESTS_TOTAL.labels(**labels).inc()
    return response


@app.get("/metrics")
def metrics():
    return Response(generate_latest(METRICS), media_type=CONTENT_TYPE_LATEST)


class RegisterRequest(BaseModel):
    copy_id: str


class EmbedRequest(BaseModel):
    copy_id: str
    image_base64: str


class ExtractRequest(BaseModel):
    image_base64: str


class CustodyEvent(BaseModel):
    event_type: str
    location: str
    created_at: str


class AnomalyRequest(BaseModel):
    events: list[CustodyEvent]


class ExtractQuestionsRequest(BaseModel):
    # Provide one of these. pdf_base64 takes priority.
    pdf_base64: str | None = None
    text: str | None = None
    filename: str | None = None


def fingerprint_hash(copy_id: str) -> str:
    """Deterministic per-copy identity, keyed so it cannot be forged."""
    return hmac.new(SECRET.encode(), copy_id.encode(), hashlib.sha256).hexdigest()


# ----------------------------- LSB steganography -----------------------------

def _to_bits(data: bytes):
    for byte in data:
        for shift in range(7, -1, -1):
            yield (byte >> shift) & 1


def _bits_to_bytes(bits: list[int]) -> bytes:
    out = bytearray()
    for i in range(0, len(bits) - 7, 8):
        value = 0
        for bit in bits[i : i + 8]:
            value = (value << 1) | bit
        out.append(value)
    return bytes(out)


def embed_lsb(image: Image.Image, payload: str) -> Image.Image:
    """Hide MAGIC + length + payload in the LSBs of the blue channel."""
    arr = np.array(image.convert("RGB"), dtype=np.uint8)
    blue = arr[:, :, 2].flatten()

    body = payload.encode("utf-8")
    if len(body) > 0xFFFF:
        raise ValueError("payload too large")
    message = MAGIC + len(body).to_bytes(2, "big") + body
    bits = list(_to_bits(message))
    if len(bits) > blue.size:
        raise ValueError("image too small to carry the fingerprint")

    blue[: len(bits)] = (blue[: len(bits)] & 0xFE) | np.array(bits, dtype=np.uint8)
    arr[:, :, 2] = blue.reshape(arr.shape[0], arr.shape[1])
    return Image.fromarray(arr, "RGB")


def extract_lsb(image: Image.Image) -> str | None:
    arr = np.array(image.convert("RGB"), dtype=np.uint8)
    blue = arr[:, :, 2].flatten()

    header_bits = (blue[: HEADER_BYTES * 8] & 1).tolist()
    header = _bits_to_bytes(header_bits)
    if header[: len(MAGIC)] != MAGIC:
        return None

    length = int.from_bytes(header[len(MAGIC) : len(MAGIC) + 2], "big")
    total_bits = (HEADER_BYTES + length) * 8
    if total_bits > blue.size:
        return None

    payload_bits = (blue[HEADER_BYTES * 8 : total_bits] & 1).tolist()
    try:
        return _bits_to_bytes(payload_bits).decode("utf-8")
    except UnicodeDecodeError:
        return None


def _decode_image(image_base64: str) -> Image.Image:
    try:
        raw = base64.b64decode(image_base64)
        return Image.open(io.BytesIO(raw))
    except Exception:
        raise HTTPException(status_code=400, detail="image_base64 is not a valid image")


# --------------------------------- endpoints ---------------------------------

@app.get("/health")
def health():
    return {"ok": True, "service": "ai-service"}


@app.post("/fingerprint/register")
def register(req: RegisterRequest):
    """Called by the crypto service at print time, once per copy."""
    FINGERPRINT_OPS_TOTAL.labels(op="register").inc()
    return {
        "copy_id": req.copy_id,
        "fingerprint_hash": fingerprint_hash(req.copy_id),
        "method": "hmac-sha256",
    }


@app.post("/fingerprint/embed")
def embed(req: EmbedRequest):
    """Watermark a page image with the copy's invisible identity."""
    FINGERPRINT_OPS_TOTAL.labels(op="embed").inc()
    image = _decode_image(req.image_base64)
    try:
        marked = embed_lsb(image, req.copy_id)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    buf = io.BytesIO()
    marked.save(buf, format="PNG")  # lossless, preserves LSBs
    return {
        "copy_id": req.copy_id,
        "fingerprint_hash": fingerprint_hash(req.copy_id),
        "image_base64": base64.b64encode(buf.getvalue()).decode("ascii"),
        "format": "png",
    }


@app.post("/fingerprint/extract")
def extract(req: ExtractRequest):
    """Recover the copy identity from a leaked image."""
    FINGERPRINT_OPS_TOTAL.labels(op="extract").inc()
    image = _decode_image(req.image_base64)
    copy_id = extract_lsb(image)
    if not copy_id:
        raise HTTPException(status_code=404, detail="No SecureAIExam fingerprint found")
    return {"copy_id": copy_id, "fingerprint_hash": fingerprint_hash(copy_id)}


# ---------------------- PDF -> structured questions (NLP) --------------------

VALID_DIFFICULTY = {"easy", "medium", "hard"}


def extract_pdf_text(pdf_base64: str) -> tuple[str, int]:
    """Return (text, page_count). Requires pypdf."""
    try:
        from pypdf import PdfReader
    except ImportError:
        raise HTTPException(
            status_code=501,
            detail="pypdf not installed on the AI service (pip install -r requirements.txt)",
        )
    try:
        raw = base64.b64decode(pdf_base64)
        reader = PdfReader(io.BytesIO(raw))
    except Exception:
        raise HTTPException(status_code=400, detail="pdf_base64 is not a valid PDF")

    pages = [page.extract_text() or "" for page in reader.pages]
    return "\n".join(pages), len(pages)


def _normalize_question(item: dict) -> dict | None:
    """Coerce a raw dict (from Claude or the offline parser) into our shape."""
    body = str(item.get("body", "")).strip()
    if len(body) < 5:
        return None

    qtype = str(item.get("question_type", "")).lower()
    options = [str(o).strip() for o in (item.get("options") or []) if str(o).strip()]
    if qtype not in ("mcq", "theoretical"):
        qtype = "mcq" if len(options) >= 2 else "theoretical"

    correct_index = item.get("correct_index")
    if qtype == "mcq":
        # Need exactly 4 options; pad/truncate and clamp the key.
        while len(options) < 4:
            options.append("")
        options = options[:4]
        try:
            correct_index = int(correct_index)
        except (TypeError, ValueError):
            correct_index = 0
        if correct_index < 0 or correct_index > 3:
            correct_index = 0
    else:
        options = []
        correct_index = None

    try:
        marks = int(item.get("marks", 1))
    except (TypeError, ValueError):
        marks = 1
    marks = max(1, min(100, marks))

    difficulty = str(item.get("difficulty", "medium")).lower()
    if difficulty not in VALID_DIFFICULTY:
        difficulty = "medium"

    subject = item.get("subject")
    topic = item.get("topic")
    return {
        "question_type": qtype,
        "body": body,
        "options": options,
        "correct_index": correct_index,
        "marks": marks,
        "subject": str(subject).strip() if subject else None,
        "topic": str(topic).strip() if topic else None,
        "difficulty": difficulty,
    }


def parse_questions_claude(text: str) -> list[dict]:
    """Use Claude to turn raw exam text into structured questions."""
    from anthropic import Anthropic  # lazy import; only when a key is set

    client = Anthropic(api_key=ANTHROPIC_API_KEY)
    prompt = (
        "You are extracting exam questions from raw text scraped out of a PDF. "
        "Return ONLY a JSON array (no prose, no markdown fences). Each element:\n"
        '{ "question_type": "mcq"|"theoretical", "body": str, '
        '"options": [str,str,str,str] (MCQ only, else []), '
        '"correct_index": 0-3|null (the index of the correct option if the text '
        'states the answer, else null), "marks": int, '
        '"subject": str|null, "topic": str|null, '
        '"difficulty": "easy"|"medium"|"hard" }.\n'
        "Detect both multiple-choice and theoretical/long-answer questions. "
        "Infer marks from any '[N marks]' style hints (default 1 for MCQ). "
        "Do not invent questions that are not present.\n\n"
        "RAW TEXT:\n" + text[:60000]
    )
    msg = client.messages.create(
        model=EXTRACT_MODEL,
        max_tokens=8000,
        messages=[{"role": "user", "content": prompt}],
    )
    body = "".join(block.text for block in msg.content if block.type == "text").strip()
    # Be tolerant of accidental markdown fences.
    body = re.sub(r"^```(?:json)?|```$", "", body.strip(), flags=re.MULTILINE).strip()
    start, end = body.find("["), body.rfind("]")
    if start == -1 or end == -1:
        raise ValueError("Claude did not return a JSON array")
    return json.loads(body[start : end + 1])


# Offline parser regexes
_Q_SPLIT = re.compile(r"(?im)^\s*(?:Q(?:uestion)?\s*)?(\d{1,3})[.)]\s+")
_OPTION = re.compile(r"(?im)^\s*\(?([A-Da-d])[).]\s*(.+?)\s*$")
_ANSWER = re.compile(r"(?i)\bans(?:wer)?\s*[:\-]?\s*\(?([A-Da-d])\)?")
_MARKS = re.compile(r"(?i)[\[(]\s*(\d{1,3})\s*marks?\s*[\])]|\bmarks?\s*[:\-]\s*(\d{1,3})")


def parse_questions_offline(text: str) -> list[dict]:
    """Rule-based fallback parser — no model, fully offline."""
    # Split into blocks at "1." / "Q2)" / "Question 3." markers.
    parts = _Q_SPLIT.split(text)
    blocks: list[str] = []
    if len(parts) >= 3:
        # parts = [preamble, num, body, num, body, ...]
        for i in range(1, len(parts) - 1, 2):
            blocks.append(parts[i + 1])
    else:
        blocks = [b for b in re.split(r"\n\s*\n", text) if b.strip()]

    questions: list[dict] = []
    for block in blocks:
        lines = [ln.rstrip() for ln in block.splitlines() if ln.strip()]
        if not lines:
            continue

        options: list[str] = []
        answer_letter: str | None = None
        body_lines: list[str] = []
        for line in lines:
            opt = _OPTION.match(line)
            ans = _ANSWER.search(line)
            if opt:
                options.append(opt.group(2).strip())
                continue
            if ans and len(line) < 30:
                answer_letter = ans.group(1).upper()
                continue
            body_lines.append(line)

        body = " ".join(body_lines).strip()
        if len(body) < 5:
            continue

        marks_match = _MARKS.search(block)
        marks = 1
        if marks_match:
            marks = int(next(g for g in marks_match.groups() if g))

        if len(options) >= 2:
            correct = ord(answer_letter) - 65 if answer_letter else 0
            questions.append(
                {
                    "question_type": "mcq",
                    "body": re.sub(r"(?i)[\[(]\s*\d+\s*marks?\s*[\])]", "", body).strip(),
                    "options": options,
                    "correct_index": correct,
                    "marks": marks,
                }
            )
        else:
            questions.append(
                {
                    "question_type": "theoretical",
                    "body": re.sub(r"(?i)[\[(]\s*\d+\s*marks?\s*[\])]", "", body).strip(),
                    "options": [],
                    "correct_index": None,
                    "marks": marks if marks_match else 5,
                }
            )
    return questions


@app.post("/extract/questions")
def extract_questions(req: ExtractQuestionsRequest):
    """Parse a PDF (or raw text) into structured MCQ + theoretical questions."""
    pages = 0
    if req.pdf_base64:
        text, pages = extract_pdf_text(req.pdf_base64)
    elif req.text:
        text = req.text
    else:
        raise HTTPException(status_code=400, detail="Provide pdf_base64 or text")

    if not text.strip():
        raise HTTPException(status_code=422, detail="No extractable text found in the document")

    engine = "offline"
    raw: list[dict] = []
    if ANTHROPIC_API_KEY:
        try:
            raw = parse_questions_claude(text)
            engine = "claude"
        except Exception as exc:  # fall back gracefully on any LLM failure
            print(f"Claude extraction failed, falling back to offline: {exc}")
            raw = parse_questions_offline(text)
            engine = "offline-fallback"
    else:
        raw = parse_questions_offline(text)

    questions = [q for q in (_normalize_question(item) for item in raw) if q]
    EXTRACT_ENGINE_TOTAL.labels(engine=engine).inc()
    return {
        "engine": engine,
        "pages": pages,
        "chars": len(text),
        "count": len(questions),
        "questions": questions,
    }


EXPECTED_ORDER = {"printed": 0, "in_transit": 1, "at_center": 2, "delivered": 3}
MAX_GAP_HOURS = 12.0


@app.post("/anomaly/check")
def anomaly_check(req: AnomalyRequest):
    """Rule-based scoring of a single copy's custody chain."""
    flags: list[str] = []
    score = 0.0

    last_rank = -1
    last_time: datetime | None = None
    for event in req.events:
        if event.event_type in ("missing", "leaked"):
            flags.append(f"CRITICAL: copy reported {event.event_type} at {event.location}")
            score = 1.0
            continue

        rank = EXPECTED_ORDER.get(event.event_type)
        if rank is not None:
            if rank < last_rank:
                flags.append(
                    f"Out-of-order checkpoint: {event.event_type} after a later stage"
                )
                score = max(score, 0.7)
            last_rank = max(last_rank, rank)

        try:
            ts = datetime.fromisoformat(event.created_at.replace("Z", "+00:00"))
            if ts.tzinfo is None:
                ts = ts.replace(tzinfo=timezone.utc)
            if last_time is not None:
                gap = (ts - last_time).total_seconds() / 3600.0
                if gap > MAX_GAP_HOURS:
                    flags.append(
                        f"Custody gap of {gap:.1f}h before {event.event_type} at {event.location}"
                    )
                    score = max(score, 0.5)
            last_time = ts
        except ValueError:
            flags.append(f"Unparseable timestamp: {event.created_at}")
            score = max(score, 0.3)

    if last_rank >= 0 and last_rank < EXPECTED_ORDER["delivered"] and score < 0.4:
        flags.append("Chain incomplete: copy has not reached 'delivered'")
        score = max(score, 0.2)

    ANOMALY_SCORE.observe(score)
    return {"score": round(score, 2), "flags": flags, "events_analyzed": len(req.events)}


if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("PORT", "8080"))
    uvicorn.run(app, host="0.0.0.0", port=port)
