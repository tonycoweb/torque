// components/AudioRecorderModal.js
import React, { useEffect, useRef, useState } from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet, Platform, Alert, ActivityIndicator } from 'react-native';
import { Audio } from 'expo-av';

async function safeSetModeRecording(on) {
  // Keep it minimal + compatible across expo-av versions
  // (interruptionModeIOS is optional and is what's failing for you)
  try {
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: !!on,
      playsInSilentModeIOS: true,
      staysActiveInBackground: false,
      shouldDuckAndroid: true,
    });
  } catch (e) {
    // Fallback: try an even smaller set
    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: !!on,
        playsInSilentModeIOS: true,
      });
    } catch {
      throw e;
    }
  }
}

export default function AudioRecorderModal({ visible, onClose, onDone }) {
  const recRef = useRef(null);

  const [ready, setReady] = useState(false);
  const [recording, setRecording] = useState(false);
  const [uri, setUri] = useState(null);
  const [busy, setBusy] = useState(false);

  // metering (0..1-ish in expo-av status.metering on iOS; android varies)
  const [meter, setMeter] = useState(0);

  const cleanup = async () => {
    try {
      if (recRef.current) {
        try {
          const st = await recRef.current.getStatusAsync();
          if (st?.isRecording) await recRef.current.stopAndUnloadAsync();
        } catch {}
        recRef.current = null;
      }
    } catch {}
    try { await safeSetModeRecording(false); } catch {}
  };

  useEffect(() => {
    if (!visible) {
      cleanup().catch(() => {});
      setReady(false);
      setRecording(false);
      setUri(null);
      setBusy(false);
      setMeter(0);
      return;
    }

    (async () => {
      try {
        setBusy(true);

        const perm = await Audio.requestPermissionsAsync();
        if (!perm?.granted) {
          Alert.alert('Microphone permission needed', 'Enable microphone access in Settings to record engine sounds.');
          return;
        }

        await safeSetModeRecording(true);
        setReady(true);
      } catch (e) {
        console.log('Audio init error:', e);
        Alert.alert('Audio init failed', e?.message || 'Could not initialize audio.');
      } finally {
        setBusy(false);
      }
    })();

    return () => { cleanup().catch(() => {}); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const start = async () => {
    if (!ready || busy || recording) return;

    try {
      setBusy(true);
      setUri(null);
      setMeter(0);

      await safeSetModeRecording(true);

      const rec = new Audio.Recording();

      // ✅ Most compatible path: built-in preset
      await rec.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);

      // status updates (metering)
      rec.setProgressUpdateInterval(120);
      rec.setOnRecordingStatusUpdate((st) => {
        // st.metering is usually negative dB on iOS when enabled by preset; normalize a bit
        // If metering is undefined on your device/version, this just stays 0.
        if (typeof st?.metering === 'number') {
          // st.metering is often -160..0 (dB). map to 0..1
          const db = Math.max(-60, Math.min(0, st.metering));
          const norm = (db + 60) / 60;
          setMeter(norm);
        }
      });

      await rec.startAsync();
      recRef.current = rec;
      setRecording(true);
    } catch (e) {
      console.log('startRecording error:', e);
      Alert.alert('Recording failed', e?.message || 'Could not start recording.');
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    if (!recRef.current || busy) return;

    try {
      setBusy(true);

      await recRef.current.stopAndUnloadAsync();
      const u = recRef.current.getURI();

      recRef.current = null;
      setRecording(false);
      setUri(u || null);

      await safeSetModeRecording(false);
    } catch (e) {
      console.log('stopRecording error:', e);
      Alert.alert('Stop failed', e?.message || 'Could not stop recording.');
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    if (!uri || busy) return;
    try {
      setBusy(true);
      await onDone?.(uri);
      onClose?.();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <Text style={styles.title}>Record engine sound</Text>
          <Text style={styles.sub}>Tip: 8–12 seconds, close to the source, minimal wind.</Text>

          {/* simple “sound bar” preview (you can style into the cylinder later) */}
          <View style={styles.meterTrack}>
            <View style={[styles.meterFill, { width: `${Math.round(meter * 100)}%` }]} />
          </View>

          {busy && <View style={{ marginVertical: 10 }}><ActivityIndicator /></View>}

          <TouchableOpacity
            style={[styles.btn, recording ? styles.btnStop : styles.btnRec, (!ready || busy) && styles.btnDisabled]}
            disabled={!ready || busy}
            onPress={recording ? stop : start}
          >
            <Text style={styles.btnText}>{recording ? 'Stop Recording' : 'Start Recording'}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.btn, styles.btnSend, (!uri || busy) && styles.btnDisabled]}
            disabled={!uri || busy}
            onPress={send}
          >
            <Text style={styles.btnText}>Attach to message</Text>
          </TouchableOpacity>

          <TouchableOpacity style={[styles.btn, styles.btnClose]} onPress={onClose} disabled={busy}>
            <Text style={styles.btnText}>Close</Text>
          </TouchableOpacity>

          {uri ? <Text style={styles.small}>✅ Recording ready</Text> : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center' },
  card: { width: '88%', backgroundColor: '#222', borderRadius: 18, padding: 18 },
  title: { color: '#fff', fontSize: 18, fontWeight: '700', marginBottom: 6 },
  sub: { color: '#aaa', fontSize: 13, marginBottom: 12 },

  meterTrack: {
    height: 10,
    borderRadius: 999,
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    overflow: 'hidden',
    marginBottom: 8,
  },
  meterFill: { height: '100%', backgroundColor: '#4CAF50' },

  btn: { paddingVertical: 12, borderRadius: 14, alignItems: 'center', marginTop: 10 },
  btnRec: { backgroundColor: '#4CAF50' },
  btnStop: { backgroundColor: '#FF6666' },
  btnSend: { backgroundColor: '#3b82f6' },
  btnClose: { backgroundColor: '#444' },
  btnDisabled: { opacity: 0.5 },
  btnText: { color: '#fff', fontWeight: '700' },
  small: { marginTop: 10, color: '#aaa', fontSize: 12 },
});
