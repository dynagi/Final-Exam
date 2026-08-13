/**
 * Printable question paper.
 *
 * Layout follows the standard Indian exam skeleton: centred header, a
 * duration / marks / paper-set strip, the candidate block, an instruction
 * box, subject sections split into typed sub-sections ("Section A — MCQ"),
 * and a footer with the paper code, set and page. It matches PaperPreview
 * one-for-one, so what the setter confirmed is what comes out of the printer.
 *
 * Every copy carries its own signed QR in the header, and one QR per question
 * printed in the whitespace beside that question's answer area — so a photo of
 * a single question is enough to name the copy and the question it came from.
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

/**
 * One question, and — beside its answer area — the QR that identifies this
 * copy and this question.
 *
 * Every question type ends in the same two-column "answer zone": the answer
 * area on the left, the question's own QR parked in the whitespace at its
 * right. MCQ/MSQ put a two-column option grid there, numerical a ruled blank,
 * subjective a set of ruled lines — so a mixed (hybrid) paper needs no special
 * casing, each question simply brings its own answer area to the same frame.
 */
function questionHtml(
  q: Pick<PaperQuestionContent, 'question_type' | 'body' | 'options' | 'marks'> & {
    negative_marks?: number;
  },
  number: number,
  frameSvg?: string | null
): string {
  const penalty = q.negative_marks && q.negative_marks > 0 ? ` / &minus;${q.negative_marks}` : '';
  const hasOptions =
    (q.question_type === 'mcq' || q.question_type === 'msq') && q.options.length > 0;

  const answer = hasOptions
    ? `<div class="options">${q.options
        .map((o, i) => `<div class="option"><b>(${String.fromCharCode(65 + i)})</b> ${escapeHtml(o)}</div>`)
        .join('')}</div>`
    : q.question_type === 'numerical'
      ? '<div class="answer"></div>'
      : '<div class="subjective"><div class="line"></div><div class="line"></div><div class="line"></div><div class="line"></div></div>';

  // No token for this question (older ceremony, or a paper longer than the
  // minted run): the answer area simply takes the full width.
  const tag = frameSvg
    ? `<div class="qtag"><img src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(
        frameSvg
      )}" alt="" /><span>Q${number}</span></div>`
    : '';

  return `
    <article class="question">
      <div class="qrow">
        <div class="qno">${number}.</div>
        <div class="qtext">${escapeHtml(q.body)}</div>
        <div class="marks">[${q.marks}${penalty}]</div>
      </div>
      <div class="qbody">
        <div class="qans">${answer}</div>
        ${tag}
      </div>
    </article>`;
}

/**
 * The body of the paper. Papers sealed against an exam format carry the
 * section/sub-section layout the setter confirmed; older papers fall back to
 * a flat question list.
 *
 * `frameSvgs` is aligned to the printed numbering — `frameSvgs[n - 1]` is the
 * QR for question n — which holds for both layouts because the view numbers
 * questions continuously across every section.
 */
function questionsHtml(result: PrintResult, frameSvgs: string[] | null): string {
  const frameFor = (n: number) => frameSvgs?.[n - 1] ?? null;
  const sections = result.paper.sections;
  if (!sections?.length) {
    return `<section class="section"><div class="subsection">${result.paper.questions
      .map((q, i) => questionHtml(q, i + 1, frameFor(i + 1)))
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
            ${group.questions.map((q) => questionHtml(q, q.number, frameFor(q.number))).join('')}
          </div>`
          )
          .join('')}
      </section>`
    )
    .join('');
}

/** One copy rendered as a self-contained, page-breaking A4 paper. */
function copySection(
  result: PrintResult,
  copy: PrintedCopy,
  qrSvgString: string,
  frameSvgs: string[] | null = null
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
        'Every question on this copy carries a unique QR code; its chain of custody is tracked and any leak is traceable to this copy and the exact question photographed.',
      ];
  const instructions = `
    <div class="instructions">
      <h3>INSTRUCTIONS</h3>
      <ol>${lines.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ol>
    </div>`;

  // The trace code is printed as text as well as encoded in every question's
  // QR, so a fragment that catches the footer identifies the copy even
  // without a decoder.
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

  return `<section class="paper"><div class="sheet">${header}${instructions}${questionsHtml(
    result,
    frameSvgs
  )}${footer}</div></section>`;
}

const DOC_STYLE = `
  @page { size: A4; margin: 15mm; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #fff; color: #111; font-family: "Times New Roman", Georgia, serif; padding: 0; }
  section.paper { page-break-after: always; }
  section.paper:last-child { page-break-after: auto; }
  /* Browsers strip graphics when printing unless told not to — the per-question
     QR codes are the whole point, so they must survive. */
  img { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
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
  /* The answer zone: answer area on the left, this question's QR parked in the
     whitespace at its right. Identical frame for every question type, so a
     hybrid paper needs no special casing. */
  .qbody { display: flex; align-items: flex-start; gap: 6mm; margin: 6px 0 0 36px; }
  .qans { flex: 1; min-width: 0; }
  .qtag { flex: none; width: 18mm; text-align: center; }
  .qtag img { display: block; width: 18mm; height: 18mm; }
  .qtag span { display: block; margin-top: 1px; font-family: "Courier New", monospace;
               font-size: 6.5pt; color: #444; letter-spacing: .4px; }
  .options { display: grid; grid-template-columns: 1fr 1fr; gap: 5px 18px; }
  .option { font-size: 12.5px; line-height: 1.5; }
  .answer { border-bottom: 1px solid #555; width: 65%; height: 28px; margin-top: 4px; }
  .subjective { margin-top: 4px; }
  .line { border-bottom: 1px solid #aaa; height: 25px; }
  .footer { border-top: 1px solid #111; margin-top: 25px; padding-top: 6px;
            display: flex; justify-content: space-between; gap: 8px; font-size: 10px; color: #555; }
  @media print { body { padding: 0; } .question { page-break-inside: avoid; } }
  @media (max-width: 850px) {
    .options { grid-template-columns: 1fr; }
    .qbody { gap: 4mm; }
  }`;

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
 * Build a printable A4 question paper for a single copy: the signed header QR,
 * plus one QR per question printed beside that question's answer area, so a
 * photograph of a single question identifies this exact copy and which
 * question was in shot. `frameSvgs[n - 1]` belongs to question n.
 */
export function buildPaperHtml(
  result: PrintResult,
  copy: PrintedCopy,
  qrSvgString: string,
  frameSvgs?: string[] | null
): string {
  const set = result.paper.set_label ? ` (${result.paper.set_label})` : '';
  return htmlDoc(
    `${result.paper.title}${set} — Copy #${copy.copy_number}`,
    copySection(result, copy, qrSvgString, frameSvgs ?? null)
  );
}

/**
 * Build ONE document containing every copy, each on its own page(s) with its
 * own signed header QR and its own per-question QRs. `copies` pairs each
 * printed copy with its pre-rendered SVGs.
 */
export function buildAllCopiesHtml(
  result: PrintResult,
  copies: { copy: PrintedCopy; qrSvg: string; frameSvgs?: string[] | null }[]
): string {
  const body = copies
    .map(({ copy, qrSvg, frameSvgs }) => copySection(result, copy, qrSvg, frameSvgs ?? null))
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
