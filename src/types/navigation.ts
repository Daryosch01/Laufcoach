export interface TrainingData {
  id: string;
  title: string;
  description: string;
  duration_minutes: number;
  distance_km: number;
  type: string;
  target_pace_min_per_km?: string;
  explanation?: string;
}

export type RootStackParamList = {
  Activity: { trainingData: TrainingData };
  Profile: undefined;
  // ggf. weitere Screens hinzufügen
};