import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Dimensions, Pressable } from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE, LatLng } from 'react-native-maps';
import * as Location from 'expo-location';
import axios from 'axios';
import { GOOGLE_MAPS_API_KEY } from '@env';
import type { Region } from 'react-native-maps';

export default function RouteTrackingScreen() {
  const [location, setLocation] = useState<Location.LocationObject | null>(null);
  const [region, setRegion] = useState<Region | null>(null);
  const [markers, setMarkers] = useState<LatLng[]>([]);
  const [routeCoords, setRouteCoords] = useState<LatLng[]>([]);
  const [editMode, setEditMode] = useState(false);

  // 1. Standort beim Start abrufen
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

  // 2. Kartenklick-Handler
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
          setRouteCoords((prev) => [...prev, ...points]);
        }
      } catch (err) {
        console.error('Directions Error:', err);
      }
    }
  };

  // 3. Polyline-Dekodierung
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

  // 4. Buttons und Steuerung
  const resetRoute = () => {
    setMarkers([]);
    setRouteCoords([]);
    setEditMode(false);
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

        {routeCoords.length > 0 && (
          <Polyline coordinates={routeCoords} strokeWidth={4} strokeColor="blue" />
        )}
      </MapView>

      {!editMode ? (
        <View style={styles.buttonContainer}>
          <Pressable style={styles.button} onPress={() => setEditMode(true)}>
            <Text style={styles.buttonText}>Neue Route</Text>
          </Pressable>
          <Pressable style={styles.button} onPress={() => alert('Bald verfügbar')}>
            <Text style={styles.buttonText}>Gespeicherte Routen</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.editModeBar}>
          <Pressable onPress={resetRoute}>
            <Text style={{ fontSize: 24, color: 'black' }}>✕</Text>
          </Pressable>
          <Text style={{ marginLeft: 12 }}>Bearbeitungsmodus aktiv</Text>
        </View>
      )}
    </View>
  );
}

// 5. Stile
const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
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
  buttonText: {
    color: '#fff',
    fontSize: 16,
  },
  editModeBar: {
    position: 'absolute',
    bottom: 40,
    left: 20,
    right: 20,
    backgroundColor: 'white',
    padding: 14,
    borderRadius: 30,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
});