/**
 * Printable question paper.
 *
 * Layout follows the standard Indian exam skeleton: centred header, a
 * duration / marks / paper-set strip, the candidate block, an instruction
 * box, subject sections split into typed sub-sections ("Section A — MCQ"),
 * and a footer with the paper code, set and page. It matches PaperPreview
 * one-for-one, so what the setter confirmed is what comes out of the printer.
 *
 * Every copy also carries its own signed QR in the header.
 */
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';
import { PaperQuestionContent, PrintedCopy, PrintResult } from './types';

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

const TYPE_TAG: Record<string, string> = {
  mcq: 'MCQ',
  msq: 'MSQ',
  numerical: 'Numerical',
  theoretical: 'Subjective',
};

function questionHtml(
  q: Pick<PaperQuestionContent, 'question_type' | 'body' | 'options' | 'marks'> & {
    negative_marks?: number;
  },
  number: number
): string {
  const penalty = q.negative_marks && q.negative_marks > 0 ? ` / &minus;${q.negative_marks}` : '';
  const hasOptions =
    (q.question_type === 'mcq' || q.question_type === 'msq') && q.options.length > 0;

  const body = hasOptions
    ? `<div class="options">${q.options
        .map((o, i) => `<div class="option"><b>(${String.fromCharCode(65 + i)})</b> ${escapeHtml(o)}</div>`)
        .join('')}</div>`
    : q.question_type === 'numerical'
      ? '<div class="answer"></div>'
      : '<div class="subjective"><div class="line"></div><div class="line"></div><div class="line"></div><div class="line"></div></div>';

  return `
    <article class="question">
      <div class="qrow">
        <div class="qno">${number}.</div>
        <div class="qtext">${escapeHtml(q.body)}</div>
        <div class="marks">[${q.marks}${penalty}]</div>
      </div>
      ${body}
    </article>`;
}

/**
 * The body of the paper. Papers sealed against an exam format carry the
 * section/sub-section layout the setter confirmed; older papers fall back to
 * a flat question list.
 */
function questionsHtml(result: PrintResult): string {
  const sections = result.paper.sections;
  if (!sections?.length) {
    return `<section class="section"><div class="subsection">${result.paper.questions
      .map((q, i) => questionHtml(q, i + 1))
      .join('')}</div></section>`;
  }

  return sections
    .map(
      (section) => `
      <section class="section">
        <div class="section-title">${escapeHtml(section.name.toUpperCase())}</div>
        ${section.groups
          .map(
            (group) => `
          <div class="subsection">
            <div class="sub-title">
              ${escapeHtml(group.label)}${
                group.required != null ? ` &mdash; Required: ${group.required} questions` : ''
              }
            </div>
            <div class="summary">
              ${group.questions.length} question${group.questions.length === 1 ? '' : 's'}${
                group.marks_correct != null
                  ? ` &middot; +${group.marks_correct} for a correct answer${
                      group.negative_marks > 0
                        ? `, &minus;${group.negative_marks} for an incorrect answer`
                        : ', no negative marking'
                    }, ${group.unattempted_marks} if unattempted`
                  : ''
              }
            </div>
            ${group.questions.map((q) => questionHtml(q, q.number)).join('')}
          </div>`
          )
          .join('')}
      </section>`
    )
    .join('');
}

/* ------------------------------- watermark -------------------------------- */

/** Ink strength of the watermark. Higher = easier to scan, harder to read past. */
const WATERMARK_OPACITY = 0.15;
/** Rotated so the symbols never line up with the text baseline grid. */
const WATERMARK_ANGLE = -18;

export interface FrameGrid {
  cols: number;
  rows: number;
}

/**
 * The frame watermark layer: the page divided into a fixed grid, each cell
 * carrying its OWN QR.
 *
 * A uniform tile would tell you which copy was photographed; a grid of
 * distinct frames also tells you which part of it, because each token encodes
 * (copy, page, frame). The tokens are minted by the server — only it holds
 * the key that tags them — and arrive with the print-ceremony result.
 *
 * The layer sits behind the content (`z-index: 0`, content at 1) and is
 * `position: fixed`, which paged media repeats on every printed page.
 */
function watermarkLayer(frameSvgs: string[] | null, grid: FrameGrid): string {
  if (!frameSvgs?.length) return '';
  const cellW = 100 / grid.cols;
  const cellH = 100 / grid.rows;

  const cells = frameSvgs
    .slice(0, grid.cols * grid.rows)
    .map((svg, i) => {
      const col = i % grid.cols;
      const row = Math.floor(i / grid.cols);
      const uri = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
      return `<div class="wm-cell" style="left:${(col * cellW).toFixed(4)}%;top:${(
        row * cellH
      ).toFixed(4)}%;width:${cellW.toFixed(4)}%;height:${cellH.toFixed(
        4
      )}%"><img src="${uri}" alt="" /></div>`;
    })
    .join('');

  return `<div class="watermark" aria-hidden="true">${cells}</div>`;
}

