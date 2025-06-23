import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Dimensions,
  Modal,
  Alert,
  Linking,
  Platform,
} from 'react-native';
import MapView, {
  Polyline,
  PROVIDER_GOOGLE,
  LatLng
} from 'react-native-maps';
import * as Location from 'expo-location';
import { supabase } from '../api/supabase';
import { RouteProp, useRoute } from '@react-navigation/native';
import * as Speech from 'expo-speech';
import { OPENAI_API_KEY, GOOGLE_MAPS_API_KEY } from '@env';
import { speakWithElevenLabs } from '../services/elevenlabsService';
import * as Battery from 'expo-battery';
import { Audio } from 'expo-av';

export type RootStackParamList = {
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
    routeCoordinates?: LatLng[];
    routeDistance?: number;
    routeName?: string;
  };
  // ... other routes
};

// --- GOOGLE DIRECTIONS NAVIGATION ---
async function fetchGoogleDirections(
  origin: LatLng,
  destination: LatLng,
  waypoints?: LatLng[]
) {
  const originStr = `${origin.latitude},${origin.longitude}`;
  const destStr = `${destination.latitude},${destination.longitude}`;
  const waypointsStr =
    waypoints && waypoints.length > 0
      ? '&waypoints=' + waypoints.map(w => `${w.latitude},${w.longitude}`).join('|')
      : '';
  const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${originStr}&destination=${destStr}${waypointsStr}&mode=walking&language=de&key=${GOOGLE_MAPS_API_KEY}`;

  const res = await fetch(url);
  const json = await res.json();
  return json;
}
// --- ENDE GOOGLE DIRECTIONS NAVIGATION ---

function speakGerman(text: string, voice?: string) {
  Speech.speak(text, {
    language: 'de-DE',
    voice,
    rate: 1.0,
    pitch: 1.0,
  });
}

async function playWorkoutStartedAudio() {
  try {
    const { sound } = await Audio.Sound.createAsync(
      require('../../assets/workout_gestartet.mp3')
    );
    await sound.playAsync();
    sound.setOnPlaybackStatusUpdate(status => {
      if (status.isLoaded && status.didJustFinish) {
        sound.unloadAsync();
      }
    });
  } catch (e) {
    console.warn('Audio konnte nicht abgespielt werden:', e);
  }
}

const { width } = Dimensions.get('window');

const checkBatterySaver = async (): Promise<boolean> => {
  try {
    const isOn = await Battery.isLowPowerModeEnabledAsync();
    return isOn;
  } catch (error) {
    console.warn('Fehler beim Prüfen des Energiesparmodus:', error);
    return false;
  }
};

export default function ActivityScreen() {
  const route = useRoute<RouteProp<RootStackParamList, 'Activity'>>();
  const routeCoordinates = route.params?.routeCoordinates;
  const routeDistance = route.params?.routeDistance;
  const routeName = route.params?.routeName; 
  const trainingData = route.params?.trainingData;

  const [region, setRegion] = useState<LatLng | null>(null);
  const [path, setPath] = useState<LatLng[]>([]);
  const [distance, setDistance] = useState(0);
  const [duration, setDuration] = useState(0);
  const [tracking, setTracking] = useState(false);
  const [paused, setPaused] = useState(false);
  const [hasStartedAutomatically, setHasStartedAutomatically] = useState(false);
  const [averagePace, setAveragePace] = useState(0);
  const [targetPace, setTargetPace] = useState<number | null>(null);
  const [calories, setCalories] = useState(0);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [showCountdown, setShowCountdown] = useState(false);
  const lastAnnouncedKm = useRef(0);
  const [userWeight, setUserWeight] = useState<number>(70); // Default: 70kg
  const getDynamicMET = (pace: number): number => {
    if (pace > 9) return 6;
    if (pace > 8) return 7;
    if (pace > 7) return 8;
    if (pace > 6) return 9;
    if (pace > 5) return 10;
    if (pace > 4.5) return 11;
    return 12;
  };

  const [targetRoute, setTargetRoute] = useState<LatLng[] | null>(null);
  const [targetDistance, setTargetDistance] = useState<number | null>(null);

  // --- GOOGLE DIRECTIONS NAVIGATION ---
  const [navSteps, setNavSteps] = useState<any[]>([]);
  const [currentStepIdx, setCurrentStepIdx] = useState(0);
  const [polylineCoords, setPolylineCoords] = useState<LatLng[]>([]);
  // --- ENDE GOOGLE DIRECTIONS NAVIGATION ---

  // Automatischer Start nur EINMAL pro Route
  const [autoStarted, setAutoStarted] = useState(false);

  useEffect(() => {
    if (routeCoordinates && routeDistance) {
      setTargetRoute(routeCoordinates);
      setTargetDistance(routeDistance);
    }
  }, [routeCoordinates, routeDistance]);

  // Automatischer Start NUR wenn Route übergeben wurde (Routenstart)
  useEffect(() => {
    if (
      routeCoordinates &&
      routeCoordinates.length > 1 &&
      !tracking &&
      !showCountdown &&
      !autoStarted
    ) {
      setAutoStarted(true);
      beginCountdown();
    }
  }, [routeCoordinates, tracking, showCountdown, autoStarted]);

  // Setze autoStarted zurück, wenn Workout beendet oder abgebrochen wird
  const stopTracking = async () => {
    setTracking(false);
    setPaused(false);
    setAutoStarted(false);

    if (watchRef.current) {
      watchRef.current.remove();
    }

    try {
      const { data: session } = await supabase.auth.getUser();
      const userId = session?.user?.id;

      if (!userId) {
        return;
      }

      const workoutTitle =
        trainingData?.title && trainingData?.title.length > 0
          ? trainingData.title
          : "Workout vom " + new Date().toLocaleDateString('de-DE');

      await supabase.from('workouts').insert({
        user_id: userId,
        name: workoutTitle,
        distance,
        duration,
        calories,
        pace: averagePace,
        path,
      });

    } catch (err) {
      // Fehlerbehandlung
    }

    setDuration(0);
    setDistance(0);
    setCalories(0);
    setAveragePace(0);
    setPath([]);
  };


  // --- GOOGLE DIRECTIONS NAVIGATION ---
  // Directions laden NUR wenn Route übergeben wurde
  useEffect(() => {
    if (
      routeCoordinates &&
      routeCoordinates.length > 1 &&
      targetRoute &&
      targetRoute.length > 1
    ) {
      const start = targetRoute[0];
      const ziel = targetRoute[targetRoute.length - 1];
      const waypoints = targetRoute.slice(1, -1);
      fetchGoogleDirections(start, ziel, waypoints).then(directions => {
        const steps = directions.routes[0]?.legs[0]?.steps || [];
        setNavSteps(steps);

        // Polyline für die Karte extrahieren
        const polyline = [];
        for (const step of steps) {
          polyline.push({
            latitude: step.start_location.lat,
            longitude: step.start_location.lng,
          });
        }
        // Zielpunkt hinzufügen
        if (steps.length > 0) {
          polyline.push({
            latitude: steps[steps.length - 1].end_location.lat,
            longitude: steps[steps.length - 1].end_location.lng,
          });
        }
        setPolylineCoords(polyline);
      });
    }
  }, [routeCoordinates, targetRoute]);
  // --- ENDE GOOGLE DIRECTIONS NAVIGATION ---

  const speechQueue = useRef<string[]>([]);
  const isSpeaking = useRef(false);

  const [germanMaleVoice, setGermanMaleVoice] = useState<string | undefined>(undefined);

  useEffect(() => {
    Speech.getAvailableVoicesAsync?.().then(voices => {
      const male = voices?.find(
        v =>
          v.language === 'de-DE' &&
          (v.name?.toLowerCase().includes('male') ||
          v.name?.toLowerCase().includes('mann') ||
          v.name?.toLowerCase().includes('paul') ||
          v.name?.toLowerCase().includes('max'))
      );
      setGermanMaleVoice(male?.identifier);
    });
  }, []);

  useEffect(() => {
    if (trainingData) {
      setHasStartedAutomatically(false);
    }
  }, [trainingData]);

  useEffect(() => {
    if (trainingData && !tracking && !hasStartedAutomatically) {
      setHasStartedAutomatically(true);
      beginCountdown();
    }
  }, [trainingData, tracking, hasStartedAutomatically]);

  useEffect(() => {
    if (trainingData?.target_pace_min_per_km) {
      const [min, sec] = trainingData.target_pace_min_per_km.split(':').map(Number);
      const decimalPace = min + sec / 60;
      setTargetPace(decimalPace);
    }
  }, []);

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
    const fetchUserWeight = async () => {
      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser();

      if (authError || !user) {
        setUserWeight(70);
        return;
      }

      const { data, error } = await supabase
        .from('coach_profiles')
        .select('weight')
        .eq('user_id', user.id)
        .single();

      if (error || !data?.weight) {
        setUserWeight(70);
      } else {
        setUserWeight(data.weight);
      }
    };

    fetchUserWeight();
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

      const MET = getDynamicMET(pace);
      const kcal = MET * userWeight * (duration / 3600);
      setCalories(parseFloat(kcal.toFixed(1)));
    }
  }, [distance, duration, tracking, paused]);

  const [lastKmAnnounced, setLastKmAnnounced] = useState(false);
  const [last100mAnnounced, setLast100mAnnounced] = useState(false);

  useEffect(() => {
    if (!tracking || paused || distance < 1) return;

    const currentKm = Math.floor(distance);

    if (
      tracking &&
      !paused &&
      averagePace > 0 &&
      Math.floor(distance) > lastAnnouncedKm.current
    ) {
      lastAnnouncedKm.current = Math.floor(distance);

      giveMotivationalFeedback(distance, averagePace, targetPace).then((motivation) => {
        if (motivation) speechQueue.current.push(motivation);
      });
    }

    if (
      targetDistance &&
      !lastKmAnnounced &&
      distance >= targetDistance - 1 &&
      distance < targetDistance
    ) {
      speechQueue.current.push("Letzter Kilometer! Gib nochmal alles!");
      setLastKmAnnounced(true);
    }

    if (
      targetDistance &&
      !last100mAnnounced &&
      distance >= targetDistance - 0.1 &&
      distance < targetDistance
    ) {
      speechQueue.current.push("Nur noch 100 Meter! Endspurt!");
      setLast100mAnnounced(true);
    }
  }, [distance, averagePace, targetPace, tracking, paused, lastKmAnnounced, last100mAnnounced, targetDistance]);

  useEffect(() => {
    setLastKmAnnounced(false);
    setLast100mAnnounced(false);
    lastAnnouncedKm.current = 0;
  }, [tracking, trainingData]);

  useEffect(() => {
    if (!tracking || paused || !targetPace || averagePace === 0) return;

    const paceDifference = averagePace - targetPace;

    // Zu langsam
    if (paceDifference > 0.3 && lastAnnouncedKm.current < Math.floor(distance)) {
      giveMotivationalFeedback(distance, averagePace, targetPace, true, false).then((motivation) => {
        if (motivation) speechQueue.current.push(motivation);
      });
      lastAnnouncedKm.current = Math.floor(distance);
    }

    // Zu schnell
    if (paceDifference < -0.3 && lastAnnouncedKm.current < Math.floor(distance)) {
      giveMotivationalFeedback(distance, averagePace, targetPace, false, true).then((motivation) => {
        if (motivation) speechQueue.current.push(motivation);
      });
      lastAnnouncedKm.current = Math.floor(distance);
    }
  }, [averagePace, targetPace, tracking, paused, distance]);

  useEffect(() => {
    const playQueue = async () => {
      if (isSpeaking.current || speechQueue.current.length === 0) return;

      isSpeaking.current = true;
      const nextText = speechQueue.current.shift();
      if (nextText) {
        await speakWithElevenLabs(nextText);
      }
      isSpeaking.current = false;
    };

    const interval = setInterval(playQueue, 500);
    return () => clearInterval(interval);
  }, []);

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

  const checkBatterySaverAndStart = async () => {
    const isLowPowerModeEnabled = await Battery.isLowPowerModeEnabledAsync();
    if (isLowPowerModeEnabled) {
      Alert.alert(
        'Energiesparmodus aktiviert',
        'Der Energiesparmodus kann die GPS-Genauigkeit verringern.',
        [
          {
            text: 'Zu den Einstellungen',
            onPress: () => Linking.openSettings(),
            style: 'default',
          },
          {
            text: 'Trotzdem starten',
            onPress: () => beginCountdown(),
            style: 'cancel',
          },
        ],
        { cancelable: true }
      );
    } else {
      beginCountdown();
    }
  };

  const countdownTimer = useRef<NodeJS.Timeout | null>(null);
  const [countdownStarted, setCountdownStarted] = useState(false);

  useEffect(() => {
    if (countdown === null) return;

    if (countdownTimer.current) {
      clearTimeout(countdownTimer.current);
      countdownTimer.current = null;
    }

    if (countdown === 0 && !countdownStarted) {
      setCountdownStarted(true);
      playWorkoutStartedAudio();
      startTracking();
      setCountdown(null);
      setShowCountdown(false);
      return;
    }

    if (countdown > 0) {
      speakGerman(String(countdown), germanMaleVoice);
      countdownTimer.current = setTimeout(() => {
        setCountdown((prev) => (prev ?? 1) - 1);
      }, 1000);
    }

    return () => {
      if (countdownTimer.current) {
        clearTimeout(countdownTimer.current);
        countdownTimer.current = null;
      }
      Speech.stop();
    };
  }, [countdown, germanMaleVoice, countdownStarted]);

  useEffect(() => {
    if (countdown !== null && countdown > 0) {
      setCountdownStarted(false);
    }
  }, [countdown]);


  const cancelWorkout = () => {
    if (watchRef.current) {
      watchRef.current.remove();
    }
    setTracking(false);
    setPaused(false);
    setDuration(0);
    setDistance(0);
    setCalories(0);
    setAveragePace(0);
    setPath([]);
    setTargetPace(null);
    lastAnnouncedKm.current = 0;
  };

  const pauseTracking = () => setPaused(true);
  const resumeTracking = () => setPaused(false);

  async function giveMotivationalFeedback(
    currentDistance: number,
    currentPace: number,
    targetPace?: number | null,
    isTooSlow?: boolean,
    isTooFast?: boolean
  ): Promise<string | null> {
    let prompt = "";

    if (isTooSlow) {
      prompt = `Ich laufe gerade langsamer als meine Zielpace von ${targetPace?.toFixed(2) ?? 'unbekannt'} min/km. Gib mir einen motivierenden, aber nicht zu langen Satz auf Deutsch (maximal 8 Wörter), der mich freundlich dazu bringt, wieder mein Zieltempo zu erreichen. Beispiele: "Du hast noch Kraft, gib jetzt etwas mehr Gas!", "Hol dir dein Tempo zurück, du schaffst das!"`;
    } else if (isTooFast) {
      prompt = `Ich laufe gerade schneller als meine Zielpace von ${targetPace?.toFixed(2) ?? 'unbekannt'} min/km. Gib mir einen kurzen, freundlichen Hinweis auf Deutsch (maximal 8 Wörter), dass ich etwas langsamer machen soll. Beispiele: "Super Einsatz, aber halte dein Tempo!", "Etwas langsamer, damit du durchhältst!"`;
    } else {
      prompt = `Gib mir einen sehr kurzen, motivierenden Spruch auf Deutsch (maximal 5 Wörter) für einen Läufer. Keine Sätze, nur knackige Sprüche wie "Weiter so!", "Stark bleiben!", "Let's go!"`;
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.8,
      }),
    });

    const json = await response.json();
    const message = json?.choices?.[0]?.message?.content?.trim();

    return message ?? null;
  }

  // --- GOOGLE DIRECTIONS NAVIGATION ---
  // Navigationsansagen nur wenn Route übergeben wurde
  useEffect(() => {
    if (
      !tracking ||
      navSteps.length === 0 ||
      path.length === 0 ||
      !routeCoordinates
    ) return;
    const currentPos = path[path.length - 1];
    const nextStep = navSteps[currentStepIdx];
    if (!nextStep) return;

    const stepLat = nextStep.start_location.lat;
    const stepLng = nextStep.start_location.lng;
    const dist = calculateDistance([
      currentPos,
      { latitude: stepLat, longitude: stepLng }
    ]);
    if (dist < 0.04) { // 40 Meter vor dem Step
      const instruction = nextStep.html_instructions.replace(/<[^>]+>/g, '');
      speechQueue.current.push(instruction);
      setCurrentStepIdx(idx => idx + 1);
    }
  }, [path, tracking, navSteps, currentStepIdx, routeCoordinates]);
  // --- ENDE GOOGLE DIRECTIONS NAVIGATION ---

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
        {/* --- GOOGLE DIRECTIONS NAVIGATION --- */}
        {routeCoordinates && polylineCoords.length > 0 && (
          <Polyline coordinates={polylineCoords} strokeWidth={3} strokeColor="green" />
        )}
        {/* --- ENDE GOOGLE DIRECTIONS NAVIGATION --- */}
      </MapView>

      {tracking && (
        <Pressable onPress={cancelWorkout} style={styles.cancelButton}>
          <Text style={{ color: 'white', fontSize: 20 }}>✕</Text>
        </Pressable>
      )}

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
        <Pressable style={styles.startButton} onPress={checkBatterySaverAndStart}>
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
        <View
          style={{
            flex: 1,
            backgroundColor: 'rgba(0,0,0,0.4)',
            justifyContent: 'center',
            alignItems: 'center',
          }}
        >
          <View
            style={{
              backgroundColor: 'white',
              padding: 20,
              borderRadius: 16,
              alignItems: 'center',
            }}
          >
            <Text style={{ fontSize: 64, fontWeight: 'bold' }}>{countdown}</Text>
            <View style={{ flexDirection: 'row', marginTop: 20, gap: 12 }}>
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
  cancelButton: {
    position: 'absolute',
    top: 20,
    right: 20,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#F44336',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
});