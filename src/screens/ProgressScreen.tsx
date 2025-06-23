import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable, Modal, Dimensions } from 'react-native';
import MapView, { Polyline } from 'react-native-maps';
import { supabase } from '../api/supabase';
import { WorkoutEntry, fetchUserWorkouts } from '../services/workoutService';
import { LineChart, BarChart } from 'react-native-chart-kit';
import { eachWeekOfInterval, format as formatDate } from 'date-fns';
import { ScrollView } from 'react-native';


export default function ProgressScreen() {
  const [period, setPeriod] = useState<'week' | 'month' | '3months'>('week');
  const [workouts, setWorkouts] = useState<WorkoutEntry[]>([]);
  const [selectedWorkout, setSelectedWorkout] = useState<WorkoutEntry | null>(null);
  const [modalVisible, setModalVisible] = useState(false);

  const screenWidth = Dimensions.get('window').width;

  // ...nach useState-Hooks...
  function getStartDate(period: 'week' | 'month' | '3months') {
    const now = new Date();
    if (period === 'week') return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);
    if (period === 'month') return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29);
    if (period === '3months') return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 89);
    return now;
  }
  const startDate = getStartDate(period);
  const filteredWorkouts = workouts.filter(w => new Date(w.created_at) >= startDate);

  const paceData = filteredWorkouts
    .filter(w => typeof w.pace === 'number' && w.created_at)
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

  let paceLabels: string[] = [];
  let paceValues: number[] = [];

  if (period === 'week') {
    paceLabels = paceData.map(w => new Date(w.created_at).toLocaleDateString('de-DE'));
    paceValues = paceData.map(w => w.pace!);
  } else {
    const days = period === 'month' ? 30 : 90;
    for (let i = 0; i < days; i++) {
      const day = new Date(startDate);
      day.setDate(day.getDate() + i);
      paceLabels.push(day.toLocaleDateString('de-DE'));
      const dayWorkouts = paceData.filter(w =>
        new Date(w.created_at).toDateString() === day.toDateString()
      );
      if (dayWorkouts.length) {
        const avg = dayWorkouts.reduce((sum, w) => sum + (w.pace || 0), 0) / dayWorkouts.length;
        paceValues.push(avg);
      } else {
        paceValues.push(NaN);
      }
    }
    // Glätten (7-Tage Moving Average)
    const smooth = (arr: number[], window: number) =>
      arr.map((_, i, a) => {
        const vals = a.slice(Math.max(0, i - window + 1), i + 1).filter(v => !isNaN(v));
        return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : NaN;
      });
    paceValues = smooth(paceValues, 7);
  }

  // Y-Achse: Start bei 10 min/km, dann dynamisch runter bis zum Minimum
  const validPaces = paceValues.filter(v => !isNaN(v));
  const minPace = validPaces.length ? Math.min(...validPaces) : 0;
  const maxPace = validPaces.length ? Math.max(...validPaces) : 10;
  const yMin = Math.floor(Math.min(10, minPace - 1));
  const yMax = Math.ceil(Math.max(10, maxPace + 1));

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
  const trackerDays = getTrackerDays(period);
  const trackerArray = trackerDays.map(day => {
    const hasWorkout = filteredWorkouts.some(w =>
      new Date(w.created_at).toDateString() === day.toDateString()
    );
    return hasWorkout;
  });

  // --- BADGES ---
  const totalDistance = workouts.reduce((sum, w) => sum + (w.distance || 0), 0);
  const badgeLevels = [1, 5, 10, 20, 40, 100];

  // --- PACE-CHART ---
  // (removed duplicate paceData, paceLabels, paceValues)
  // --- FREQUENZ-CHART ---

  const workoutDates = workouts.map(w => new Date(w.created_at));
  const minDate = workoutDates.length ? new Date(Math.min(...workoutDates.map(d => d.getTime()))) : new Date();
  const maxDate = new Date();

  const weeks = eachWeekOfInterval({ start: minDate, end: maxDate });
  const freqLabels = weeks.map(w => formatDate(w, 'dd.MM.'));
  const freqValues = weeks.map(weekStart => {
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);
    return workouts.filter(w =>
      new Date(w.created_at) >= weekStart && new Date(w.created_at) <= weekEnd
    ).length;
  });

  useEffect(() => {
    const loadWorkouts = async () => {
      const currentUser = await supabase.auth.getUser();
      const user = currentUser?.data?.user;
      if (user) {
        const fetchedWorkouts = await fetchUserWorkouts(user.id);
        setWorkouts(fetchedWorkouts);
      }
    };
    loadWorkouts();
  }, []);

  const openWorkoutModal = (workout: WorkoutEntry) => {
    setSelectedWorkout(workout);
    setModalVisible(true);
  };

  const closeModal = () => {
    setSelectedWorkout(null);
    setModalVisible(false);
  };

  const formatDateTime = (timestamp: string): string => {
    const date = new Date(timestamp);
    return `Absolviert am ${date.toLocaleDateString('de-DE')} um ${date.toLocaleTimeString('de-DE', {
      hour: '2-digit',
      minute: '2-digit'
    })}`;
  };

  const renderWorkout = ({ item }: { item: WorkoutEntry }) => (
    <Pressable style={styles.workoutItem} onPress={() => openWorkoutModal(item)}>
      <Text style={styles.workoutName}>{item.name || 'Workout'}</Text>
      <Text style={styles.workoutInfo}>{item.distance.toFixed(2)} km | {new Date(item.duration * 1000).toISOString().substr(11, 8)} | Ø Pace: {item.pace?.toFixed(2)} min/km</Text>
    </Pressable>
  );

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  heading: { fontSize: 24, fontWeight: 'bold', marginVertical: 16 },
  workoutItem: {
    padding: 16,
    borderBottomWidth: 1,
    borderColor: '#ddd',
    backgroundColor: '#f8f8f8',
    marginBottom: 8,
    borderRadius: 8,
  },
  workoutName: { fontSize: 18, fontWeight: '600' },
  workoutInfo: { fontSize: 14, color: '#555' },
  modalContainer: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalBox: {
    backgroundColor: '#fff',
    padding: 20,
    borderRadius: 16,
    width: '95%',
    height: '80%',
    alignItems: 'center',
  },
  workoutTitle: { fontSize: 20, fontWeight: 'bold', marginBottom: 4 },
  workoutDate: { fontSize: 14, color: '#888', marginBottom: 4 },
  workoutDetails: { fontSize: 16, marginBottom: 4 },
  mapPreview: { width: '100%', height: '60%', marginVertical: 12 },
  closeButton: {
    backgroundColor: '#4CAF50',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
    marginTop: 12,
  },
});

  return (
    <FlatList
      data={filteredWorkouts}
      keyExtractor={(item) => item.id}
      renderItem={renderWorkout}
      contentContainerStyle={{ paddingBottom: 120 }}
      ListHeaderComponent={
        <View>
          {/* BADGES */}
          <View style={{ flexDirection: 'row', marginBottom: 24, flexWrap: 'wrap' }}>
            {badgeLevels.map(level => (
              <View
                key={level}
                style={{
                  backgroundColor: totalDistance >= level ? '#FFD700' : '#eee',
                  padding: 12,
                  borderRadius: 24,
                  marginRight: 8,
                  marginBottom: 8,
                  minWidth: 60,
                  alignItems: 'center',
                }}
              >
                <Text style={{ fontWeight: 'bold', color: totalDistance >= level ? '#333' : '#aaa' }}>
                  {level} km
                </Text>
                <Text style={{ fontSize: 12, color: totalDistance >= level ? '#333' : '#aaa' }}>
                  {totalDistance >= level ? '✔️' : '🔒'}
                </Text>
              </View>
            ))}
          </View>

          {/* FILTER */}
          <View style={{ flexDirection: 'row', justifyContent: 'center', marginBottom: 12 }}>
            {['week', 'month', '3months'].map(p => (
              <Pressable
                key={p}
                onPress={() => setPeriod(p as 'week' | 'month' | '3months')}
                style={{
                  backgroundColor: period === p ? '#4CAF50' : '#eee',
                  paddingVertical: 6,
                  paddingHorizontal: 16,
                  borderRadius: 16,
                  marginHorizontal: 4,
                }}
              >
                <Text style={{ color: period === p ? '#fff' : '#333', fontWeight: 'bold' }}>
                  {p === 'week' ? 'Woche' : p === 'month' ? 'Monat' : '3 Monate'}
                </Text>
              </Pressable>
            ))}
          </View>

          {/* TRACKER */}
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
          <Text style={{ fontWeight: 'bold', marginBottom: 8, textAlign: 'center' }}>Trainings-Tracker</Text>

          <Text style={styles.heading}>Meine Workouts</Text>
        </View>
      }
      ListFooterComponent={
        <Modal visible={modalVisible} transparent animationType="slide">
          <View style={styles.modalContainer}>
            <View style={styles.modalBox}>
              <Text style={styles.workoutTitle}>{selectedWorkout?.name || 'Workout'}</Text>
              <Text style={styles.workoutDate}>
                {selectedWorkout?.created_at ? formatDateTime(selectedWorkout.created_at) : ''}
              </Text>
              <Text style={styles.workoutDetails}>
                Dauer: {new Date((selectedWorkout?.duration || 0) * 1000).toISOString().substr(11, 8)} | Distanz: {selectedWorkout?.distance.toFixed(2)} km
              </Text>
              <Text style={styles.workoutDetails}>
                Ø Pace: {selectedWorkout?.pace?.toFixed(2)} min/km | Kalorien: {Math.round(selectedWorkout?.calories || 0)} kcal
              </Text>
              <MapView
                style={styles.mapPreview}
                initialRegion={{
                  latitude: selectedWorkout?.path?.[0]?.latitude || 0,
                  longitude: selectedWorkout?.path?.[0]?.longitude || 0,
                  latitudeDelta: 0.01,
                  longitudeDelta: 0.01,
                }}
              >
                {selectedWorkout?.path && (
                  <Polyline coordinates={selectedWorkout.path} strokeWidth={4} strokeColor="blue" />
                )}
              </MapView>
              <Pressable style={styles.closeButton} onPress={closeModal}>
                <Text style={{ color: '#fff' }}>Schließen</Text>
              </Pressable>
            </View>
          </View>
        </Modal>
      }
    />
  );
}