/** One copy rendered as a self-contained, page-breaking A4 paper. */
function copySection(
  result: PrintResult,
  copy: PrintedCopy,
  qrSvgString: string,
  frameSvgs: string[] | null = null,
  grid: FrameGrid = { cols: 5, rows: 7 }
): string {
  const p = result.paper;
  const questionCount =
    p.sections?.reduce((n, s) => n + s.question_count, 0) ?? p.questions.length;
  const setLabel = p.set_label ?? '—';

  const header = `
    <div class="header">
      <div class="header-main">
        <div class="exam-name">${escapeHtml(p.exam_name || p.title)}</div>
        <div class="paper-label">${escapeHtml(p.format_display_name || p.subject)}</div>
      </div>
      <div class="qr">
        ${qrSvgString}
        <div class="qr-cap">Copy #${copy.copy_number} &middot; signed</div>
      </div>
    </div>

    <div class="exam-meta">
      <span><b>Duration:</b> ${p.duration_minutes ? `${p.duration_minutes} minutes` : '—'}</span>
      <span><b>Total Marks:</b> ${p.total_marks}</span>
      <span><b>Questions:</b> ${questionCount}</span>
      <span><b>Paper Set:</b> ${escapeHtml(setLabel)}</span>
    </div>

    <div class="candidate">
      <div class="row">
        <div class="cell"><b>Candidate Name:</b> __________________________</div>
        <div class="cell"><b>Roll No:</b> __________________</div>
      </div>
      <div class="row">
        <div class="cell"><b>Registration No:</b> _________________________</div>
        <div class="cell"><b>Centre:</b> __________________</div>
      </div>
    </div>`;

  // The instruction block is the one built when the paper was sealed, so the
  // printed copy states exactly the marking scheme the setter confirmed.
  const lines = p.instructions?.length
    ? p.instructions
    : [
        'Do not open this booklet until you are instructed to do so.',
        'This copy is uniquely watermarked and QR-signed; its chain of custody is tracked and any leak is traceable to this copy.',
      ];
  const instructions = `
    <div class="instructions">
      <h3>INSTRUCTIONS</h3>
      <ol>${lines.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ol>
    </div>`;

  // The trace code is printed as text as well as tiled as QR, so a fragment
  // that catches the footer identifies the copy even without a decoder.
  const trace = copy.trace_code
    ? `<span class="trace">TRACE ${escapeHtml(copy.trace_code)}</span>`
    : '';
  const footer = `
    <div class="footer">
      <span>${escapeHtml(
        `${(p.format_display_name || p.subject).toUpperCase()}`
      )}</span>
      <span>Set: ${escapeHtml(setLabel)} &middot; Copy #${copy.copy_number} of ${result.copies}</span>
      <span>${escapeHtml(result.location)} ${trace}</span>
    </div>`;

  return `<section class="paper">${watermarkLayer(
    frameSvgs,
    grid
  )}<div class="sheet">${header}${instructions}${questionsHtml(result)}${footer}</div></section>`;
}

