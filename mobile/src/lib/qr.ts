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
 * One watermark frame: a server-minted token encoding (copy, page, frame).
 *
 * Highest error correction (H, ~30% recoverable) because these are printed
 * faintly and will be photographed at an angle, folded, or partly covered by
 * text — the redundancy is what makes a fragment still decode.
 */
export function frameQrSvg(token: string): Promise<string> {
  return qrSvg(token, 300, { margin: 2, errorCorrectionLevel: 'H' });
}

/** Every frame of one copy's page, rendered in the order the grid expects. */
export function frameQrSvgs(tokens: string[]): Promise<string[]> {
  return Promise.all(tokens.map(frameQrSvg));
}
