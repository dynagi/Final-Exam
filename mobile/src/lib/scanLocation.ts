import * as Location from 'expo-location';

export interface ScanLocation {
  latitude: number;
  longitude: number;
  accuracy: number | null;
}

/**
 * Best-effort GPS fix for the device doing a QR scan (copy scan-in, leak
 * trace). Never throws and never blocks the scan on a slow/denied fix for
 * long — permission is requested the first time, a short-lived last-known
 * position is preferred over an untimed hardware read, and anything that
 * doesn't resolve in time comes back null rather than stalling the scan.
 */
export async function getScanLocation(): Promise<ScanLocation | null> {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return null;

    const last = await Location.getLastKnownPositionAsync({ maxAge: 30_000 });
    const pos =
      last ??
      (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).catch(
        () => null
      ));
    if (!pos) return null;

    return {
      latitude: pos.coords.latitude,
      longitude: pos.coords.longitude,
      accuracy: pos.coords.accuracy ?? null,
    };
  } catch {
    return null;
  }
}
