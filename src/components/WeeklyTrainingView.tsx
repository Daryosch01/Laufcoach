import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Modal,
  ScrollView,
} from 'react-native';
import { format, startOfWeek, endOfWeek, addWeeks, isSameDay } from 'date-fns';
import { supabase } from '../api/supabase';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { TextInput } from 'react-native';

interface WeeklyTrainingViewProps {
  userId: string;
  onExtendPlan: (userWish: string, startDate: string) => void; // <-- HIER ergänzen!
}

export default function WeeklyTrainingView({ userId, onExtendPlan }: WeeklyTrainingViewProps) {
  const [currentWeekOffset, setCurrentWeekOffset] = useState(0);
  const [trainings, setTrainings] = useState<any[]>([]);
  const [selectedTraining, setSelectedTraining] = useState<any | null>(null);

  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  const startDate = startOfWeek(addWeeks(new Date(), currentWeekOffset), { weekStartsOn: 1 });
  const endDate = endOfWeek(startDate, { weekStartsOn: 1 });

    const [extendModalVisible, setExtendModalVisible] = useState(false);
    const [userWish, setUserWish] = useState('');

  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const date = new Date(startDate);
    date.setDate(date.getDate() + i);
    return date;



  });

  useEffect(() => {
    const loadTrainings = async () => {
      const { data, error } = await supabase
        .from('training_plan')
        .select('*')
        .eq('user_id', userId)
        .gte('date', format(startDate, 'yyyy-MM-dd'))
        .lte('date', format(endDate, 'yyyy-MM-dd'));

      if (error) console.error(error);
      else setTrainings(data);
    };

    loadTrainings();
  }, [currentWeekOffset]);

  const formatTime = (minutes: number) => `${Math.floor(minutes / 60)}h ${minutes % 60}min`;

  const getCardStyle = (type: string) => {
    switch (type) {
      case 'longrun': return [styles.card, { backgroundColor: '#cce5ff' }];
      case 'interval': return [styles.card, { backgroundColor: '#f8d7da' }];
      case 'tempo': return [styles.card, { backgroundColor: '#d4edda' }];
      case 'easy': return [styles.card, { backgroundColor: '#fff3cd' }];
      case 'recovery': return [styles.card, { backgroundColor: '#e2e3e5' }];
      default: return styles.card;
    }
  };

  function calculatePace(distance_km?: number, duration_minutes?: number): string | null {
    if (!distance_km || !duration_minutes || distance_km === 0) return null;
    const pace = duration_minutes / distance_km;
    const min = Math.floor(pace);
    const sec = Math.round((pace - min) * 60);
    return `${min}:${sec.toString().padStart(2, '0')} min/km`;
  }

  const [loading, setLoading] = useState(false);
    useEffect(() => {
    const loadTrainings = async () => {
        setLoading(true);
        const { data, error } = await supabase
        .from('training_plan')
        .select('*')
        .eq('user_id', userId)
        .gte('date', format(startDate, 'yyyy-MM-dd'))
        .lte('date', format(endDate, 'yyyy-MM-dd'));

        if (error) console.error(error);
        else setTrainings(data);
        setLoading(false);
    };

    loadTrainings();
    }, [currentWeekOffset]);

    const isEmptyWeek = trainings.filter(
    (t) =>
        new Date(t.date) >= startDate &&
        new Date(t.date) <= endDate &&
        t.type !== 'ruhetag'
    ).length === 0;


  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => setCurrentWeekOffset((prev) => prev - 1)}>
          <Text style={styles.arrow}>{'←'}</Text>
        </Pressable>
        <Text style={styles.weekText}>
          Woche: {format(startDate, 'dd.MM.')} – {format(endDate, 'dd.MM.')}
        </Text>
        <Pressable onPress={() => setCurrentWeekOffset((prev) => prev + 1)}>
          <Text style={styles.arrow}>{'→'}</Text>
        </Pressable>
      </View>

      <ScrollView>
        {weekDays.map((day) => {
          const dayTrainings = trainings.filter(
            (t) => isSameDay(new Date(t.date), day) && t.type !== 'ruhetag'
          );

          return dayTrainings.length > 0 ? (
            <View key={day.toISOString()} style={styles.dayBlock}>
              <Text style={styles.dayLabel}>{format(day, 'EEEE, dd.MM.')}</Text>
              {dayTrainings.map((t) => (
                <Pressable
                  key={t.id}
                  style={getCardStyle(t.type)}
                  onPress={() => setSelectedTraining(t)}
                >
                  <Text style={styles.cardTitle}>{t.title}</Text>
                  <Text style={{ fontSize: 14 }}>{t.description}</Text>
                  <Text style={{ fontSize: 12, color: '#555' }}>
                    Dauer: {formatTime(t.duration_minutes)} • Distanz: {t.distance_km} km
                  </Text>

                  {calculatePace(t.distance_km, t.duration_minutes) && (
                    <Text style={{ fontSize: 12, color: '#555' }}>
                      Ø Pace: {calculatePace(t.distance_km, t.duration_minutes)}
                    </Text>
                  )}

                  {t.target_pace_min_per_km && (
                    <Text style={{ fontSize: 12, color: '#555' }}>
                      Ziel-Pace: {t.target_pace_min_per_km}
                    </Text>
                  )}

                  {t.explanation && (
                    <Text style={{ fontSize: 12, color: '#777', fontStyle: 'italic' }}>
                      {t.explanation}
                    </Text>
                  )}
                </Pressable>
              ))}
            </View>
          ) : null;
        })}
      </ScrollView>

        {/* PLUS-BUTTON für leere Woche */}
        {!loading && isEmptyWeek && (
        <View style={{ alignItems: 'center', marginVertical: 32 }}>
            <Pressable
            style={{
                width: 60,
                height: 60,
                borderRadius: 30,
                backgroundColor: '#4CAF50',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: 8,
            }}

            onPress={() => setExtendModalVisible(true)}

            >
            <Text style={{ fontSize: 36, color: '#fff', fontWeight: 'bold' }}>+</Text>
            </Pressable>
            <Text style={{ fontSize: 16, color: '#555' }}>Trainingsplan ab dieser Woche erweitern</Text>
        </View>
        )}

      <Modal visible={!!selectedTraining} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>{selectedTraining?.title}</Text>
            <Text style={styles.modalDesc}>{selectedTraining?.description}</Text>
            <Text>Dauer: {formatTime(selectedTraining?.duration_minutes)}</Text>
            <Text>Distanz: {selectedTraining?.distance_km} km</Text>
            <Text>Typ: {selectedTraining?.type}</Text>

            {calculatePace(selectedTraining?.distance_km, selectedTraining?.duration_minutes) && (
              <Text>
                Ø Pace: {calculatePace(selectedTraining?.distance_km, selectedTraining?.duration_minutes)}
              </Text>
            )}

            {selectedTraining?.target_pace_min_per_km && (
              <Text>Ziel-Pace: {selectedTraining.target_pace_min_per_km}</Text>
            )}

            {selectedTraining?.explanation && (
              <Text style={{ fontStyle: 'italic', color: '#555', marginTop: 8 }}>
                {selectedTraining.explanation}
              </Text>
            )}

            <Pressable
              style={[styles.closeButton, { backgroundColor: '#2196F3' }]}
              onPress={() => {
                navigation.navigate('Activity', {
                  trainingData: {
                    title: selectedTraining.title,
                    description: selectedTraining.description,
                    duration_minutes: selectedTraining.duration_minutes,
                    distance_km: selectedTraining.distance_km,
                    type: selectedTraining.type,
                    target_pace_min_per_km: selectedTraining.target_pace_min_per_km,
                    explanation: selectedTraining.explanation,
                  },
                });
                setSelectedTraining(null);
              }}
            >
              <Text style={{ color: '#fff', textAlign: 'center' }}>Training starten</Text>
            </Pressable>

            <Pressable style={styles.closeButton} onPress={() => setSelectedTraining(null)}>
              <Text style={{ color: '#fff', textAlign: 'center' }}>Schließen</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

        <Modal visible={extendModalVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Trainingsplan erweitern</Text>
            <Text style={styles.modalDesc}>Was wünschst du dir für die nächsten Wochen? (optional)</Text>
            <TextInput
                style={[styles.input, { marginBottom: 12 }]}
                placeholder="z.B. mehr Intervalle, längere Läufe, ..."
                value={userWish}
                onChangeText={setUserWish}
            />
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
                <Pressable style={styles.closeButton} onPress={() => setExtendModalVisible(false)}>
                <Text style={{ color: '#fff' }}>Abbrechen</Text>
                </Pressable>
                <Pressable
                style={[styles.closeButton, { marginLeft: 12 }]}
                onPress={() => {
                    setExtendModalVisible(false);
                    // Startdatum ist der erste Tag der leeren Woche
                    onExtendPlan(userWish, format(startDate, 'yyyy-MM-dd'));
                }}
                >
                <Text style={{ color: '#fff' }}>Erweitern</Text>
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
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8
  },
  arrow: { fontSize: 20 },
  weekText: { fontSize: 16, fontWeight: 'bold' },
  dayBlock: { marginBottom: 16 },
  dayLabel: { fontWeight: 'bold', marginBottom: 6 },
  noTraining: { color: '#888' },
  card: {
    backgroundColor: '#f0f8ff', padding: 12, borderRadius: 8, marginTop: 6
  },
  cardTitle: { fontWeight: '600' },
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center'
  },
  modalContent: {
    backgroundColor: '#fff', padding: 20, borderRadius: 12, width: '90%'
  },
  modalTitle: { fontSize: 18, fontWeight: 'bold' },
  modalDesc: { marginVertical: 8 },
  closeButton: {
    marginTop: 16, backgroundColor: '#4CAF50', padding: 10, borderRadius: 6
  },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 6,
    padding: 10,
    fontSize: 16,
    backgroundColor: '#fafafa',
  },
});