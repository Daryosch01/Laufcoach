// CoachScreen.tsx
import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  FlatList,
  ActivityIndicator,
} from 'react-native';
import { supabase } from '../api/supabase';
import { OpenAI } from 'openai';
import { OPENAI_API_KEY } from '@env';
import WeeklyTrainingView from '../components/WeeklyTrainingView';
import { useEffect } from 'react'; 


const openai = new OpenAI({
  apiKey: OPENAI_API_KEY,
  dangerouslyAllowBrowser: true,
});

interface Step {
  key: keyof CoachFormData;
  question: string;
  required: boolean;
  input: 'text' | 'select';
  options?: { label: string; value: string }[];
}

interface CoachFormData {
  name: string;
  experience: string;
  goal: string;
  custom_goal: string;
  target_event_date: string;
  target_event_distance: string;
  target_event_time: string;
  time_budget: string;
  health_info: string;
  height: string;
  weight: string;
  performance: string;
}

const initialData: CoachFormData = {
  name: '',
  experience: '',
  goal: '',
  custom_goal: '',
  target_event_date: '',
  target_event_distance: '',
  target_event_time: '',
  time_budget: '',
  health_info: '',
  height: '',
  weight: '',
  performance: '',
};

const steps: Step[] = [
  { key: 'name', question: 'Wie heißt du?', required: true, input: 'text' },
  {
    key: 'experience', question: 'Wie ist deine Lauferfahrung?', required: true, input: 'select',
    options: [
      { label: 'Anfänger (<6 Monate)', value: 'beginner' },
      { label: 'Fortgeschritten (6-24 Monate)', value: 'intermediate' },
      { label: 'Erfahren (>24 Monate)', value: 'advanced' },
    ],
  },
  {
    key: 'goal', question: 'Was ist dein Ziel?', required: true, input: 'select',
    options: [
      { label: 'Fit werden', value: 'fit' },
      { label: 'Laufen verbessern', value: 'improve' },
      { label: 'Wettkampf', value: 'race' },
    ],
  },
  { key: 'custom_goal', question: 'Falls du ein konkretes Ziel hast, gib es hier an (optional):', required: false, input: 'text' },
  {
    key: 'target_event_distance', question: 'Wettkampfdistanz (optional):', required: false, input: 'select',
    options: [
      { label: '5 km', value: '5k' },
      { label: '10 km', value: '10k' },
      { label: 'Halbmarathon', value: '21k' },
      { label: 'Marathon', value: '42k' },
    ],
  },
  { key: 'target_event_date', question: 'Wann ist dein geplanter Wettkampf? (optional)', required: false, input: 'text' },
  { key: 'target_event_time', question: 'Wie schnell möchtest du ihn absolvieren? (optional)', required: false, input: 'text' },
  { key: 'time_budget', question: 'Wie viele Tage/Woche kannst du trainieren?', required: true, input: 'text' },
  { key: 'health_info', question: 'Gibt es gesundheitliche Einschränkungen? (optional)', required: false, input: 'text' },
  { key: 'height', question: 'Wie groß bist du? (cm)', required: false, input: 'text' },
  { key: 'weight', question: 'Wie viel wiegst du? (kg)', required: false, input: 'text' },
  { key: 'performance', question: 'Wie ist deine aktuelle Leistungsfähigkeit? (z. B. 5km in 30min)', required: false, input: 'text' },
];

