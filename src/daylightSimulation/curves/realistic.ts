/**
 * Realistic daylight calculation functions based on sun position and atmospheric models.
 */

/**
 * Realistic daylight calculation based on sun altitude.
 * @param altitude Sun altitude in radians
 * @param maxAltitude Maximum sun altitude for the day in radians
 */
export function calculateRealisticSunAltitude(
  altitude: number,
  maxAltitude: number
): [cctFactor: number, intensityFactor: number] {
  // Convert altitude to degrees for easier calculations
  const altitudeDeg = (altitude * 180) / Math.PI;
  const maxAltitudeDeg = (maxAltitude * 180) / Math.PI;

  // CCT: Based on real-world color temperature at different sun angles
  let cctFactor: number;
  if (altitudeDeg < -6) {
    cctFactor = 0; // Before civil twilight - minimum CCT
  } else if (altitudeDeg < 0) {
    // Civil twilight: 4000-5000K range
    cctFactor = 0.3 + ((altitudeDeg + 6) / 6) * 0.2; // 0.3 to 0.5
  } else if (altitudeDeg < 30) {
    // Morning/afternoon: 5000-6500K
    cctFactor = 0.5 + (altitudeDeg / 30) * 0.3; // 0.5 to 0.8
  } else if (altitudeDeg < 60) {
    // High sun: 5500-7000K
    cctFactor = 0.8 + ((altitudeDeg - 30) / 30) * 0.2; // 0.8 to 1.0
  } else {
    // Very high sun: 6500-7500K
    cctFactor = 1.0;
  }

  // Calculate raw intensity factor based on absolute altitude
  const calculateIntensity = (altDeg: number) => {
    if (altDeg < -6) return 0;
    if (altDeg < 0) return ((altDeg + 6) / 6) ** 2 * 0.05;
    if (altDeg < 10) return 0.05 + (altDeg / 10) * 0.15;
    if (altDeg < 30) return 0.2 + ((altDeg - 10) / 20) * 0.4;
    return 0.6 + ((altDeg - 30) / 60) * 0.4;
  };

  const rawIntensity = calculateIntensity(altitudeDeg);
  const maxDailyIntensity = calculateIntensity(maxAltitudeDeg);

  // Normalize: Scale the current intensity so that at maxAltitude it reaches 1.0
  let intensityFactor = maxDailyIntensity > 0.01 ? rawIntensity / maxDailyIntensity : 0;
  intensityFactor = Math.min(1.0, intensityFactor);

  return [Math.max(0, Math.min(1, cctFactor)), Math.max(0, Math.min(1, intensityFactor))];
}

/**
 * CIE daylight model with atmospheric path modeling.
 * @param altitude Sun altitude in radians
 * @param maxAltitude Maximum sun altitude for the day in radians
 */
export function calculateRealisticCIEDaylight(
  altitude: number,
  maxAltitude: number
): [cctFactor: number, intensityFactor: number] {
  const altitudeDeg = (altitude * 180) / Math.PI;
  const maxAltitudeDeg = (maxAltitude * 180) / Math.PI;

  let cctFactor: number;
  if (altitudeDeg < -6) {
    cctFactor = 0;
  } else if (altitudeDeg < 0) {
    cctFactor = 0.4 + ((altitudeDeg + 6) / 6) ** 1.5 * 0.2;
  } else if (altitudeDeg < 15) {
    cctFactor = 0.6 - Math.sin((altitudeDeg * Math.PI) / 30) * 0.1;
  } else if (altitudeDeg < 45) {
    cctFactor = 0.5 + ((altitudeDeg - 15) / 30) * 0.4;
  } else {
    cctFactor = 0.9 + Math.min(0.1, ((altitudeDeg - 45) / 45) * 0.1);
  }

  const calculateRawIntensity = (altDeg: number) => {
    if (altDeg < -6) return 0;
    if (altDeg < 0) return ((altDeg + 6) / 6) ** 3 * 0.03;

    if (altDeg < 15) {
      const altRad = Math.max(0.01, (altDeg * Math.PI) / 180);
      const airMass = 1 / Math.sin(altRad);
      return Math.min(0.25, 1 / airMass ** 0.7);
    }

    if (altDeg < 40) return 0.25 + ((altDeg - 15) / 25) * 0.55;
    if (altDeg < 70) return 0.8 + ((altDeg - 40) / 30) * 0.15;
    return 0.95 + ((altDeg - 70) / 20) * 0.05;
  };

  const rawIntensity = calculateRawIntensity(altitudeDeg);
  const maxDailyIntensity = calculateRawIntensity(maxAltitudeDeg);
  const intensityFactor = maxDailyIntensity > 0.001 ? rawIntensity / maxDailyIntensity : 0;

  return [Math.max(0, Math.min(1, cctFactor)), Math.max(0, Math.min(1, intensityFactor))];
}

/**
 * Perez daylight model with turbidity and atmospheric effects.
 * @param altitude Sun altitude in radians
 * @param maxAltitude Maximum sun altitude for the day in radians
 */
export function calculateRealisticPerezDaylight(
  altitude: number,
  maxAltitude: number
): [cctFactor: number, intensityFactor: number] {
  const altitudeDeg = (altitude * 180) / Math.PI;
  const maxAltitudeDeg = (maxAltitude * 180) / Math.PI;

  let cctFactor: number;
  if (altitudeDeg < -6) {
    cctFactor = 0;
  } else if (altitudeDeg < 0) {
    cctFactor = 0.35 + ((altitudeDeg + 6) / 6) ** 2 * 0.25;
  } else if (altitudeDeg < 25) {
    const goldenHourEffect = Math.exp(-((altitudeDeg - 12.5) ** 2) / 100);
    cctFactor = 0.6 - goldenHourEffect * 0.15 + (altitudeDeg / 25) * 0.3;
  } else if (altitudeDeg < 50) {
    cctFactor = 0.75 + ((altitudeDeg - 25) / 25) * 0.2;
  } else {
    cctFactor = Math.min(1.0, 0.95 + ((altitudeDeg - 50) / 40) * 0.05);
  }

  const calculateRawIntensity = (altDeg: number) => {
    if (altDeg < -6) return 0;
    if (altDeg < 5) return (Math.max(0, altDeg + 6) / 11) ** 4 * 0.15;

    if (altDeg < 20) {
      const zenithAngle = Math.max(0.01, ((90 - altDeg) * Math.PI) / 180);
      const relativeLuminance = Math.exp(-0.2 / Math.max(0.01, Math.cos(zenithAngle)));
      return Math.min(0.4, relativeLuminance * 0.35 + 0.05);
    }

    if (altDeg < 45) return 0.25 + ((altDeg - 20) / 25) * 0.65;
    if (altDeg < 80) return 0.9 + ((altDeg - 45) / 35) * 0.1;
    return 1.0;
  };

  const rawIntensity = calculateRawIntensity(altitudeDeg);
  const maxDailyIntensity = calculateRawIntensity(maxAltitudeDeg);
  const intensityFactor = maxDailyIntensity > 0.001 ? rawIntensity / maxDailyIntensity : 0;

  return [Math.max(0, Math.min(1, cctFactor)), Math.max(0, Math.min(1, intensityFactor))];
}
