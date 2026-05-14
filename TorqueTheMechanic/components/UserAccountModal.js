// components/UserAccountModal.js
import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  StyleSheet,
  ScrollView,
  Alert,
  SafeAreaView,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

const EXPERTISE_LEVELS = [
  {
    key: 'brand_new',
    title: '1 — Brand New',
    icon: 'baby-face-outline',
    short: 'I barely know cars yet.',
    example: 'Example: You know where the gas goes, but want simple explanations and clear warnings.',
  },
  {
    key: 'basic_owner',
    title: '2 — Basic Owner',
    icon: 'car-wrench',
    short: 'I know basic maintenance.',
    example: 'Example: You understand oil changes, tires, batteries, and warning lights, but want plain steps.',
  },
  {
    key: 'diy_beginner',
    title: '3 — DIY Beginner',
    icon: 'tools',
    short: 'I can do simple repairs.',
    example: 'Example: You can change brakes, sensors, fluids, or basic parts with guidance.',
  },
  {
    key: 'advanced_diy',
    title: '4 — Advanced DIY',
    icon: 'engine-outline',
    short: 'I diagnose and repair often.',
    example: 'Example: You use a scan tool/multimeter, understand live data, and want deeper diagnostic logic.',
  },
  {
    key: 'pro_tech',
    title: '5 — Pro / Technician',
    icon: 'account-hard-hat',
    short: 'Talk technical. I can handle it.',
    example: 'Example: You want concise, technical details, test values, wiring logic, and edge-case causes.',
  },
];

export { EXPERTISE_LEVELS };