export default function CoachScreen() {
  const [formData, setFormData] = useState<CoachFormData>(initialData);
  const [stepIndex, setStepIndex] = useState(0);
  const [saving, setSaving] = useState(false);
  const [planGenerated, setPlanGenerated] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    const checkExistingData = async () => {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id;
      if (!uid) return;
      setUserId(uid);

      const { data: profile, error: profileError } = await supabase
        .from('coach_profiles')
        .select('*')
        .eq('user_id', uid)
        .single();

      const { data: plan, error: planError } = await supabase
        .from('training_plan')
        .select('id')
        .eq('user_id', uid)
        .limit(1);

      if (profile && plan && plan.length > 0) {
        // ✅ Benutzer hat Profil & Plan → Formular überspringen
        setPlanGenerated(true);
      } else if (profile) {
        // 🟡 Benutzer hat Profil, aber keinen Plan → evtl. neu generieren
        setFormData(profile);
        setStepIndex(steps.length - 1); // direkt zur Plan-Erstellung
      }
    };

    checkExistingData();
  }, []);

  const currentStep = steps[stepIndex];
  const value = formData[currentStep.key];

  const handleChange = (key: keyof CoachFormData, value: string) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
  };

  const handleNext = () => {
    if (currentStep.required && !formData[currentStep.key]) return;
    setStepIndex((prev) => prev + 1);
  };

  const handleSkip = () => setStepIndex((prev) => prev + 1);

  const handleGeneratePlan = async () => {
    try {
      setSaving(true);

      // Nutzer-ID abrufen
      const user = await supabase.auth.getUser();
      const uid = user.data.user?.id;
      if (!uid) throw new Error('Kein Benutzer angemeldet');
      setUserId(uid);

      // Profildaten speichern
      const { error: profileError } = await supabase.from('coach_profiles').upsert({
        user_id: uid,
        name: formData.name,
        experience: formData.experience,
        goal: formData.goal,
        custom_goal: formData.custom_goal || null,
        target_event_date: formData.target_event_date || null,
        target_event_distance: formData.target_event_distance || null,
        target_event_time: formData.target_event_time || null,
        time_budget: formData.time_budget?.trim()
          ? JSON.parse(`[${formData.time_budget.trim()}]`)
          : null,
        health_info: formData.health_info || null,
        height: formData.height ? Number(formData.height) : null,
        weight: formData.weight ? Number(formData.weight) : null,
        performance: formData.performance?.trim()
          ? JSON.parse(`[${JSON.stringify(formData.performance.trim())}]`)
          : null,
      });
      if (profileError) throw profileError;

      // OpenAI Prompt: Reines JSON erzwingen
      const today = new Date().toISOString().split('T')[0];

      const prompt = `Erstelle einen strukturierten Lauftrainingsplan im JSON-Format. Keine Kommentare, keine Erklärungen – nur reines JSON:

      [
        {
          "date": "2025-06-17",
          "weekday": "Dienstag",
          "title": "Intervalltraining – 5×800m",
          "description": "5 Intervalle à 800m mit 400m Trabpause. Zielpace: 4:45–5:00 min/km",
          "distance_km": 8.0,
          "duration_minutes": 50,
          "type": "intervall",
          "target_pace_min_per_km": "4:50",
          "explanation": "Diese Einheit verbessert deine VO2max und Tempohärte."
        }
      ]

      Berücksichtige die folgende Person:
      ${JSON.stringify(formData)}

      Deine Aufgabe:
      - Plane individuell basierend auf Erfahrung, Ziel, Zeitbudget und Eventdatum.
      - Typen: "intervall", "longrun", "tempo", "recovery", "base"
      - Verwende unterschiedliche Inhalte pro Einheit.
      - Gib für passende Einheiten eine realistische Zielpace in min/km an.
      - Füge kurze erklärende Texte hinzu.
      - Beginne am ${today} und plane realistisch bis zum Wettkampf oder allgemeinen Ziel.

      Antworte **nur** mit einem reinen JSON-Array.
      `;

      // API Call an OpenAI
      const completion = await openai.chat.completions.create({
        model: 'gpt-4',
        messages: [{ role: 'user', content: prompt }],
      });

      const raw = completion.choices[0].message.content;
      if (!raw) throw new Error('Keine Antwort von OpenAI erhalten');

      // JSON robust extrahieren
      let parsed;
      try {
        const match = raw.match(/\[.*\]/s); // s = dotAll für Zeilenumbrüche
        if (!match) throw new Error('Kein gültiges JSON-Array gefunden');
        parsed = JSON.parse(match[0]);
      } catch (parseErr) {
        console.error('Fehler beim Parsen der OpenAI-Antwort:', raw);
        throw parseErr;
      }

      // Trainingsplan speichern
      const insert = await supabase.from('training_plan').insert(
        parsed.map((t: any) => ({
          user_id: uid,
          date: t.date || null,
          weekday: t.weekday || null,
          title: t.title || 'Unbenannt',
          description: t.description || '',
          distance_km:
            t.distance_km !== undefined && !isNaN(parseFloat(t.distance_km))
              ? parseFloat(t.distance_km)
              : null,
          duration_minutes:
            t.duration_minutes !== undefined && !isNaN(parseInt(t.duration_minutes))
              ? parseInt(t.duration_minutes)
              : null,
          type: t.type || 'unspecified',
          target_pace_min_per_km: t.target_pace_min_per_km || null,
          explanation: t.explanation || null,
        }))
      );
      if (insert.error) throw insert.error;

      setPlanGenerated(true);
    } catch (e) {
      console.error('Fehler beim Speichern oder Generieren:', e);
    } finally {
      setSaving(false);
    }
  };

  if (planGenerated && userId) {
    return <WeeklyTrainingView userId={userId} />;
  }

  return (
    <View style={styles.container}>
      <Text style={styles.question}>{currentStep.question}</Text>

      {currentStep.input === 'text' && (
        <TextInput
          style={styles.input}
          placeholder="Antwort hier eingeben"
          value={value}
          onChangeText={(text) => handleChange(currentStep.key, text)}
        />
      )}

      {currentStep.input === 'select' && (
        <FlatList
          data={currentStep.options || []}
          keyExtractor={(item) => item.value}
          renderItem={({ item }) => (
            <Pressable
              style={[styles.option, value === item.value && styles.optionSelected]}
              onPress={() => handleChange(currentStep.key, item.value)}
            >
              <Text>{item.label}</Text>
            </Pressable>
          )}
        />
      )}

      <View style={styles.buttonRow}>
        {!currentStep.required && (
          <Pressable style={styles.skipButton} onPress={handleSkip}>
            <Text>Skip</Text>
          </Pressable>
        )}
        {stepIndex < steps.length - 1 ? (
          <Pressable
            style={[styles.nextButton, !value && currentStep.required && styles.disabled]}
            onPress={handleNext}
          >
            <Text style={styles.buttonText}>Weiter</Text>
          </Pressable>
        ) : (
          <Pressable style={styles.nextButton} onPress={handleGeneratePlan}>
            {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Plan erstellen</Text>}
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, justifyContent: 'center' },
  question: { fontSize: 20, marginBottom: 20 },
  input: { borderWidth: 1, borderColor: '#ccc', padding: 10, marginBottom: 20, borderRadius: 8 },
  option: { padding: 12, borderRadius: 8, borderWidth: 1, borderColor: '#ddd', marginBottom: 10 },
  optionSelected: { backgroundColor: '#def', borderColor: '#00f' },
  buttonRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 20 },
  nextButton: { backgroundColor: '#4CAF50', padding: 12, borderRadius: 8 },
  skipButton: { backgroundColor: '#ccc', padding: 12, borderRadius: 8 },
  disabled: { backgroundColor: '#aaa' },
  buttonText: { color: '#fff', fontWeight: 'bold' },
});