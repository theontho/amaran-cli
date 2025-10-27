import geoip from 'geoip-lite';

export interface Location {
  city?: string;
  region?: string;
  country?: string;
  ll?: [number, number]; // [latitude, longitude]
}

export function getLocationFromIP(ip?: string): Location | null {
  // If no IP provided, use public IP via external service or fallback to localhost
  // geoip-lite works best with public IPs
  if (!ip || ip === '127.0.0.1' || ip === '::1') {
    // Try to get public IP via external service
    // For now, fallback to null
    return null;
  }
  const geo = geoip.lookup(ip);
  if (!geo) return null;
  return {
    city: geo.city,
    region: geo.region,
    country: geo.country,
    ll: geo.ll as [number, number],
  };
}
