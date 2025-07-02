import { LatLng } from 'react-native-maps';

// --- Entfernung zwischen zwei Punkten in km
export function getDistance(a: LatLng, b: LatLng): number {
  const toRad = (v: number) => (v * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const aVal = Math.sin(dLat / 2) ** 2 +
    Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  const c = 2 * Math.atan2(Math.sqrt(aVal), Math.sqrt(1 - aVal));
  return R * c;
}

// --- Finde den Index des Steps, der dem Nutzer am nächsten ist (robust für beide Typen!)
export function findClosestStepIndex(current: LatLng, steps: any[]): number {
  if (!steps || steps.length === 0) return 0;
  let minDist = Infinity;
  let idx = 0;
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    let lat: number|undefined, lng: number|undefined;

    // 1. Google Directions Step mit start_location
    if (step && step.start_location && typeof step.start_location.lat === 'number' && typeof step.start_location.lng === 'number') {
      lat = step.start_location.lat;
      lng = step.start_location.lng;
    } 
    // 2. LatLng Punkt (polyline)
    else if (typeof step.latitude === 'number' && typeof step.longitude === 'number') {
      lat = step.latitude;
      lng = step.longitude;
    } else {
      continue; // skip invalid
    }
    if (lat === undefined || lng === undefined) {
      continue;
    }
    const dist = getDistance(current, { latitude: lat, longitude: lng });
    if (dist < minDist) {
      minDist = dist;
      idx = i;
    }
  }
  return idx;
}

// --- Snap-to-Route: Finde den nächsten Punkt auf der Route
export function snapToRoute(current: LatLng, route: LatLng[]): LatLng {
  let closest = route[0];
  let minDist = Infinity;
  for (let i = 0; i < route.length; i++) {
    const dist = getDistance(current, route[i]);
    if (dist < minDist) {
      minDist = dist;
      closest = route[i];
    }
  }
  return closest;
}

// --- Mapping für Manöver und Anweisungen (Google Maps zu Deutsch)
const maneuverToGerman: Record<string, string> = {
  'turn-right': 'Rechts abbiegen',
  'turn-left': 'Links abbiegen',
  'straight': 'Geradeaus weiter',
  'turn-slight-right': 'Leicht rechts abbiegen',
  'turn-slight-left': 'Leicht links abbiegen',
  'keep-right': 'Rechts halten',
  'keep-left': 'Links halten',
  'ramp-right': 'Rechts auf die Rampe',
  'ramp-left': 'Links auf die Rampe',
  'fork-right': 'An der Gabelung rechts halten',
  'fork-left': 'An der Gabelung links halten',
  'merge': 'Einfädeln',
  'roundabout-left': 'Im Kreisverkehr links abbiegen',
  'roundabout-right': 'Im Kreisverkehr rechts abbiegen',
  'uturn-left': 'Wenden nach links',
  'uturn-right': 'Wenden nach rechts',
  'depart': 'Starte',
  'arrive': 'Ziel erreicht',
  // ... weitere Mapping-Einträge nach Bedarf
};

export function getGermanInstruction(step: any): string {
  // 1. Mapping für Manöver verwenden, falls vorhanden
  if (step && step.maneuver && maneuverToGerman[step.maneuver]) {
    return maneuverToGerman[step.maneuver];
  }
  // 2. Sonst die html_instruction nehmen und aufräumen
  let instruction = step?.html_instructions?.replace(/<[^>]+>/g, '') || '';
  // Einfache Ersetzungen für häufige englische Anweisungen
  instruction = instruction
    .replace('Turn right', 'Rechts abbiegen')
    .replace('Turn left', 'Links abbiegen')
    .replace('Continue', 'Geradeaus weiter')
    .replace('Head', 'Starte in Richtung')
    .replace('Destination will be on the right', 'Das Ziel befindet sich rechts')
    .replace('Destination will be on the left', 'Das Ziel befindet sich links');
  // ... du kannst hier beliebig weitere Ersetzungen machen!
  return instruction || 'Weiterlaufen';
}