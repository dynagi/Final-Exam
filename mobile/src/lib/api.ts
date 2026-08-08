import { CRYPTO_SERVER_URL } from './config';
import { supabase } from './supabase';
import { ExtractedQuestion, PrintResult, Role } from './types';

async function request(
  path: string,
  body: Record<string, unknown>,
  token?: string
): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetch(`${CRYPTO_SERVER_URL}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Skip ngrok-free's HTML browser-warning interstitial so we get JSON.
        'ngrok-skip-browser-warning': 'true',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error(
      `Cannot reach crypto service at ${CRYPTO_SERVER_URL}. Is it running? (see server/README in project root)`
    );
  }

  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(typeof json.error === 'string' ? json.error : `Server error ${res.status}`);
  }
  return json;
}

/** Authenticated call to the Node crypto/ceremony service. */
async function post(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Not signed in');
  return request(path, body, token);
}

/**
 * Sign-up goes through the server's admin API: the account is created
 * pre-confirmed, so no confirmation email is sent and Supabase's mailer
 * rate limit can never block it.
 */
export const signUpUser = (role: Role, fullName: string, email: string, password: string) =>
  request('/api/auth/signup', { role, fullName, email, password });

export const sealPaper = (paperId: string, passphrase: string) =>
  post(`/api/papers/${paperId}/seal`, { passphrase });

export const cosignPaper = (paperId: string, passphrase: string) =>
  post(`/api/papers/${paperId}/cosign`, { passphrase });

export const printCopies = (
  paperId: string,
  setterPassphrase: string,
  adminPassphrase: string,
  copies: number,
  location: string
) =>
  post(`/api/papers/${paperId}/print`, {
    setterPassphrase,
    adminPassphrase,
    copies,
    location,
  }) as unknown as Promise<PrintResult>;

/** Provision an exam center + its invigilator login account (admin-only). */
export const provisionCenter = (body: {
  examId: string;
  slotId: string | null;
  name: string;
  code: string;
  password: string;
  capacity?: number;
}) =>
  post('/api/centers', body) as Promise<{
    ok: boolean;
    center: { id: string; name: string; code: string };
    login: { code: string; email: string };
  }>;

/** Allocate up to `count` unallocated copies of an exam's paper to a center. */
export const allocateCopies = (centerId: string, count: number) =>
  post(`/api/centers/${centerId}/allocate`, { count }) as Promise<{
    ok: boolean;
    allocated: number;
    requested: number;
  }>;

/** Invigilator scan-in: verify a copy's QR and mark it scanned. */
export const scanCopy = (qrPayload: string) =>
  post('/api/copies/scan', { qr_payload: qrPayload }) as Promise<{
    ok: boolean;
    copy_number: number;
    scanned_at: string;
  }>;

/**
 * Send a PDF (base64) to the NLP service via the crypto server, which
 * returns structured questions (MCQ + theoretical) the teacher can review.
 */
export async function extractQuestions(
  pdfBase64: string,
  fileName: string
): Promise<{ engine: string; pages: number; questions: ExtractedQuestion[] }> {
  const res = await post('/api/questions/extract', { pdfBase64, fileName });
  return {
    engine: typeof res.engine === 'string' ? res.engine : 'unknown',
    pages: typeof res.pages === 'number' ? res.pages : 0,
    questions: (res.questions as ExtractedQuestion[]) ?? [],
  };
}
