// src/services/routesService.ts

import { supabase } from '../api/supabase';

// Präziser Typ für GPS-Koordinaten
export interface LatLng {
  latitude: number;
  longitude: number;
}

// Typ für eine gespeicherte Route
export interface RouteEntry {
  id: string;
  name: string;
  distance: number;
  coordinates: LatLng[];
  created_at: string;
  user_id: string | null;
}

// Lädt alle gespeicherten Routen des aktuell eingeloggten Nutzers
export async function fetchUserRoutes(userId: string): Promise<RouteEntry[]> {
  if (!userId) {
    console.warn('⚠️ Keine User-ID übergeben.');
    return [];
  }

  try {
    const { data, error } = await supabase
      .from('routes')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) throw new Error(error.message);
    if (!data) return [];

    return data as RouteEntry[];
  } catch (err) {
    console.error('❌ Fehler beim Laden der Routen:', err);
    return [];
  }
}