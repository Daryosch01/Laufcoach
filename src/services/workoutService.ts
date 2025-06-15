import { supabase } from '../api/supabase';

export interface WorkoutEntry {
  id: string;
  user_id: string;
  distance: number;
  duration: number;
  pace: number | null;
  calories: number;
  path: { latitude: number; longitude: number }[];
  created_at: string;
  name: string | null;
}

export async function fetchUserWorkouts(userId: string): Promise<WorkoutEntry[]> {
  const { data, error } = await supabase
    .from('workouts')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Fehler beim Laden der Workouts:', error.message);
    return [];
  }

  return data as WorkoutEntry[];
}