export default function UserAccountModal({
  visible,
  mode = 'account', // 'account' | 'intro'
  expertiseLevel,
  onSaveExpertise,
  onClose,
  onDeleteLocalAccount,
}) {
  const [selected, setSelected] = useState(expertiseLevel || 'basic_owner');
  const isIntro = mode === 'intro';

  React.useEffect(() => {
    if (visible) setSelected(expertiseLevel || 'basic_owner');
  }, [visible, expertiseLevel]);

  const selectedInfo = useMemo(
    () => EXPERTISE_LEVELS.find((x) => x.key === selected) || EXPERTISE_LEVELS[1],
    [selected]
  );

  const save = async () => {
    await onSaveExpertise?.(selected, { introComplete: isIntro });
    onClose?.();
  };

  const confirmDeleteLocal = () => {
    Alert.alert(
      'Remove Local Account?',
      'This signs you out on this device and clears local account preferences. Your backend purchase/account record is not erased, so your one-account setup and purchase history stay protected.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove Locally',
          style: 'destructive',
          onPress: () => onDeleteLocalAccount?.(),
        },
      ]
    );
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={isIntro ? undefined : onClose}>
      <View style={styles.backdrop}>
        <SafeAreaView style={styles.safeArea}>
          <View style={styles.sheet}>
            <View style={styles.headerRow}>
              <View style={styles.headerIconCircle}>
                <MaterialCommunityIcons name="account-cog" size={24} color="#22c55e" />
              </View>

              <View style={{ flex: 1 }}>
                <Text style={styles.title}>{isIntro ? 'Welcome to Torque' : 'Account'}</Text>
                <Text style={styles.subtitle}>
                  {isIntro
                    ? 'Set your car knowledge level so Torque explains things the right way.'
                    : 'Manage your local account settings and Torque response style.'}
                </Text>
              </View>

              {!isIntro && (
                <TouchableOpacity style={styles.closePill} onPress={onClose} activeOpacity={0.9}>
                  <Text style={styles.closeText}>✕</Text>
                </TouchableOpacity>
              )}
            </View>

            {isIntro && (
              <View style={styles.introCard}>
                <Text style={styles.introTitle}>Quick setup</Text>
                <Text style={styles.introText}>
                  Torque can adjust explanations based on your experience. You can change this later in Settings → Account.
                </Text>
              </View>
            )}

            <Text style={styles.sectionTitle}>Your car knowledge level</Text>
            <Text style={styles.sectionHint}>
              Pick the closest match. This helps Torque decide how much to explain, how technical to get, and what warnings to include.
            </Text>

            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.levelList}>
              {EXPERTISE_LEVELS.map((level) => {
                const active = selected === level.key;
                return (
                  <TouchableOpacity
                    key={level.key}
                    style={[styles.levelCard, active && styles.levelCardActive]}
                    onPress={() => setSelected(level.key)}
                    activeOpacity={0.92}
                  >
                    <View style={[styles.levelIcon, active && styles.levelIconActive]}>
                      <MaterialCommunityIcons name={level.icon} size={22} color={active ? '#07110a' : '#cbd5e1'} />
                    </View>

                    <View style={{ flex: 1 }}>
                      <Text style={styles.levelTitle}>{level.title}</Text>
                      <Text style={styles.levelShort}>{level.short}</Text>
                      <Text style={styles.levelExample}>{level.example}</Text>
                    </View>

                    <MaterialCommunityIcons
                      name={active ? 'check-circle' : 'circle-outline'}
                      size={22}
                      color={active ? '#22c55e' : 'rgba(255,255,255,0.30)'}
                    />
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <View style={styles.previewBox}>
              <Text style={styles.previewLabel}>Torque will treat you like:</Text>
              <Text style={styles.previewText}>{selectedInfo.title.replace(/^\d+ — /, '')}</Text>
            </View>

            <TouchableOpacity style={styles.saveBtn} onPress={save} activeOpacity={0.95}>
              <Text style={styles.saveText}>{isIntro ? 'Save & Start Using Torque' : 'Save Account Settings'}</Text>
            </TouchableOpacity>

            {!isIntro && (
              <TouchableOpacity style={styles.deleteBtn} onPress={confirmDeleteLocal} activeOpacity={0.9}>
                <MaterialCommunityIcons name="delete-outline" size={20} color="#fecaca" />
                <Text style={styles.deleteText}>Remove local account from this device</Text>
              </TouchableOpacity>
            )}
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.82)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  safeArea: { width: '100%', alignItems: 'center' },
  sheet: {
    width: '92%',
    maxWidth: 560,
    maxHeight: '94%',
    backgroundColor: '#161616',
    borderRadius: 26,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    padding: 16,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 },
  headerIconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(34,197,94,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(34,197,94,0.28)',
  },
  title: { color: '#fff', fontSize: 24, fontWeight: '900' },
  subtitle: { color: '#b8c0cc', fontSize: 13, lineHeight: 18, marginTop: 2, fontWeight: '700' },
  closePill: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  closeText: { color: '#fff', fontSize: 18, fontWeight: '900' },
  introCard: {
    backgroundColor: '#242424',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    padding: 14,
    marginBottom: 14,
  },
  introTitle: { color: '#fff', fontWeight: '900', fontSize: 16 },
  introText: { color: '#cbd5e1', fontWeight: '700', lineHeight: 20, marginTop: 6, fontSize: 13.5 },
  sectionTitle: { color: '#fff', fontSize: 18, fontWeight: '900', marginBottom: 4 },
  sectionHint: { color: '#aeb7c4', fontSize: 13, lineHeight: 18, marginBottom: 10, fontWeight: '600' },
  levelList: { paddingBottom: 8 },
  levelCard: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-start',
    padding: 12,
    borderRadius: 18,
    backgroundColor: '#242424',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    marginBottom: 10,
  },
  levelCardActive: {
    borderColor: 'rgba(34,197,94,0.75)',
    backgroundColor: 'rgba(34,197,94,0.10)',
  },
  levelIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  levelIconActive: { backgroundColor: '#22c55e' },
  levelTitle: { color: '#fff', fontSize: 15.5, fontWeight: '900' },
  levelShort: { color: '#d1d5db', fontSize: 13, fontWeight: '800', marginTop: 2 },
  levelExample: { color: '#94a3b8', fontSize: 12.5, lineHeight: 17, marginTop: 5, fontWeight: '600' },
  previewBox: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    borderRadius: 16,
    padding: 12,
    marginTop: 4,
  },
  previewLabel: { color: '#94a3b8', fontSize: 12.5, fontWeight: '800' },
  previewText: { color: '#fff', fontSize: 16, fontWeight: '900', marginTop: 3 },
  saveBtn: {
    marginTop: 12,
    minHeight: 54,
    borderRadius: 18,
    backgroundColor: '#22c55e',
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveText: { color: '#07110a', fontSize: 16, fontWeight: '900' },
  deleteBtn: {
    marginTop: 12,
    minHeight: 48,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(248,113,113,0.35)',
    backgroundColor: 'rgba(248,113,113,0.10)',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  deleteText: { color: '#fecaca', fontSize: 13.5, fontWeight: '900' },
});
