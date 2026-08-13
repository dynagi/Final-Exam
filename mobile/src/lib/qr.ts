import QRCode from 'qrcode';

/**
 * Generate a QR code as an SVG string. `qrcode`'s SVG renderer is pure JS
 * (no canvas/DOM), so the same call works on web and native — the SVG can
 * be displayed with react-native-svg's SvgXml or inlined into print HTML.
 */
export async function qrSvg(
  payload: string,
  size = 140,
  opts?: { margin?: number; errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H'; dark?: string }
): Promise<string> {
  return QRCode.toString(payload, {
    type: 'svg',
    margin: opts?.margin ?? 1,
    width: size,
    errorCorrectionLevel: opts?.errorCorrectionLevel ?? 'M',
    color: opts?.dark ? { dark: opts.dark, light: '#0000' } : undefined,
  });
}

/**
 * One question's QR: a server-minted token encoding (copy, page, question).
 *
 * Error correction Q (~25% recoverable) rather than H. The token is 25
 * alphanumeric characters, which Q fits into a 25x25 symbol where H would
 * need 29x29 — at the ~18 mm these print at, that is the difference between
 * roughly 0.72 mm and 0.62 mm per module. These are printed at full contrast
 * in the paper's own whitespace rather than faintly under the text, so the
 * larger modules buy more real-world scannability than H's extra redundancy.
 */
export function frameQrSvg(token: string): Promise<string> {
  return qrSvg(token, 240, { margin: 1, errorCorrectionLevel: 'Q' });
}

/** One QR per question, aligned so `[n - 1]` belongs to question n. */
export function frameQrSvgs(tokens: string[]): Promise<string[]> {
  return Promise.all(tokens.map(frameQrSvg));
}
