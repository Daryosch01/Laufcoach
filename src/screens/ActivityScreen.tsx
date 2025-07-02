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
import { useNavigation } from '@react-navigation/native';
import { getDistance, findClosestStepIndex, snapToRoute, getGermanInstruction } from '../utils/navigationUtils';
import { getBearing, getNavigationInstruction } from '../utils/simpleNavigation';

function formatPace(pace: number): string {
  if (!isFinite(pace) || pace <= 0) return "0:00";
  const min = Math.floor(pace);
  const sec = Math.round((pace - min) * 60);
  return `${min}:${sec.toString().padStart(2, '0')}`;
}

function formatPaceSpoken(pace: number): string {
  if (!isFinite(pace) || pace <= 0) return "unbekannt";
  const min = Math.floor(pace);
  const sec = Math.round((pace - min) * 60);
  return `${min} Minuten und ${sec} Sekunden pro Kilometer`;
}

function chunkRoute(route: LatLng[], chunkSize: number = 8): LatLng[][] {
  const chunks = [];
  for (let i = 0; i < route.length - 1; i += chunkSize) {
    // Jeder Chunk hat Start, bis zu chunkSize Wegpunkte, und Ziel
    const chunk = route.slice(i, i + chunkSize + 1);
    chunks.push(chunk);
  }
  return chunks;
}

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

  console.log('Directions-URL:', url);

  const res = await fetch(url);
  const json = await res.json();

  console.log('Directions-API-Response:', json);

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
  const navigation = useNavigation();
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

  function splitRouteToFineSteps(route: LatLng[], stepDist = 0.01): LatLng[] {
    if (!route || route.length < 2) return [];
    const fineSteps: LatLng[] = [route[0]];
    let last = route[0];
    let accDist = 0;
    for (let i = 1; i < route.length; i++) {
      const curr = route[i];
      const d = calculateDistance([last, curr]);
      accDist += d;
      if (accDist >= stepDist) {
        fineSteps.push(curr);
        last = curr;
        accDist = 0;
      }
    }
    if (fineSteps[fineSteps.length - 1] !== route[route.length - 1]) {
      fineSteps.push(route[route.length - 1]);
    }
    return fineSteps;
  }

  useEffect(() => {
    if (routeCoordinates && routeCoordinates.length > 1) {
      setTargetRoute(
        Array.isArray(routeCoordinates[0])
          ? routeCoordinates.flat()
          : routeCoordinates
      );
      setTargetDistance(routeDistance ?? null);
      setPath([]);
      setAutoStarted(false); 
    }
  }, [routeCoordinates, routeDistance]);

  useEffect(() => {
    if (targetRoute && targetRoute.length > 1) {
      const fineSteps = splitRouteToFineSteps(targetRoute, 0.01); // 0.01km = 10 Meter
      setNavSteps(fineSteps);
    }
  }, [targetRoute]); 


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

    navigation.setParams({
      routeCoordinates: undefined,
      routeDistance: undefined,
      routeName: undefined,
    } as any);

    setTargetRoute(null);
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
    setTargetRoute(null);

    navigation.setParams({
      routeCoordinates: undefined,
      routeDistance: undefined,
      routeName: undefined,
    } as any);

  };


  // --- GOOGLE DIRECTIONS NAVIGATION ---
  // Directions laden NUR wenn Route übergeben wurde
  useEffect(() => {
    console.log('Directions useEffect check', {
      routeCoordinates,
      targetRoute,
      length: routeCoordinates?.length,
      targetLength: targetRoute?.length
    });

    // --- Fix: Route flach machen, falls verschachtelt ---
    const flatRoute =
      Array.isArray(targetRoute) && Array.isArray(targetRoute[0])
        ? targetRoute.flat()
        : targetRoute;

    if (flatRoute && flatRoute.length > 1) {
      const chunks = chunkRoute(flatRoute, 25);

      const fetchAllDirections = async () => {
        let allSteps: any[] = [];
        let allPolyline: LatLng[] = [];

        for (const chunk of chunks) {
          const start = chunk[0];
          const ziel = chunk[chunk.length - 1];
          const waypoints = chunk.slice(1, -1);

          console.log('fetchGoogleDirections wird aufgerufen', { start, ziel, waypoints });

          const directions = await fetchGoogleDirections(start, ziel, waypoints);
          const leg = directions?.routes?.[0]?.legs?.[0];
          const steps = leg?.steps || [];
          allSteps = allSteps.concat(steps);

          // Polyline für diesen Abschnitt extrahieren
          for (const step of steps) {
            allPolyline.push({
              latitude: step.start_location.lat,
              longitude: step.start_location.lng,
            });
          }
          if (steps.length > 0) {
            allPolyline.push({
              latitude: steps[steps.length - 1].end_location.lat,
              longitude: steps[steps.length - 1].end_location.lng,
            });
          }
        }

        //setNavSteps(allSteps);
        setPolylineCoords(allPolyline);
        console.log('Directions geladen:', allSteps);
      };

      fetchAllDirections();
    }
  }, [routeCoordinates, targetRoute]);
  // --- ENDE GOOGLE DIRECTIONS NAVIGATION ---

  const speechQueue = useRef<{ type: 'nav' | 'pace' | 'motivation', text: string }[]>([]);
  
  function enqueueSpeech(type: 'nav' | 'pace' | 'motivation', text: string) {
    if (type === 'nav') {
      speechQueue.current.unshift({ type, text }); // Navigation immer vorne
    } else {
      // Nach Navigation, aber vor anderen pace/motivation
      const navIdx = speechQueue.current.findIndex(item => item.type !== 'nav');
      if (navIdx === -1) {
        speechQueue.current.push({ type, text });
      } else {
        speechQueue.current.splice(navIdx, 0, { type, text });
      }
    }
  } 
  
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
    if (trainingData?.distance_km) {
      setTargetDistance(trainingData.distance_km);
    }
  }, [trainingData]);

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
        enqueueSpeech(
          'pace',
          `Du hast ${currentKm} Kilometer geschafft. Deine aktuelle Pace ist ${formatPaceSpoken(averagePace)}. ${motivation ?? ""}`
        );
      });
    }

    if (
      targetDistance &&
      !lastKmAnnounced &&
      distance >= targetDistance - 1 &&
      distance < targetDistance
    ) {
      enqueueSpeech('pace', "Letzter Kilometer! Gib nochmal alles!");
      setLastKmAnnounced(true);
    }

    if (
      targetDistance &&
      !last100mAnnounced &&
      distance >= targetDistance - 0.1 &&
      distance < targetDistance
    ) {
      enqueueSpeech('pace', "Nur noch 100 Meter! Endspurt!");
      setLast100mAnnounced(true);
    }
  }, [distance, averagePace, targetPace, tracking, paused, lastKmAnnounced, last100mAnnounced, targetDistance]);

  useEffect(() => {
    setLastKmAnnounced(false);
    setLast100mAnnounced(false);
    lastAnnouncedKm.current = 0;
  }, [tracking, trainingData]);

  
  const lastPaceFeedbackKm = useRef(-1);
  const paceFeedbacksThisKm = useRef(0);
  const lastPaceFeedbackMeter = useRef(0);

  useEffect(() => {
    if (!tracking || paused || distance < 0.1) return;

    const currentKm = Math.floor(distance);
    const meterInKm = distance - currentKm;

    // --- Zähler für Pace-Feedbacks bei neuem Kilometer zurücksetzen ---
    if (currentKm !== lastPaceFeedbackKm.current) {
      paceFeedbacksThisKm.current = 0;
      lastPaceFeedbackKm.current = currentKm;
      lastPaceFeedbackMeter.current = 0;
    }

    // DEBUG: Logge alle relevanten Werte
    // console.log(
    //   'distance:', distance,
    //   'currentKm:', currentKm,
    //   'meterInKm:', meterInKm,
    //   'averagePace:', averagePace,
    //   'targetPace:', targetPace,
    //   'paceDiff:', averagePace - (targetPace ?? 0),
    //   'lastPaceFeedbackKm:', lastPaceFeedbackKm.current,
    //   'paceFeedbacksThisKm:', paceFeedbacksThisKm.current,
    //   'lastPaceFeedbackMeter:', lastPaceFeedbackMeter.current
    // );

    // --- Kilometeransage + Motivation ---
    if (
      tracking &&
      !paused &&
      averagePace > 0 &&
      currentKm > lastAnnouncedKm.current
    ) {
      lastAnnouncedKm.current = currentKm;
      lastPaceFeedbackKm.current = currentKm; // Pace-Feedback in diesem km unterdrücken
      paceFeedbacksThisKm.current = 0;
      lastPaceFeedbackMeter.current = 0;

      giveMotivationalFeedback(distance, averagePace, targetPace).then((motivation) => {
        enqueueSpeech(
          'pace',
          `Du hast ${currentKm} Kilometer geschafft. Deine aktuelle Pace ist ${formatPaceSpoken(averagePace)}. ${motivation ?? ""}`
        );
      });
      return;
    }

    // --- Pace-Feedback (max 2x pro km, mind. 500m Abstand, nicht in den ersten 100m), nur wenn targetPace vorhanden ---
    if (
      targetPace &&
      averagePace > 0 &&
      paceFeedbacksThisKm.current < 2 &&
      meterInKm > 0.1 && // weiter als 100m nach dem letzten vollen km
      (meterInKm - lastPaceFeedbackMeter.current > 0.5 || paceFeedbacksThisKm.current === 0) // mind. 500m Abstand nach dem ersten Feedback
    ) {
      const paceDifference = averagePace - targetPace;

      if (paceDifference > 0.3) {
        giveMotivationalFeedback(distance, averagePace, targetPace, true, false).then((motivation) => {
          if (motivation) enqueueSpeech('motivation', motivation);
        });
        paceFeedbacksThisKm.current += 1;
        lastPaceFeedbackMeter.current = meterInKm;
      } else if (paceDifference < -0.3) {
        giveMotivationalFeedback(distance, averagePace, targetPace, false, true).then((motivation) => {
          if (motivation) enqueueSpeech('motivation', motivation);
        });
        paceFeedbacksThisKm.current += 1;
        lastPaceFeedbackMeter.current = meterInKm;
      }
    }
  }, [distance, averagePace, targetPace, tracking, paused]);

  useEffect(() => {
    const playQueue = async () => {
      if (isSpeaking.current || speechQueue.current.length === 0) return;

      isSpeaking.current = true;
        const next = speechQueue.current.shift();
        if (next) {
          await speakWithElevenLabs(next.text);
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
        let newCoord = {
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
        };
        // --- Snap-to-Route (nur wenn Route vorhanden)
        if (targetRoute && targetRoute.length > 1) {
          newCoord = snapToRoute(newCoord, targetRoute);
        }
        setRegion(newCoord);
        setPath((prev) => {
          const updated = [...prev, newCoord];
          const dist = calculateDistance(updated);
          setDistance(dist);
          return updated;
        });
      }
    );

    // watchRef.current = await Location.watchPositionAsync(
    //   {
    //     accuracy: Location.Accuracy.Highest,
    //     timeInterval: 1000,
    //     distanceInterval: 1,
    //   },
    //   (loc) => {
    //     const newCoord = {
    //       latitude: loc.coords.latitude,
    //       longitude: loc.coords.longitude,
    //     };
    //     setRegion(newCoord);
    //     setPath((prev) => {
    //       const updated = [...prev, newCoord];
    //       const dist = calculateDistance(updated);
    //       setDistance(dist);
    //       return updated;
    //     });
    //   }
    // );
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
    setTargetRoute(null);
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

  // --- EINFACHE NAVIGATION ---
  const [lastWaypointIndex, setLastWaypointIndex] = useState(0);
  const [currentBearing, setCurrentBearing] = useState<number | undefined>(undefined);
  const lastNavInstruction = useRef<string>('');
  const lastNavTime = useRef<number>(0);

    const flatTargetRoute =
      Array.isArray(targetRoute) && Array.isArray(targetRoute[0])
        ? targetRoute.flat()
        : targetRoute;

  useEffect(() => {
    if (!tracking || !flatTargetRoute || flatTargetRoute.length < 2 || path.length < 2) return;

    const currentPos = path[path.length - 1];
    const prevPos = path[path.length - 2];
    
    // Berechne aktuelle Bewegungsrichtung
    const movementBearing = getBearing(prevPos, currentPos);
    setCurrentBearing(movementBearing);
    
    // Hole Navigation-Anweisung
    const navResult = getNavigationInstruction(currentPos, flatTargetRoute, lastWaypointIndex, movementBearing);
    
    if (navResult.instruction && navResult.distance > 0) {
      const now = Date.now();
      const timeSinceLastNav = now - lastNavTime.current;
      
      // Verhindere Spam: Mindestens 10 Sekunden zwischen gleichen Anweisungen
      if (navResult.instruction !== lastNavInstruction.current || timeSinceLastNav > 10000) {
        let message = '';
        
        if (navResult.distance <= 50) {
          message = `In ${Math.round(navResult.distance)} Metern: ${navResult.instruction}`;
        } else if (navResult.distance <= 100) {
          message = `In etwa ${Math.round(navResult.distance)} Metern: ${navResult.instruction}`;
        }
        
        if (message) {
          enqueueSpeech('nav', message);
          lastNavInstruction.current = navResult.instruction;
          lastNavTime.current = now;
        }
      }
    }
    
    // Update Waypoint Index
    if (navResult.newWaypointIndex > lastWaypointIndex) {
      setLastWaypointIndex(navResult.newWaypointIndex);
    }
  }, [path, tracking, flatTargetRoute, lastWaypointIndex]);
  // --- ENDE EINFACHE NAVIGATION ---


  // const [lastStepIdxSpoken, setLastStepIdxSpoken] = useState(-1);

  // function getBearing(a: LatLng, b: LatLng) {
  //   const toRad = (v: number) => (v * Math.PI) / 180;
  //   const toDeg = (v: number) => (v * 180) / Math.PI;
  //   const dLon = toRad(b.longitude - a.longitude);
  //   const lat1 = toRad(a.latitude);
  //   const lat2 = toRad(b.latitude);
  //   const y = Math.sin(dLon) * Math.cos(lat2);
  //   const x = Math.cos(lat1) * Math.sin(lat2) -
  //             Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  //   return (toDeg(Math.atan2(y, x)) + 360) % 360;
  // }


  // useEffect(() => {
  //   if (!tracking || navSteps.length < 5 || path.length === 0) return;
  //   const currentPos = path[path.length - 1];

  //   // Finde den nächsten Step, der weniger als 10 Meter entfernt ist
  //   let idx = -1;
  //   for (let i = lastStepIdxSpoken + 1; i < navSteps.length; i++) {
  //     const d = calculateDistance([currentPos, navSteps[i]]);
  //     if (d < 0.01) { // 10 Meter
  //       idx = i;
  //       break;
  //     }
  //   }
  //   if (idx === -1) return;

  //   // Prüfe Richtungsänderung nach 4 Steps (~40 Meter)
  //   if (idx + 4 < navSteps.length) {
  //     const bearingNow = getBearing(navSteps[idx], navSteps[idx + 1]);
  //     const bearingFuture = getBearing(navSteps[idx], navSteps[idx + 4]);
  //     let angleDiff = Math.abs(bearingFuture - bearingNow);
  //     if (angleDiff > 180) angleDiff = 360 - angleDiff;
  //     if (angleDiff > 30 && idx > lastStepIdxSpoken) {
  //       // Ansage machen
  //       let instruction = '';
  //       if (angleDiff > 120) {
  //         instruction = 'Wende dich!';
  //       } else if (bearingFuture - bearingNow > 0) {
  //         instruction = 'Rechts abbiegen';
  //       } else {
  //         instruction = 'Links abbiegen';
  //       }
  //       enqueueSpeech('nav', instruction);
  //       setLastStepIdxSpoken(idx);
  //     }
  //   }
  // }, [path, tracking, navSteps, lastStepIdxSpoken]);

  /*
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

      function distanceToSegment(p: LatLng, v: LatLng, w: LatLng) {
        const toRad = (value: number) => (value * Math.PI) / 180;
        const R = 6371;
        const lat1 = toRad(v.latitude);
        const lon1 = toRad(v.longitude);
        const lat2 = toRad(w.latitude);
        const lon2 = toRad(w.longitude);
        const latP = toRad(p.latitude);
        const lonP = toRad(p.longitude);

        const A = { x: lat1, y: lon1 };
        const B = { x: lat2, y: lon2 };
        const P = { x: latP, y: lonP };
        const AB = { x: B.x - A.x, y: B.y - A.y };
        const AP = { x: P.x - A.x, y: P.y - A.y };
        const ab2 = AB.x * AB.x + AB.y * AB.y;
        const ap_ab = AP.x * AB.x + AP.y * AB.y;
        let t = ab2 === 0 ? 0 : ap_ab / ab2;
        t = Math.max(0, Math.min(1, t));
        const closest = { x: A.x + AB.x * t, y: A.y + AB.y * t };

        const dLat = P.x - closest.x;
        const dLon = P.y - closest.y;
        const a = Math.sin(dLat / 2) ** 2 +
          Math.sin(dLon / 2) ** 2 * Math.cos(P.x) * Math.cos(closest.x);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c; // in km
      }

      //const stepStart = { latitude: nextStep.start_location.lat, longitude: nextStep.start_location.lng };
      //const stepEnd = { latitude: nextStep.end_location.lat, longitude: nextStep.end_location.lng };
      // RICHTIG:
      const stepStart = { latitude: nextStep.latitude, longitude: nextStep.longitude };
      // Wenn du einen Endpunkt brauchst, nimm navSteps[currentStepIdx+1] (sofern vorhanden):
      const stepEnd = navSteps[currentStepIdx + 1]
        ? { latitude: navSteps[currentStepIdx + 1].latitude, longitude: navSteps[currentStepIdx + 1].longitude }
        : stepStart;  
      
      const distToStep = distanceToSegment(currentPos, stepStart, stepEnd);

      // --- Nur einmal pro Step ansagen ---
      if (distToStep < 0.04 && currentStepIdx > lastStepIdxSpoken) {
        const maneuverMap: Record<string, string> = {
          'turn-right': 'Rechts abbiegen',
          'turn-left': 'Links abbiegen',
          'straight': 'Geradeaus weiterlaufen',
          'uturn-left': 'Wende nach links',
          'uturn-right': 'Wende nach rechts',
          'fork-right': 'An der Gabelung rechts halten',
          'fork-left': 'An der Gabelung links halten',
          'merge': 'Zusammenführen',
          'ramp-right': 'Rechts auf die Rampe',
          'ramp-left': 'Links auf die Rampe',
        };
        for (let i = currentStepIdx; i < Math.min(currentStepIdx + 5, navSteps.length); i++) {
          const step = navSteps[i];
          const stepStart = {
            latitude: step.start_location.lat,
            longitude: step.start_location.lng,
          };
          const stepEnd = {
            latitude: step.end_location.lat,
            longitude: step.end_location.lng,
          };

          const distToStep = distanceToSegment(currentPos, stepStart, stepEnd);

          if (distToStep < 0.04 && i > lastStepIdxSpoken) {
            let instruction = '';
            if (step.maneuver && maneuverMap[step.maneuver]) {
              instruction = maneuverMap[step.maneuver];
            } else {
              instruction = step.html_instructions.replace(/<[^>]+>/g, '');
              instruction = instruction.replace(/nach (Norden|Süden|Westen|Osten)/gi, 'geradeaus');
            }

            enqueueSpeech('nav', instruction);
            setLastStepIdxSpoken(i);
            setCurrentStepIdx(i + 1);
            break;
          }
        }
      }
    }, [path, tracking, navSteps, currentStepIdx, routeCoordinates, lastStepIdxSpoken]);
  */
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
        {flatTargetRoute && flatTargetRoute.length > 1 && (
          <Polyline coordinates={flatTargetRoute} strokeWidth={3} strokeColor="green" />
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
              {isFinite(averagePace) ? formatPace(averagePace) : '0:00'}
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