const DOC_STYLE = `
  @page { size: A4; margin: 15mm; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #fff; color: #111; font-family: "Times New Roman", Georgia, serif; padding: 0; }
  section.paper { page-break-after: always; position: relative; }
  section.paper:last-child { page-break-after: auto; }
  /* Frame watermark grid: one distinct QR per cell. Fixed positioning makes
     paged media repeat it on every sheet; content sits above at full
     contrast. */
  .watermark {
    position: fixed;
    inset: 0;
    opacity: ${WATERMARK_OPACITY};
    z-index: 0;
    pointer-events: none;
    /* Browsers strip background graphics when printing unless told not to. */
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .wm-cell { position: absolute; display: flex; align-items: center; justify-content: center; }
  .wm-cell img {
    width: 62%; height: auto; max-height: 82%;
    transform: rotate(${WATERMARK_ANGLE}deg);
  }
  .sheet { position: relative; z-index: 1; }
  /* Text sits on its own opaque backing so the watermark never reduces
     contrast behind a glyph — it shows through the gaps instead. */
  .qtext, .option, .instructions li, .sub-title, .section-title { background: rgba(255,255,255,0.82); }
  .trace { font-family: "Courier New", monospace; letter-spacing: .5px; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px;
            text-align: center; border-bottom: 2px solid #111; padding-bottom: 9px; }
  .header-main { flex: 1; }
  .exam-name { font-size: 20px; font-weight: 700; text-transform: uppercase; letter-spacing: .5px; }
  .paper-label { font-size: 13px; font-weight: 700; margin-top: 3px; }
  .qr { width: 110px; flex: none; text-align: center; }
  .qr svg { width: 100px; height: 100px; }
  .qr-cap { font-size: 8px; color: #666; margin-top: 2px; }
  .exam-meta { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 8px;
               border-bottom: 1px solid #111; padding: 7px 0; margin-bottom: 10px; font-size: 12px; }
  .candidate { border: 1px solid #111; margin-bottom: 12px; }
  .candidate .row { display: flex; border-bottom: 1px solid #111; min-height: 28px; }
  .candidate .row:last-child { border-bottom: 0; }
  .candidate .cell { flex: 1; padding: 6px 8px; border-right: 1px solid #111; font-size: 12px; }
  .candidate .cell:last-child { border-right: 0; }
  .instructions { border: 1px solid #111; padding: 10px; margin-bottom: 15px; font-size: 11.5px; }
  .instructions h3 { text-align: center; margin: 0 0 5px; font-size: 13px; letter-spacing: .8px; }
  .instructions ol { margin: 0 0 0 18px; padding: 0; }
  .instructions li { line-height: 1.5; }
  .section { margin-top: 18px; }
  .section-title { text-align: center; font-weight: 700; font-size: 16px; letter-spacing: .6px;
                   border-top: 2px solid #111; border-bottom: 2px solid #111; padding: 7px; }
  .subsection { margin-top: 10px; }
  .sub-title { font-weight: 700; border: 1px solid #333; background: #f1f1f1; padding: 6px; font-size: 12.5px; }
  .summary { font-size: 11px; color: #555; margin: 5px 0 9px; }
  .question { margin: 0 0 13px; page-break-inside: avoid; }
  .qrow { display: flex; gap: 6px; align-items: flex-start; }
  .qno { font-weight: 700; min-width: 30px; }
  .qtext { flex: 1; font-size: 13.5px; line-height: 1.5; }
  .marks { font-size: 11px; font-weight: 700; white-space: nowrap; }
  .options { margin: 6px 0 0 36px; display: grid; grid-template-columns: 1fr 1fr; gap: 5px 18px; }
  .option { font-size: 12.5px; line-height: 1.5; }
  .answer { margin: 10px 0 0 36px; border-bottom: 1px solid #555; width: 65%; height: 28px; }
  .subjective { margin: 10px 0 0 36px; }
  .line { border-bottom: 1px solid #aaa; height: 25px; }
  .footer { border-top: 1px solid #111; margin-top: 25px; padding-top: 6px;
            display: flex; justify-content: space-between; gap: 8px; font-size: 10px; color: #555; }
  @media print { body { padding: 0; } .question { page-break-inside: avoid; } }
  @media (max-width: 850px) { .options { grid-template-columns: 1fr; } }`;

function htmlDoc(title: string, body: string): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>${DOC_STYLE}</style>
</head>
<body>${body}</body>
</html>`;
}

/**
 * Build a printable A4 question paper for a single copy: the signed header
 * QR plus the copy's trace code tiled across the page as a watermark, so a
 * photograph of any fragment identifies this exact copy.
 */
export function buildPaperHtml(
  result: PrintResult,
  copy: PrintedCopy,
  qrSvgString: string,
  frameSvgs?: string[] | null,
  grid?: FrameGrid
): string {
  const set = result.paper.set_label ? ` (${result.paper.set_label})` : '';
  return htmlDoc(
    `${result.paper.title}${set} — Copy #${copy.copy_number}`,
    copySection(result, copy, qrSvgString, frameSvgs ?? null, grid ?? result.frameGrid)
  );
}

/**
 * Build ONE document containing every copy, each on its own page(s) with its
 * own signed QR and its own watermark. `copies` pairs each printed copy with
 * its pre-rendered SVGs.
 *
 * Note the watermark layer is `position: fixed`, so in a multi-copy document
 * each copy still gets its own — browsers scope a fixed layer to the page
 * box it is painted on.
 */
export function buildAllCopiesHtml(
  result: PrintResult,
  copies: { copy: PrintedCopy; qrSvg: string; frameSvgs?: string[] | null }[],
  grid?: FrameGrid
): string {
  const body = copies
    .map(({ copy, qrSvg, frameSvgs }) =>
      copySection(result, copy, qrSvg, frameSvgs ?? null, grid ?? result.frameGrid)
    )
    .join('');
  const set = result.paper.set_label ? ` (${result.paper.set_label})` : '';
  return htmlDoc(`${result.paper.title}${set} — ${copies.length} copies`, body);
}

/** Print an HTML document. Web uses a hidden iframe; native uses expo-print. */
export async function printHtml(html: string): Promise<void> {
  if (Platform.OS === 'web') {
    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
    document.body.appendChild(iframe);
    const doc = iframe.contentWindow?.document;
    if (!doc) return;
    doc.open();
    doc.write(html);
    doc.close();
    const win = iframe.contentWindow;
    const cleanup = () => setTimeout(() => iframe.remove(), 1000);
    win?.addEventListener('afterprint', cleanup);
    setTimeout(() => {
      win?.focus();
      win?.print();
    }, 300);
    return;
  }
  await Print.printAsync({ html });
}

/** Native-only: render to a PDF file and open the share sheet. */
export async function sharePaperPdf(html: string): Promise<void> {
  if (Platform.OS === 'web') {
    await printHtml(html);
    return;
  }
  const { uri } = await Print.printToFileAsync({ html });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType: 'application/pdf' });
  }
}
