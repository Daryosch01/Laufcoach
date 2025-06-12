// src/screens/AuthScreen.tsx
import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import { supabase } from '../api/supabase';

export default function AuthScreen() {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [confirm, setConfirm] = useState('');

  const handleAuth = async () => {
    if (!email || !password || (!isLogin && password !== confirm)) {
      alert('Bitte Eingaben prüfen.');
      return;
    }

    if (isLogin) {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) alert(error.message);
    } else {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { name } },
      });
      if (error) alert(error.message);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.header}>{isLogin ? 'Login' : 'Registrieren'}</Text>

      {!isLogin && (
        <TextInput placeholder="Name" value={name} onChangeText={setName} style={styles.input} />
      )}

      <TextInput placeholder="Email" value={email} onChangeText={setEmail} style={styles.input} />
      <TextInput
        placeholder="Passwort"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        style={styles.input}
      />

      {!isLogin && (
        <TextInput
          placeholder="Passwort bestätigen"
          value={confirm}
          onChangeText={setConfirm}
          secureTextEntry
          style={styles.input}
        />
      )}

      <Pressable onPress={handleAuth} style={styles.button}>
        <Text style={styles.buttonText}>{isLogin ? 'Login' : 'Registrieren'}</Text>
      </Pressable>

      <Pressable onPress={() => setIsLogin(!isLogin)} style={{ marginTop: 16 }}>
        <Text style={{ color: '#007aff' }}>
          {isLogin ? 'Noch kein Konto? Registrieren' : 'Schon registriert? Login'}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 24 },
  header: { fontSize: 24, marginBottom: 24, textAlign: 'center' },
  input: {
    borderBottomWidth: 1,
    borderBottomColor: '#ccc',
    marginBottom: 16,
    paddingVertical: 8,
  },
  button: {
    backgroundColor: '#007aff',
    padding: 12,
    borderRadius: 8,
  },
  buttonText: { color: 'white', textAlign: 'center' },
});