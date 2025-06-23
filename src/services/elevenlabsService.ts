// Datei: src/services/elevenlabsService.ts

import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';
import { Buffer } from 'buffer';
import { ELEVENLABS_API_KEY } from '@env';

global.Buffer = Buffer;

export async function speakWithElevenLabs(text: string) {
  try {
    const response = await fetch(
      'https://api.elevenlabs.io/v1/text-to-speech/2OcnG4mH3jIMtWz3vKus/stream',
      {
        method: 'POST',
        headers: {
          'xi-api-key': ELEVENLABS_API_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text,
          model_id: 'eleven_multilingual_v2',
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
          },
        }),
      }
    );

    const arrayBuffer = await response.arrayBuffer();
    const base64Audio = Buffer.from(arrayBuffer).toString('base64');

    const fileUri = FileSystem.cacheDirectory + 'speech.mp3';
    await FileSystem.writeAsStringAsync(fileUri, base64Audio, {
      encoding: FileSystem.EncodingType.Base64,
    });

    const { sound } = await Audio.Sound.createAsync({ uri: fileUri });
    await sound.playAsync();

  } catch (err) {
    console.error('Fehler bei ElevenLabs-Ausgabe:', err);
  }
}