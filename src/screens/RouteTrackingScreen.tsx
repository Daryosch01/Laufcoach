import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
  Pressable,
  TextInput,
  Modal,
  Alert
} from 'react-native';
import MapView, {
  Marker,
  Polyline,
  PROVIDER_GOOGLE,
  LatLng,
  Region
} from 'react-native-maps';
import * as Location from 'expo-location';
import axios from 'axios';
import { GOOGLE_MAPS_API_KEY } from '@env';
import { supabase } from '../api/supabase';
import { useNavigation } from '@react-navigation/native'; // ✅ Navigation importieren
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/types'; // Pfad ggf. anpassen

export default function RouteTrackingScreen() {
  const [location, setLocation] = useState<Location.LocationObject | null>(null);
  const [region, setRegion] = useState<Region | null>(null);
  const [markers, setMarkers] = useState<LatLng[]>([]);
  const [routeCoords, setRouteCoords] = useState<LatLng[][]>([]);
  const [editMode, setEditMode] = useState(false);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [routeName, setRouteName] = useState('');
  const [distance, setDistance] = useState(0);

  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  useEffect(() => {
    (async () => {
      const loc = await Location.getCurrentPositionAsync({});
      setLocation(loc);
      setRegion({
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      });
    })();
  }, []);

  const calculateDistance = (segments: LatLng[][]) => {
    const toRad = (value: number) => (value * Math.PI) / 180;
    let total = 0;
    segments.forEach(points => {
      for (let i = 1; i < points.length; i++) {
        const R = 6371;
        const dLat = toRad(points[i].latitude - points[i - 1].latitude);
        const dLon = toRad(points[i].longitude - points[i - 1].longitude);
        const lat1 = toRad(points[i - 1].latitude);
        const lat2 = toRad(points[i].latitude);

        const a =
          Math.sin(dLat / 2) ** 2 +
          Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        total += R * c;
      }
    });
    return total;
  };

  const handleMapPress = async (event: any) => {
    if (!editMode) return;
    const { latitude, longitude } = event.nativeEvent.coordinate;
    const newMarkers = [...markers, { latitude, longitude }];
    setMarkers(newMarkers);

    if (newMarkers.length >= 2) {
      const origin = newMarkers[newMarkers.length - 2];
      const destination = newMarkers[newMarkers.length - 1];
      try {
        const res = await axios.get(
          'https://maps.googleapis.com/maps/api/directions/json',
          {
            params: {
              origin: `${origin.latitude},${origin.longitude}`,
              destination: `${destination.latitude},${destination.longitude}`,
              key: GOOGLE_MAPS_API_KEY,
              mode: 'walking',
            },
          }
        );

        if (res.data.routes.length > 0) {
          const points = decodePolyline(res.data.routes[0].overview_polyline.points);
          const updatedSegments = [...routeCoords, points];
          setRouteCoords(updatedSegments);
          setDistance(calculateDistance(updatedSegments));
        }
      } catch (err) {
        console.error('Directions Error:', err);
      }
    }
  };

  const decodePolyline = (t: string) => {
    let points: LatLng[] = [];
    let index = 0, lat = 0, lng = 0;
    while (index < t.length) {
      let b, shift = 0, result = 0;
      do {
        b = t.charCodeAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      const dlat = (result & 1) ? ~(result >> 1) : result >> 1;
      lat += dlat;

      shift = 0;
      result = 0;
      do {
        b = t.charCodeAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      const dlng = (result & 1) ? ~(result >> 1) : result >> 1;
      lng += dlng;

      points.push({ latitude: lat / 1e5, longitude: lng / 1e5 });
    }
    return points;
  };

  const resetRoute = () => {
    setMarkers([]);
    setRouteCoords([]);
    setDistance(0);
    setEditMode(false);
  };

  const undoLastMarker = () => {
    if (markers.length > 1) {
      const updatedMarkers = markers.slice(0, -1);
      const updatedSegments = routeCoords.slice(0, -1);
      setMarkers(updatedMarkers);
      setRouteCoords(updatedSegments);
      setDistance(calculateDistance(updatedSegments));
    } else if (markers.length === 1) {
      setMarkers([]);
      setRouteCoords([]);
      setDistance(0);
    }
  };

  const handleSave = async () => {
    const { data: session } = await supabase.auth.getUser();
    const userId = session.user?.id;

    if (!userId) {
      Alert.alert('Nicht eingeloggt', 'Bitte zuerst anmelden.');
      return;
    }

    const { error } = await supabase.from('routes').insert({
      user_id: userId,
      name: routeName,
      distance,
      coordinates: routeCoords,
    });

    if (error) {
      console.error(error);
      Alert.alert('Fehler beim Speichern');
      return;
    }

    Alert.alert('Erfolg', 'Route gespeichert!');
    resetRoute();
    setShowSaveModal(false);
    setRouteName('');
  };

  if (!region) return <View><Text>Karte lädt...</Text></View>;

  return (
    <View style={styles.container}>
      <MapView
        provider={PROVIDER_GOOGLE}
        style={StyleSheet.absoluteFillObject}
        region={region}
        onPress={handleMapPress}
      >
        {location && (
          <Marker
            coordinate={{
              latitude: location.coords.latitude,
              longitude: location.coords.longitude,
            }}
            title="Dein Standort"
            pinColor="blue"
          />
        )}
        {markers.map((marker, index) => (
          <Marker key={index} coordinate={marker} pinColor="skyblue" />
        ))}
        {routeCoords.map((segment, index) => (
          <Polyline key={index} coordinates={segment} strokeWidth={4} strokeColor="blue" />
        ))}
      </MapView>

      {!editMode ? (
        <View style={styles.buttonContainer}>
          <Pressable style={styles.button} onPress={() => setEditMode(true)}>
            <Text style={styles.buttonText}>Neue Route</Text>
          </Pressable>

          {/* ✅ Button navigiert jetzt zur Profilseite */}
          <Pressable style={styles.button} onPress={() => navigation.navigate('Profile')}>
            <Text style={styles.buttonText}>Gespeicherte Routen</Text>
          </Pressable>
        </View>
      ) : (
        <>
          <Pressable style={styles.saveButton} onPress={() => setShowSaveModal(true)}>
            <Text style={styles.saveText}>💾</Text>
          </Pressable>
          <Pressable style={styles.exitButton} onPress={resetRoute}>
            <Text style={styles.saveText}>✕</Text>
          </Pressable>
          {markers.length > 1 && (
            <Text style={styles.distanceText}>{distance.toFixed(2)} km</Text>
          )}
          <Pressable style={styles.undoButton} onPress={undoLastMarker}>
            <Text style={styles.saveText}>↩︎</Text>
          </Pressable>
        </>
      )}

      <Modal visible={showSaveModal} transparent animationType="fade">
        <View style={styles.modalContainer}>
          <View style={styles.modalBox}>
            <Text style={{ marginBottom: 12 }}>Routenname:</Text>
            <TextInput
              style={styles.input}
              placeholder="Name eingeben"
              value={routeName}
              onChangeText={setRouteName}
            />
            <Pressable style={styles.button} onPress={handleSave}>
              <Text style={styles.buttonText}>Speichern</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  buttonContainer: {
    position: 'absolute',
    bottom: 40,
    width: '100%',
    alignItems: 'center',
    gap: 16,
  },
  button: {
    backgroundColor: '#4CAF50',
    paddingVertical: 12,
    paddingHorizontal: 32,
    borderRadius: 25,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowOffset: { width: 0, height: 4 },
    elevation: 5,
  },
  buttonText: { color: '#fff', fontSize: 16 },
  saveButton: {
    position: 'absolute',
    top: 50,
    left: 20,
    backgroundColor: '#4CAF50',
    padding: 12,
    borderRadius: 25,
  },
  exitButton: {
    position: 'absolute',
    top: 50,
    right: 20,
    backgroundColor: '#fff',
    padding: 10,
    borderRadius: 25,
  },
  undoButton: {
    position: 'absolute',
    bottom: 40,
    right: 20,
    backgroundColor: '#fff',
    padding: 10,
    borderRadius: 25,
  },
  saveText: { fontSize: 20 },
  distanceText: {
    position: 'absolute',
    bottom: 100,
    alignSelf: 'center',
    backgroundColor: '#fff',
    padding: 8,
    borderRadius: 12,
    fontSize: 16,
  },
  modalContainer: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalBox: {
    backgroundColor: '#fff',
    padding: 24,
    borderRadius: 16,
    width: '80%',
    alignItems: 'center',
  },
  input: {
    width: '100%',
    borderWidth: 1,
    borderColor: '#ccc',
    padding: 10,
    marginBottom: 20,
    borderRadius: 8,
  },
});