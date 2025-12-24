/**
 * Formats a coordinate (latitude or longitude) with privacy redaction by default.
 */
export function formatCoordinate(coord: number, privacyOff = false): string {
  return privacyOff ? coord.toFixed(4) : `${Math.round(coord)}.XXXX`;
}

/**
 * Formats a location source (e.g., "geoip (1.2.3.4)") with privacy redaction by default.
 */
export function formatSource(source: string, privacyOff = false): string {
  if (privacyOff || !source.includes('(')) return source;

  const ipMatch = source.match(/(\d+\.\d+\.\d+\.\d+)/);
  if (ipMatch) {
    const ipParts = ipMatch[1].split('.');
    // Redact first three octets
    return source.replace(ipMatch[1], `XXX.XXX.XXX.${ipParts[3]}`);
  }
  return source;
}

/**
 * Formats a full location string with privacy redaction by default.
 */
export function formatLocation(lat: number, lon: number, source: string, privacyOff = false): string {
  const formattedLat = formatCoordinate(lat, privacyOff);
  const formattedLon = formatCoordinate(lon, privacyOff);
  const formattedSrc = formatSource(source, privacyOff);

  return `${formattedLat}°, ${formattedLon}° (${formattedSrc})`;
}
