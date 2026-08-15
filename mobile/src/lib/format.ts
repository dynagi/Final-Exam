export function timeAgo(iso: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString();
}

export function shortHash(hash: string | null): string {
  return hash ? `#${hash.slice(0, 10)}…` : '—';
}

export function shortId(id: string): string {
  return id.slice(0, 8);
}

/** "12.9716, 77.5946 (±15m)" — null when the scan carried no GPS fix. */
export function fmtLatLng(
  lat: number | null | undefined,
  lng: number | null | undefined,
  accuracyM?: number | null
): string | null {
  if (lat == null || lng == null) return null;
  const coords = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  return accuracyM != null ? `${coords} (±${Math.round(accuracyM)}m)` : coords;
}

/** Google Maps link for a scan's captured coordinates. */
export function mapsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps?q=${lat},${lng}`;
}
