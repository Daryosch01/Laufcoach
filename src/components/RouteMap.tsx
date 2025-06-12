import React, { useEffect, useState } from 'react';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE, LatLng } from 'react-native-maps';
import { View, StyleSheet, Dimensions, Pressable } from 'react-native';
import * as Location from 'expo-location';
import { GOOGLE_MAPS_API_KEY } from '@env';

interface RouteMapProps {
  isEditing: boolean;
}

export default function RouteMap({ isEditing }: RouteMapProps) {
  const [location, setLocation] = useState<LatLng | null>(null);
  const [routePoints, setRoutePoints] = useState<LatLng[]>([]);

  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        console.log('Permission to access location was denied');
        return;
      }

      const currentLocation = await Location.getCurrentPositionAsync({});
      setLocation({
        latitude: currentLocation.coords.latitude,
        longitude: currentLocation.coords.longitude,
      });
    })();
  }, []);

  const handleMapPress = (event: any) => {
    if (!isEditing) return;
    const { coordinate } = event.nativeEvent;
    setRoutePoints([...routePoints, coordinate]);
  };

  return (
    <View style={styles.container}>
      <MapView
        provider={PROVIDER_GOOGLE}
        style={styles.map}
        initialRegion={{
          latitude: location?.latitude || 37.78825,
          longitude: location?.longitude || -122.4324,
          latitudeDelta: 0.01,
          longitudeDelta: 0.01,
        }}
        onPress={handleMapPress}
        showsUserLocation
        followsUserLocation
      >
        {location && (
          <Marker
            coordinate={location}
            title="Dein Standort"
            pinColor="blue"
          />
        )}

        {routePoints.map((point, index) => (
          <Marker
            key={`marker-${index}`}
            coordinate={point}
            pinColor="gray"
          />
        ))}

        {routePoints.length > 1 && (
          <Polyline
            coordinates={routePoints}
            strokeColor="#007AFF"
            strokeWidth={4}
          />
        )}
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  map: {
    width: Dimensions.get('window').width,
    height: Dimensions.get('window').height,
  },
});