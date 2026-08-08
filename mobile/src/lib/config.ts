/**
 * App configuration — EDIT THESE THREE VALUES before running.
 *
 * 1. SUPABASE_URL / SUPABASE_ANON_KEY:
 *    Supabase dashboard -> Project Settings -> API.
 *    (The anon key is safe to ship in the app; RLS enforces access.)
 *
 * 2. CRYPTO_SERVER_URL — where the Node crypto service runs. This is now
 *    derived automatically per platform (see below):
 *    - Web browser:             http://localhost:4000
 *    - Physical phone (Expo Go): http://<PC-LAN-IP>:4000 — auto-detected from
 *                               the Metro bundle host, no manual editing needed
 *    - Android emulator:        http://10.0.2.2:4000 (fallback)
 *    - iOS simulator:           http://127.0.0.1:4000 (fallback)
 *    Note: the crypto server must be reachable on your LAN — start it with
 *    `npm start` and allow Node through the firewall on port 4000.
 */
import Constants from 'expo-constants';
import { Platform } from 'react-native';

export const SUPABASE_URL = 'https://avlardakttkdnfltnape.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_LXPH1JifMnDAK51wf_SSJA_tUHRTUjo';

const CRYPTO_PORT = 4000;

/**
 * On a physical phone (Expo Go) the dev machine is NOT reachable at localhost
 * or the Android-emulator alias 10.0.2.2 — only at the PC's LAN IP.
 * expo-constants exposes debuggerHost ("192.168.x.x:8081") in Expo Go dev
 * builds, which is the reliable way to recover the Metro server's IP.
 * Emulators/simulators fall through to their loopback aliases.
 */
function lanHostFromConstants(): string | null {
  const debuggerHost: string | undefined = Constants.expoGoConfig?.debuggerHost;
  if (!debuggerHost) return null;
  const ip = debuggerHost.split(':')[0];
  if (!ip || ip === 'localhost' || ip === '127.0.0.1') return null;
  return ip;
}

/**
 * Pin your PC's LAN IP here when scanning from a PHYSICAL phone. This wins over
 * auto-detection (use it when the bundle host is a tunnel/USB/localhost, which
 * a real phone can't reach). Find it with `ipconfig` → IPv4 of your Wi-Fi.
 * Set to '' to fall back to auto-detection.
 */
const LAN_HOST_OVERRIDE = '192.168.1.102';

/**
 * Full URL override — use when the phone is NOT on the same Wi-Fi as the PC.
 * Expose the crypto server with a public tunnel and paste its URL here, e.g.
 *   cloudflared tunnel --url http://localhost:4000
 *   -> 'https://something-random.trycloudflare.com'
 * When set, this wins over everything below. Leave '' for the LAN/emulator path.
 */
const CRYPTO_SERVER_URL_OVERRIDE = '';

const lanHost = Platform.OS === 'web' ? null : LAN_HOST_OVERRIDE || lanHostFromConstants();
// Emulator/simulator fallbacks when no LAN IP is available.
const fallback = Platform.OS === 'ios' ? '127.0.0.1' : '10.0.2.2';

export const CRYPTO_SERVER_URL =
  CRYPTO_SERVER_URL_OVERRIDE ||
  (Platform.OS === 'web'
    ? `http://localhost:${CRYPTO_PORT}`
    : `http://${lanHost ?? fallback}:${CRYPTO_PORT}`);

export const IS_CONFIGURED = !SUPABASE_URL.includes('YOUR-PROJECT');

/**
 * Deterministic login email for a center code. MUST match centerEmail() in
 * the Node server — the center logs in with code + password, and both sides
 * map the code to the same hidden auth email.
 */
export function centerEmail(code: string): string {
  const slug = code
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `center.${slug}@secureaiexam.local`;
}
