export type RootStackParamList = {
  Home: undefined;
  Route: undefined;
  Coach: undefined;
  Activity: {
    trainingData: {
      title: string;
      description: string;
      duration_minutes: number;
      distance_km: number;
      type: string;
      target_pace_min_per_km?: string;
      explanation?: string;
    };
  };
  Progress: undefined;
  Profile: undefined; // <- wichtig!
};