import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView } from 'react-native';
import { supabase } from '../api/supabase';
import { fetchUserWorkouts, WorkoutEntry } from '../services/workoutService';
import { format } from 'date-fns';

const HomeScreen: React.FC = () => {
  const [workouts, setWorkouts] = useState<WorkoutEntry[]>([]);
  const [todayWorkout, setTodayWorkout] = useState<WorkoutEntry | null>(null);

  useEffect(() => {
    const loadWorkouts = async () => {
      const currentUser = await supabase.auth.getUser();
      const user = currentUser?.data?.user;
      if (user) {
        const fetchedWorkouts = await fetchUserWorkouts(user.id);
        setWorkouts(fetchedWorkouts);

        // Finde heutiges Workout
        const today = new Date();
        const todayStr = today.toISOString().slice(0, 10);
        const workout = fetchedWorkouts.find(w =>
          w.created_at.slice(0, 10) === todayStr
        );
        setTodayWorkout(workout || null);
      }
    };
    loadWorkouts();
  }, []);

  function getTrackerDays(period: 'week' | 'month' | '3months') {
    const days = period === 'week' ? 7 : period === 'month' ? 30 : 90;
    const arr = [];
    for (let i = 0; i < days; i++) {
      const day = new Date();
      day.setDate(day.getDate() - (days - 1 - i));
      arr.push(day);
    }
    return arr;
  }
  const trackerDays = getTrackerDays('week');
  const trackerArray = trackerDays.map(day => {
    const hasWorkout = workouts.some(w =>
      new Date(w.created_at).toDateString() === day.toDateString()
    );
    return hasWorkout;
  });

  const restDayTips = [
    "Leichtes Dehnen oder Yoga",
    "Spaziergang an der frischen Luft",
    "Genügend Wasser trinken",
    "Schlaf und Regeneration beachten"
  ];

  const motivationQuotes = [
    "Jeder Tag zählt – auch der Ruhetag!",
    "Erfolg ist die Summe kleiner Anstrengungen.",
    "Ruhe ist Training für den nächsten Erfolg.",
  ];

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.heading}>Dein Tag</Text>

    {/* Heutiges Training oder Ruhetag */}
    <View style={styles.card}>
      {todayWorkout ? (
        <>
          <Text style={styles.cardTitle}>Heutiges Training</Text>
          <Text style={styles.cardText}>
            {todayWorkout.name || 'Workout'} – {todayWorkout.distance.toFixed(2)} km, Ø Pace: {todayWorkout.pace?.toFixed(2)} min/km
          </Text>
        </>
      ) : (
        <>
          <Text style={styles.cardTitle}>Ruhetag</Text>
          <Text style={styles.cardText}>Heute steht kein Training an.</Text>
          <Text style={styles.cardSubtitle}>Tipps für deinen Ruhetag:</Text>
          {restDayTips.slice(0, 3).map((tip, idx) => (
            <Text key={idx} style={styles.tip}>• {tip}</Text>
          ))}
        </>
      )}
    </View>

    {/* Motivation */}
    <View style={styles.card}>
      <Text style={styles.cardSubtitle}>Motivation</Text>
      <Text style={styles.quote}>
        "{motivationQuotes[Math.floor(Math.random() * motivationQuotes.length)]}"
      </Text>
    </View>

    {/* Tracker */}
    <Text style={[styles.cardSubtitle, { marginTop: 24 }]}>Trainings-Tracker (letzte 7 Tage)</Text>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 24, justifyContent: 'center' }}>
      {trackerArray.map((active, idx) => (
        <View
          key={idx}
          style={{
            width: 18,
            height: 18,
            margin: 2,
            borderRadius: 4,
            backgroundColor: active ? '#4CAF50' : '#eee',
            borderWidth: 1,
            borderColor: '#ccc',
          }}
        />
      ))}
     </View>
  </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: '#fff' },
  heading: { fontSize: 24, fontWeight: 'bold', marginVertical: 16 },
  card: {
    backgroundColor: '#f8f8f8',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    elevation: 2,
  },
  cardTitle: { fontSize: 18, fontWeight: 'bold', marginBottom: 4 },
  cardSubtitle: { fontSize: 16, fontWeight: '600', marginTop: 8, marginBottom: 4 },
  cardText: { fontSize: 15, marginBottom: 4 },
  tip: { fontSize: 14, color: '#555', marginLeft: 8 },
  quote: { fontStyle: 'italic', fontSize: 15, color: '#333', marginTop: 4 },
});

export default HomeScreen;