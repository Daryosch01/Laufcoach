import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable, Modal, Dimensions } from 'react-native';
import MapView, { Polyline } from 'react-native-maps';
import { supabase } from '../api/supabase';
import { WorkoutEntry, fetchUserWorkouts } from '../services/workoutService';

export default function ProgressScreen() {
  const [workouts, setWorkouts] = useState<WorkoutEntry[]>([]);
  const [selectedWorkout, setSelectedWorkout] = useState<WorkoutEntry | null>(null);
  const [modalVisible, setModalVisible] = useState(false);

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

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Meine Workouts</Text>
      <FlatList
        data={workouts}
        keyExtractor={(item) => item.id}
        renderItem={renderWorkout}
        contentContainerStyle={{ paddingBottom: 120 }}
      />

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
    </View>
  );
}

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