import { LatLng } from 'react-native-maps';

// Berechne Bearing (Richtung) zwischen zwei Punkten
export function getBearing(from: LatLng, to: LatLng): number {
  const toRad = (deg: number) => deg * Math.PI / 180;
  const toDeg = (rad: number) => rad * 180 / Math.PI;
  
  const dLon = toRad(to.longitude - from.longitude);
  const lat1 = toRad(from.latitude);
  const lat2 = toRad(to.latitude);
  
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

// Berechne Entfernung zwischen zwei Punkten in Metern
export function getDistanceInMeters(from: LatLng, to: LatLng): number {
  const R = 6371000; // Erdradius in Metern
  const toRad = (deg: number) => deg * Math.PI / 180;
  
  const dLat = toRad(to.latitude - from.latitude);
  const dLon = toRad(to.longitude - from.longitude);
  const lat1 = toRad(from.latitude);
  const lat2 = toRad(to.latitude);
  
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1) * Math.cos(lat2) * 
            Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  
  return R * c;
}

// Finde nächsten Wegpunkt auf der Route
export function findNextWaypoint(currentPos: LatLng, route: LatLng[], lastWaypointIndex: number): {
  nextWaypoint: LatLng | null;
  nextIndex: number;
  distanceToNext: number;
} {
  if (!route || route.length === 0) {
    return { nextWaypoint: null, nextIndex: -1, distanceToNext: 0 };
  }

  // Suche ab dem letzten bekannten Index + einige Punkte voraus
  const searchStart = Math.max(0, lastWaypointIndex - 2);
  const searchEnd = Math.min(route.length, lastWaypointIndex + 10);
  
  let closestIndex = lastWaypointIndex;
  let minDistance = Infinity;
  
  // Finde den nächsten Punkt auf der Route
  for (let i = searchStart; i < searchEnd; i++) {
    const distance = getDistanceInMeters(currentPos, route[i]);
    if (distance < minDistance) {
      minDistance = distance;
      closestIndex = i;
    }
  }
  
  // Finde den nächsten Wegpunkt, der weit genug entfernt ist für Navigation
  for (let i = closestIndex + 1; i < route.length; i++) {
    const distance = getDistanceInMeters(currentPos, route[i]);
    if (distance > 15) { // Mindestens 15 Meter entfernt
      return {
        nextWaypoint: route[i],
        nextIndex: i,
        distanceToNext: distance
      };
    }
  }
  
  return { nextWaypoint: null, nextIndex: closestIndex, distanceToNext: 0 };
}

// Bestimme Richtungsanweisung basierend auf Bearing-Änderung
export function getDirectionInstruction(currentBearing: number, nextBearing: number): string | null {
  let angleDiff = nextBearing - currentBearing;
  
  // Normalisiere Winkel auf -180 bis 180
  if (angleDiff > 180) angleDiff -= 360;
  if (angleDiff < -180) angleDiff += 360;
  
  // Nur bei größeren Richtungsänderungen Ansage machen
  if (Math.abs(angleDiff) < 25) {
    return null; // Geradeaus, keine Ansage nötig
  }
  
  if (angleDiff > 120) return "Wende dich um";
  if (angleDiff < -120) return "Wende dich um";
  if (angleDiff > 45) return "Rechts abbiegen";
  if (angleDiff < -45) return "Links abbiegen";
  if (angleDiff > 0) return "Leicht rechts halten";
  return "Leicht links halten";
}

// Hauptfunktion für Navigation
export function getNavigationInstruction(
  currentPos: LatLng, 
  route: LatLng[], 
  lastWaypointIndex: number,
  currentBearing?: number
): {
  instruction: string | null;
  distance: number;
  newWaypointIndex: number;
} {
  const { nextWaypoint, nextIndex, distanceToNext } = findNextWaypoint(currentPos, route, lastWaypointIndex);
  
  if (!nextWaypoint || distanceToNext === 0) {
    return { instruction: null, distance: 0, newWaypointIndex: lastWaypointIndex };
  }
  
  // Berechne Bearing zum nächsten Wegpunkt
  const bearingToNext = getBearing(currentPos, nextWaypoint);
  
  // Wenn wir einen aktuellen Bearing haben, berechne Richtungsanweisung
  let instruction: string | null = null;
  if (currentBearing !== undefined) {
    instruction = getDirectionInstruction(currentBearing, bearingToNext);
  }
  
  return {
    instruction,
    distance: distanceToNext,
    newWaypointIndex: nextIndex
  };
}