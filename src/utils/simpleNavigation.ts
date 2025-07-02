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

// Finde signifikante Abbiegepunkte auf der Route
export function findTurningPoints(route: LatLng[], minTurnAngle: number = 30): {
  point: LatLng;
  index: number;
  turnAngle: number;
}[] {
  if (route.length < 3) return [];
  
  const turningPoints = [];
  
  for (let i = 1; i < route.length - 1; i++) {
    const prevPoint = route[i - 1];
    const currentPoint = route[i];
    const nextPoint = route[i + 1];
    
    // Berechne Bearing vor und nach dem aktuellen Punkt
    const bearingBefore = getBearing(prevPoint, currentPoint);
    const bearingAfter = getBearing(currentPoint, nextPoint);
    
    // Berechne Winkeländerung
    let angleDiff = bearingAfter - bearingBefore;
    if (angleDiff > 180) angleDiff -= 360;
    if (angleDiff < -180) angleDiff += 360;
    
    // Nur signifikante Abbiegungen berücksichtigen
    if (Math.abs(angleDiff) >= minTurnAngle) {
      turningPoints.push({
        point: currentPoint,
        index: i,
        turnAngle: angleDiff
      });
    }
  }
  
  return turningPoints;
}

// Finde den nächsten relevanten Abbiegepunkt
export function findNextTurningPoint(
  currentPos: LatLng, 
  route: LatLng[], 
  lastProcessedIndex: number
): {
  turningPoint: LatLng | null;
  index: number;
  distance: number;
  turnAngle: number;
} {
  // Finde alle Abbiegepunkte
  const turningPoints = findTurningPoints(route, 35); // Mindestens 35° für Abbiegung
  
  // Finde den nächsten Abbiegepunkt nach dem letzten verarbeiteten Index
  for (const tp of turningPoints) {
    if (tp.index > lastProcessedIndex) {
      const distance = getDistanceInMeters(currentPos, tp.point);
      
      // Nur Abbiegepunkte in angemessener Entfernung berücksichtigen (20-200m)
      if (distance >= 20 && distance <= 200) {
        return {
          turningPoint: tp.point,
          index: tp.index,
          distance,
          turnAngle: tp.turnAngle
        };
      }
    }
  }
  
  return {
    turningPoint: null,
    index: lastProcessedIndex,
    distance: 0,
    turnAngle: 0
  };
}

// Bestimme Richtungsanweisung basierend auf Winkeländerung
export function getTurnInstruction(turnAngle: number): string {
  const absAngle = Math.abs(turnAngle);
  
  if (absAngle >= 150) return "Wende dich um";
  if (absAngle >= 90) {
    return turnAngle > 0 ? "Scharf rechts abbiegen" : "Scharf links abbiegen";
  }
  if (absAngle >= 45) {
    return turnAngle > 0 ? "Rechts abbiegen" : "Links abbiegen";
  }
  return turnAngle > 0 ? "Leicht rechts halten" : "Leicht links halten";
}

// Hauptfunktion für Navigation mit verbesserter Logik
export function getNavigationInstruction(
  currentPos: LatLng, 
  route: LatLng[], 
  lastProcessedIndex: number,
  currentBearing?: number
): {
  instruction: string | null;
  distance: number;
  newWaypointIndex: number;
} {
  const { turningPoint, index, distance, turnAngle } = findNextTurningPoint(
    currentPos, 
    route, 
    lastProcessedIndex
  );
  
  if (!turningPoint || distance === 0) {
    return { 
      instruction: null, 
      distance: 0, 
      newWaypointIndex: lastProcessedIndex 
    };
  }
  
  // Nur Ansage machen, wenn wir uns dem Abbiegepunkt nähern
  if (distance <= 100) {
    const instruction = getTurnInstruction(turnAngle);
    return {
      instruction,
      distance,
      newWaypointIndex: index
    };
  }
  
  return { 
    instruction: null, 
    distance: 0, 
    newWaypointIndex: lastProcessedIndex 
  };
}

// Prüfe ob der Benutzer einen Abbiegepunkt passiert hat
export function hasPassedTurningPoint(
  currentPos: LatLng,
  turningPoint: LatLng,
  threshold: number = 15
): boolean {
  const distance = getDistanceInMeters(currentPos, turningPoint);
  return distance <= threshold;
}