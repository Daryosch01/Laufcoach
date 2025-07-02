import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable, Modal, Image, TextInput } from 'react-native';
import MapView, { Polyline, LatLng } from 'react-native-maps';
import { fetchUserRoutes, RouteEntry } from '../services/routesService';
import { supabase } from '../api/supabase';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

// Define RootStackParamList or import it from your navigation types
type RootStackParamList = {
  Profile: undefined;
  Activity: {
    routeCoordinates: LatLng[];
    routeDistance: number;
    routeName: string;
  };
  // Add other screens here as needed
};



export default function ProfileScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [routes, setRoutes] = useState<RouteEntry[]>([]);
  const [selectedRoute, setSelectedRoute] = useState<RouteEntry | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [userEmail, setUserEmail] = useState('');
  const [createdAt, setCreatedAt] = useState('');
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [profileData, setProfileData] = useState({
    name: '',
    experience: '',
    height: '',
    weight: '',
  });
  

  useEffect(() => {
    const loadData = async () => {
      const currentUser = await supabase.auth.getUser();
      const user = currentUser?.data?.user;
      if (user) {
        setUserEmail(user.email || '');
        setCreatedAt(user.created_at);

        // Lade Profil-Daten
        const { data: profile } = await supabase
          .from('coach_profiles')
          .select('*')
          .eq('user_id', user.id)
          .single();
        if (profile) {
          setProfileData({
            name: profile.name || '',
            experience: profile.experience || '',
            height: profile.height ? String(profile.height) : '',
            weight: profile.weight ? String(profile.weight) : '',
          });
        }

        const fetchedRoutes = await fetchUserRoutes(user.id);
        setRoutes(fetchedRoutes);
      }
    };
    loadData();
  }, []);

  const openRouteModal = (route: RouteEntry) => {
    const parsedCoordinates = Array.isArray(route.coordinates[0])
      ? route.coordinates.flat()
      : route.coordinates;

    setSelectedRoute({ ...route, coordinates: parsedCoordinates });
    setModalVisible(true);
  };

  const closeModal = () => {
    setSelectedRoute(null);
    setModalVisible(false);
  };

  const formatDateTime = (timestamp: string): string => {
    const date = new Date(timestamp);
    return `Erstellt am ${date.toLocaleDateString('de-DE')} um ${date.toLocaleTimeString('de-DE', {
      hour: '2-digit',
      minute: '2-digit',
    })}`;
  };

  const renderRoute = ({ item }: { item: RouteEntry }) => (
    <View style={styles.routeItem}>
      <Pressable onPress={() => openRouteModal(item)}>
        <Text style={styles.routeName}>{item.name}</Text>
        <Text style={styles.routeInfo}>{item.distance.toFixed(2)} km</Text>
      </Pressable>
      <Pressable
        style={styles.startRouteButton}
        onPress={() => navigation.navigate('Activity', {
          routeCoordinates: Array.isArray(item.coordinates[0])
            ? item.coordinates.flat()
            : item.coordinates,
          routeDistance: item.distance,
          routeName: item.name,
        })}
      >
        <Text style={styles.startRouteButtonText}>Route starten</Text>
      </Pressable>
    </View>
  );

  // Speichert die Profil-Daten in Supabase
  const handleSaveProfile = async () => {
    const currentUser = await supabase.auth.getUser();
    const user = currentUser?.data?.user;
    if (!user) return;

    await supabase
      .from('coach_profiles')
      .upsert({
        user_id: user.id,
        name: profileData.name,
        experience: profileData.experience,
        height: profileData.height ? Number(profileData.height) : null,
        weight: profileData.weight ? Number(profileData.weight) : null,
      });

    setEditModalVisible(false);
  };

  return (
    <View style={styles.container}>
      {/* Profil-Header */}
      <View style={styles.profileSection}>
        <Image source={{ uri: 'https://via.placeholder.com/100' }} style={styles.avatar} />
        <Text style={styles.userName}>{profileData.name || 'Nutzername'}</Text>
        <Text style={styles.userInfo}>📧 {userEmail}</Text>
        <Text style={styles.userInfo}>📅 Beigetreten: {createdAt.slice(0, 10)}</Text>
        <Pressable style={styles.editButton} onPress={() => setEditModalVisible(true)}>
          <Text style={styles.editButtonText}>Persönliche Informationen bearbeiten</Text>
        </Pressable>
      </View>

      {/* Routenliste */}
      <Text style={styles.heading}>Meine Routen</Text>
      <FlatList
        data={routes}
        keyExtractor={(item) => item.id}
        renderItem={renderRoute}
        contentContainerStyle={{ paddingBottom: 120 }}
      />

      {/* Modal für Kartenansicht */}
      <Modal visible={modalVisible} transparent animationType="slide">
        <View style={styles.modalContainer}>
          <View style={styles.modalBox}>
            <Text style={styles.routeTitle}>{selectedRoute?.name}</Text>
            <Text style={styles.routeDate}>
              {selectedRoute?.created_at ? formatDateTime(selectedRoute.created_at) : ''}
            </Text>
            <Text style={styles.routeDistance}>{selectedRoute?.distance.toFixed(2)} km</Text>
            <MapView
              style={styles.mapPreview}
              initialRegion={{
                latitude: selectedRoute?.coordinates?.[0]?.latitude || 0,
                longitude: selectedRoute?.coordinates?.[0]?.longitude || 0,
                latitudeDelta: 0.01,
                longitudeDelta: 0.01,
              }}
            >
              {selectedRoute?.coordinates && (
                <Polyline coordinates={selectedRoute.coordinates} strokeWidth={4} strokeColor="green" />
              )}
            </MapView>
            <Pressable style={styles.closeButton} onPress={closeModal}>
              <Text style={{ color: '#fff' }}>Schließen</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal visible={editModalVisible} transparent animationType="slide">
        <View style={styles.modalContainer}>
          <View style={styles.modalBox}>
            <Text style={{ fontWeight: 'bold', fontSize: 18, marginBottom: 12 }}>Persönliche Informationen</Text>
            <TextInput
              style={styles.input}
              placeholder="Name"
              value={profileData.name}
              onChangeText={v => setProfileData({ ...profileData, name: v })}
            />
            <TextInput
              style={styles.input}
              placeholder="Trainingserfahrung"
              value={profileData.experience}
              onChangeText={v => setProfileData({ ...profileData, experience: v })}
            />
            <TextInput
              style={styles.input}
              placeholder="Größe (cm)"
              value={profileData.height}
              onChangeText={v => setProfileData({ ...profileData, height: v })}
              keyboardType="numeric"
            />
            <TextInput
              style={styles.input}
              placeholder="Gewicht (kg)"
              value={profileData.weight}
              onChangeText={v => setProfileData({ ...profileData, weight: v })}
              keyboardType="numeric"
            />
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 16 }}>
              <Pressable style={styles.closeButton} onPress={() => setEditModalVisible(false)}>
                <Text style={{ color: '#fff' }}>Abbrechen</Text>
              </Pressable>
              <Pressable
                style={[styles.closeButton, { marginLeft: 12 }]}
                onPress={handleSaveProfile}
              >
                <Text style={{ color: '#fff' }}>Speichern</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  profileSection: {
    alignItems: 'center',
    marginBottom: 20,
  },
  avatar: {
    width: 100,
    height: 100,
    borderRadius: 50,
    marginBottom: 12,
  },
  userName: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  userInfo: {
    fontSize: 14,
    color: '#444',
  },
  editButton: {
    backgroundColor: '#2196F3',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
    marginTop: 12,
  },
  editButtonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 16,
  },
  heading: { fontSize: 24, fontWeight: 'bold', marginVertical: 16 },
  routeItem: {
    padding: 16,
    borderBottomWidth: 1,
    borderColor: '#ddd',
    backgroundColor: '#f8f8f8',
    marginBottom: 8,
    borderRadius: 8,
  },
  routeName: { fontSize: 18, fontWeight: '600' },
  routeInfo: { fontSize: 14, color: '#555' },
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
  routeTitle: { fontSize: 20, fontWeight: 'bold', marginBottom: 4 },
  routeDate: { fontSize: 14, color: '#888', marginBottom: 4 },
  routeDistance: { fontSize: 16, marginBottom: 8 },
  mapPreview: { width: '100%', height: '60%', marginVertical: 12 },
  closeButton: {
    backgroundColor: '#4CAF50',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
    marginTop: 12,
  },
  startRouteButton: {
    marginTop: 8,
    backgroundColor: '#4CAF50',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignSelf: 'flex-start',
  },
  startRouteButtonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 16,
  },
  input: {
    width: '100%',
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    padding: 10,
    marginBottom: 10,
    fontSize: 16,
    backgroundColor: '#f9f9f9',
  },
});