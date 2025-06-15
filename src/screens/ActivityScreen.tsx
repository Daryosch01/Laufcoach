import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Dimensions,
  Modal,
} from 'react-native';
import MapView, {
  Marker,
  Polyline,
  PROVIDER_GOOGLE,
  LatLng
} from 'react-native-maps';
import * as Location from 'expo-location';
import { supabase } from '../api/supabase';

const { width } = Dimensions.get('window');

export default function ActivityScreen() {
  const [region, setRegion] = useState<LatLng | null>(null);
  const [path, setPath] = useState<LatLng[]>([]);
  const [distance, setDistance] = useState(0);
  const [duration, setDuration] = useState(0);
  const [tracking, setTracking] = useState(false);
  const [paused, setPaused] = useState(false);
  const [averagePace, setAveragePace] = useState(0);
  const [calories, setCalories] = useState(0);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [showCountdown, setShowCountdown] = useState(false);

  const watchRef = useRef<Location.LocationSubscription | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      const loc = await Location.getCurrentPositionAsync({});
      setRegion({
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
      });
    })();
  }, []);

  useEffect(() => {
    if (tracking && !paused) {
      timerRef.current = setInterval(() => {
        setDuration((prev) => prev + 1);
      }, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [tracking, paused]);

  useEffect(() => {
    if (tracking && !paused && distance > 0 && duration > 0) {
      const km = distance;
      const min = duration / 60;
      const pace = min / km;
      setAveragePace(pace);

      const kcal = km * (8 + pace);
      setCalories(kcal);
    }
  }, [distance, duration, tracking, paused]);

  const toRad = (value: number) => (value * Math.PI) / 180;

  const calculateDistance = (points: LatLng[]): number => {
    let total = 0;
    for (let i = 1; i < points.length; i++) {
      const R = 6371;
      const dLat = toRad(points[i].latitude - points[i - 1].latitude);
      const dLon = toRad(points[i].longitude - points[i - 1].longitude);
      const lat1 = toRad(points[i - 1].latitude);
      const lat2 = toRad(points[i].latitude);
      const a = Math.sin(dLat / 2) ** 2 +
        Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      total += R * c;
    }
    return total;
  };

  const startTracking = async () => {
    setShowCountdown(false);
    setTracking(true);
    setPaused(false);

    watchRef.current = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.Highest,
        timeInterval: 1000,
        distanceInterval: 1,
      },
      (loc) => {
        const newCoord = {
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
        };
        setRegion(newCoord);
        setPath((prev) => {
          const updated = [...prev, newCoord];
          const dist = calculateDistance(updated);
          setDistance(dist);
          return updated;
        });
      }
    );
  };

  const beginCountdown = () => {
    setCountdown(10);
    setShowCountdown(true);
  };

  useEffect(() => {
    if (countdown === null) return;
    if (countdown === 0) {
      startTracking();
      return;
    }
    const id = setTimeout(() => setCountdown(countdown - 1), 1000);
    return () => clearTimeout(id);
  }, [countdown]);

  const stopTracking = async () => {
    setTracking(false);
    setPaused(false);

    if (watchRef.current) {
      watchRef.current.remove();
    }

    try {
      const { data: session, error: userError } = await supabase.auth.getUser();
      const userId = session?.user?.id;

      if (!userId) {
        console.warn('Kein User angemeldet');
        return;
      }

      const { error } = await supabase.from('workouts').insert({
        user_id: userId,
        name: "Workout vom " + new Date().toLocaleDateString('de-DE'),
        distance,
        duration,
        calories,
        pace: averagePace,
        path, // wird als JSON gespeichert
      });

      if (error) {
        console.error('Fehler beim Speichern:', error.message);
      } else {
        console.log('Workout erfolgreich gespeichert');
      }
    } catch (err) {
      console.error('Fehler bei stopTracking():', err);
    }

    // zurücksetzen des lokalen States
    setDuration(0);
    setDistance(0);
    setCalories(0);
    setAveragePace(0);
    setPath([]);
  };

  const pauseTracking = () => setPaused(true);
  const resumeTracking = () => setPaused(false);



  return (
    <View style={{ flex: 1 }}>
      <MapView
        style={StyleSheet.absoluteFillObject}
        provider={PROVIDER_GOOGLE}
        region={region ? {
          latitude: region.latitude,
          longitude: region.longitude,
          latitudeDelta: 0.01,
          longitudeDelta: 0.01
        } : undefined}
        showsUserLocation
        followsUserLocation
      >
        {path.length > 0 && (
          <Polyline coordinates={path} strokeWidth={5} strokeColor="blue" />
        )}
      </MapView>

      <View style={styles.statsBox}>
        <Text style={styles.duration}>
          {new Date(duration * 1000).toISOString().substr(11, 8)}
        </Text>
        <View style={styles.metricsRow}>
          <View style={styles.metric}>
            <Text style={styles.metricValue}>
              {Math.round(calories)}
            </Text>
            <Text>Kalorien</Text>
          </View>
          <View style={styles.metric}>
            <Text style={styles.metricValue}>
              {distance.toFixed(2)}
            </Text>
            <Text>Distanz (km)</Text>
          </View>
          <View style={styles.metric}>
            <Text style={styles.metricValue}>
              {isFinite(averagePace) ? averagePace.toFixed(2) : '0.00'}
            </Text>
            <Text>Ø Pace (min/km)</Text>
          </View>
        </View>
      </View>

      {!tracking ? (
        <Pressable style={styles.startButton} onPress={beginCountdown}>
          <Text style={styles.buttonText}>Workout starten</Text>
        </Pressable>
      ) : !paused ? (
        <Pressable style={styles.pauseButton} onPress={pauseTracking}>
          <Text style={styles.buttonText}>Pause</Text>
        </Pressable>
      ) : (
        <View style={styles.pauseOptions}>
          <Pressable style={styles.resumeButton} onPress={resumeTracking}>
            <Text style={styles.buttonText}>Fortsetzen</Text>
          </Pressable>
          <Pressable style={styles.stopButton} onPress={stopTracking}>
            <Text style={styles.buttonText}>Beenden</Text>
          </Pressable>
        </View>
      )}

      <Modal visible={showCountdown} transparent animationType="fade">
        <View style={styles.countdownModal}>
          <Text style={styles.countdownText}>{countdown}</Text>
          <View style={{ flexDirection: 'row', gap: 20 }}>
            <Pressable
              onPress={() => setCountdown((prev) => (prev ?? 0) + 10)}
              style={styles.modalButton}
            >
              <Text>+10 Sek.</Text>
            </Pressable>
            <Pressable
              onPress={() => setCountdown(0)}
              style={styles.modalButton}
            >
              <Text>Überspringen</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  statsBox: {
    backgroundColor: 'white',
    padding: 20,
    alignItems: 'center',
  },
  duration: {
    fontSize: 32,
    fontWeight: 'bold',
  },
  metricsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    width: '100%',
    marginTop: 12,
  },
  metric: {
    alignItems: 'center',
  },
  metricValue: {
    fontSize: 20,
    fontWeight: '600',
  },
  startButton: {
    position: 'absolute',
    bottom: 40,
    alignSelf: 'center',
    backgroundColor: '#4CAF50',
    padding: 16,
    borderRadius: 32,
  },
  pauseButton: {
    position: 'absolute',
    bottom: 40,
    alignSelf: 'center',
    backgroundColor: '#FF9800',
    padding: 16,
    borderRadius: 32,
  },
  pauseOptions: {
    position: 'absolute',
    bottom: 40,
    flexDirection: 'row',
    justifyContent: 'space-around',
    width: '100%',
    paddingHorizontal: 40,
  },
  resumeButton: {
    backgroundColor: '#4CAF50',
    padding: 16,
    borderRadius: 32,
  },
  stopButton: {
    backgroundColor: '#F44336',
    padding: 16,
    borderRadius: 32,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
  },
  countdownModal: {
    flex: 1,
    backgroundColor: 'white',
    justifyContent: 'center',
    alignItems: 'center',
  },
  countdownText: {
    fontSize: 64,
    fontWeight: 'bold',
  },
  modalButton: {
    backgroundColor: '#eee',
    padding: 12,
    borderRadius: 8,
    marginTop: 20,
  },
});