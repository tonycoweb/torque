// components/TorqueStoreModal.js
// Custom RevenueCat store modal for Torque energy packs + vehicle slots.
// Purchase happens on-device with RevenueCat; granting happens on your Lambda backend.

import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Purchases from 'react-native-purchases';
import { MaterialCommunityIcons } from '@expo/vector-icons';

const PRODUCT_GRANTS = {
  energy_100k_099: { kind: 'energy', amount: 100000, title: '100,000 Energy' },
  energy_650k_499: { kind: 'energy', amount: 650000, title: '650,000 Energy' },
  energy_1_25m_999: { kind: 'energy', amount: 1250000, title: '1,250,000 Energy' },
  energy_3m_1999: { kind: 'energy', amount: 3000000, title: '3,000,000 Energy' },
  energy_20m_9999: { kind: 'energy', amount: 20000000, title: '20,000,000 Energy' },

  slots_1_099: { kind: 'slots', amount: 1, title: '1 Extra Vehicle Slot' },
  slots_10_499: { kind: 'slots', amount: 10, title: '10 Extra Vehicle Slots' },
  slots_30_999: { kind: 'slots', amount: 30, title: '30 Extra Vehicle Slots' },
  slots_100_1999: { kind: 'slots', amount: 100, title: '100 Extra Vehicle Slots' },
  slots_1000_9999: { kind: 'slots', amount: 1000, title: '1000 Extra Vehicle Slots' },
};

const ORDER = [
  'energy_100k_099',
  'energy_650k_499',
  'energy_1_25m_999',
  'energy_3m_1999',
  'energy_20m_9999',
  'slots_1_099',
  'slots_10_499',
  'slots_30_999',
  'slots_100_1999',
  'slots_1000_9999',
];

function moneySafe(pkg) {
  return pkg?.product?.priceString || pkg?.product?.price?.toString?.() || '';
}

function productIdOf(pkg) {
  return pkg?.product?.identifier || pkg?.identifier || '';
}

function findLatestTransactionForProduct(customerInfo, productId) {
  if (!customerInfo || !productId) return null;

  const candidates = [];

  // Current RevenueCat SDKs usually expose nonSubscriptionTransactions as an array.
  if (Array.isArray(customerInfo.nonSubscriptionTransactions)) {
    candidates.push(...customerInfo.nonSubscriptionTransactions);
  }

  // Some older/shaped payloads expose nonSubscriptions keyed by product id.
  const keyed = customerInfo.nonSubscriptions?.[productId];
  if (Array.isArray(keyed)) candidates.push(...keyed);

  const matching = candidates.filter((t) => {
    const ids = [
      t?.productIdentifier,
      t?.productId,
      t?.product_id,
      t?.storeProductIdentifier,
      t?.store_identifier,
    ]
      .filter(Boolean)
      .map(String);
    return ids.includes(productId);
  });

  matching.sort((a, b) => {
    const ad = Date.parse(a?.purchaseDate || a?.purchase_date || a?.purchasedAt || '') || Number(a?.purchaseDateMillis || 0) || 0;
    const bd = Date.parse(b?.purchaseDate || b?.purchase_date || b?.purchasedAt || '') || Number(b?.purchaseDateMillis || 0) || 0;
    return bd - ad;
  });

  const t = matching[0] || null;
  if (!t) return null;

  return {
    transactionId:
      t.transactionIdentifier ||
      t.transactionId ||
      t.transaction_id ||
      t.storeTransactionIdentifier ||
      t.store_purchase_identifier ||
      null,
    productId,
    purchaseDate: t.purchaseDate || t.purchase_date || t.purchasedAt || null,
    raw: t,
  };
}

export default function TorqueStoreModal({
  visible,
  onClose,
  onGrantPurchase,
  currentEnergy = null,
  carSlotBonus = 0,
}) {
  const [loading, setLoading] = useState(false);
  const [buying, setBuying] = useState(null);
  const [packages, setPackages] = useState([]);
  const [lastLoadedAt, setLastLoadedAt] = useState(null);

  const loadOfferings = async () => {
    try {
      setLoading(true);
      const offerings = await Purchases.getOfferings();
      const current = offerings?.current;
      const available = current?.availablePackages || [];

      const sorted = [...available].sort((a, b) => {
        const ai = ORDER.indexOf(productIdOf(a));
        const bi = ORDER.indexOf(productIdOf(b));
        return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
      });

      setPackages(sorted);
      setLastLoadedAt(new Date());

      if (!sorted.length) {
        console.log('RevenueCat offerings:', JSON.stringify(offerings, null, 2));
      }
    } catch (e) {
      console.warn('RevenueCat offerings failed:', e?.message || e);
      Alert.alert('Store unavailable', e?.message || 'Could not load purchase options.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (visible) loadOfferings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const energyPackages = useMemo(
    () => packages.filter((p) => productIdOf(p).startsWith('energy_')),
    [packages]
  );
  const slotPackages = useMemo(
    () => packages.filter((p) => productIdOf(p).startsWith('slots_')),
    [packages]
  );

  const handleBuy = async (pkg) => {
    const productId = productIdOf(pkg);
    const grant = PRODUCT_GRANTS[productId];

    if (!productId || !grant) {
      Alert.alert('Product not mapped', `This product is not mapped in the app yet: ${productId || '(missing)'}`);
      return;
    }

    try {
      setBuying(productId);

      const purchaseResult = await Purchases.purchasePackage(pkg);
      const customerInfo = purchaseResult?.customerInfo || purchaseResult;
      const latest = findLatestTransactionForProduct(customerInfo, productId);

      const transactionId =
        latest?.transactionId ||
        purchaseResult?.transaction?.transactionIdentifier ||
        purchaseResult?.transaction?.transactionId ||
        purchaseResult?.transactionIdentifier ||
        purchaseResult?.transactionId ||
        null;

      const appUserID = await Purchases.getAppUserID().catch(() => null);

      const grantResult = await onGrantPurchase?.({
        productId,
        packageIdentifier: pkg?.identifier || productId,
        transactionId,
        appUserID,
        platform: Platform.OS,
        purchaseDate: latest?.purchaseDate || null,
        customerInfo,
      });

      Alert.alert(
        'Purchase added',
        grantResult?.message ||
          (grant.kind === 'energy'
            ? `Added ${grant.amount.toLocaleString()} energy.`
            : `Added ${grant.amount.toLocaleString()} vehicle slot${grant.amount === 1 ? '' : 's'}.`)
      );
    } catch (e) {
      const cancelled = e?.userCancelled || e?.code === 'PURCHASE_CANCELLED' || /cancel/i.test(String(e?.message || ''));
      if (!cancelled) {
        console.warn('Purchase failed:', e?.message || e);
        Alert.alert('Purchase failed', e?.message || 'Could not complete purchase.');
      }
    } finally {
      setBuying(null);
    }
  };

  const renderPackage = (pkg) => {
    const productId = productIdOf(pkg);
    const grant = PRODUCT_GRANTS[productId] || {};
    const isBuying = buying === productId;
    const isEnergy = grant.kind === 'energy';

    return (
      <TouchableOpacity
        key={`${pkg.identifier}-${productId}`}
        style={[styles.card, isEnergy ? styles.energyCard : styles.slotCard]}
        onPress={() => handleBuy(pkg)}
        disabled={!!buying || loading}
        activeOpacity={0.86}
      >
        <View style={styles.cardIconWrap}>
          <MaterialCommunityIcons
            name={isEnergy ? 'lightning-bolt' : 'garage'}
            size={24}
            color={isEnergy ? '#FFD700' : '#4CAF50'}
          />
        </View>

        <View style={styles.cardTextWrap}>
          <Text style={styles.cardTitle}>{grant.title || pkg?.product?.title || productId}</Text>
          <Text style={styles.cardSub}>
            {isEnergy
              ? 'Use for Torque chat, image diagnosis, and audio diagnosis.'
              : 'Permanently increases your saved vehicle capacity.'}
          </Text>
        </View>

        <View style={styles.priceWrap}>
          {isBuying ? <ActivityIndicator color="#fff" /> : <Text style={styles.priceText}>{moneySafe(pkg)}</Text>}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <View>
              <Text style={styles.title}>Torque Store</Text>
              <Text style={styles.subtitle}>Buy energy or expand your garage.</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn} disabled={!!buying}>
              <MaterialCommunityIcons name="close" size={24} color="#fff" />
            </TouchableOpacity>
          </View>

          <View style={styles.balanceRow}>
            <View style={styles.balancePill}>
              <MaterialCommunityIcons name="lightning-bolt" size={16} color="#FFD700" />
              <Text style={styles.balanceText}>
                Energy: {typeof currentEnergy === 'number' ? currentEnergy.toLocaleString() : '—'}
              </Text>
            </View>
            <View style={styles.balancePill}>
              <MaterialCommunityIcons name="garage" size={16} color="#4CAF50" />
              <Text style={styles.balanceText}>Bonus slots: {Number(carSlotBonus || 0).toLocaleString()}</Text>
            </View>
          </View>

          {loading ? (
            <View style={styles.loadingBox}>
              <ActivityIndicator color="#4CAF50" size="large" />
              <Text style={styles.loadingText}>Loading store...</Text>
            </View>
          ) : (
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 24 }}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Energy Packs</Text>
                <Text style={styles.sectionNote}>Charged only for chat, photo diagnosis, and audio diagnosis.</Text>
              </View>
              {energyPackages.length ? energyPackages.map(renderPackage) : <Text style={styles.empty}>No energy packs found.</Text>}

              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Vehicle Slot Packs</Text>
                <Text style={styles.sectionNote}>Permanent garage expansion. Packs stack.</Text>
              </View>
              {slotPackages.length ? slotPackages.map(renderPackage) : <Text style={styles.empty}>No slot packs found.</Text>}

              <TouchableOpacity style={styles.reloadBtn} onPress={loadOfferings} disabled={loading || !!buying}>
                <MaterialCommunityIcons name="reload" size={16} color="#fff" />
                <Text style={styles.reloadText}>Reload Store</Text>
              </TouchableOpacity>
              {lastLoadedAt ? <Text style={styles.loadedAt}>Loaded {lastLoadedAt.toLocaleTimeString()}</Text> : null}
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    justifyContent: 'flex-end',
  },
  sheet: {
    maxHeight: '88%',
    backgroundColor: '#151515',
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingHorizontal: 18,
    paddingTop: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  title: { color: '#fff', fontSize: 24, fontWeight: '900' },
  subtitle: { color: '#a8a8a8', fontSize: 13, marginTop: 3 },
  closeBtn: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: '#2a2a2a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  balanceRow: { flexDirection: 'row', gap: 8, marginBottom: 12, flexWrap: 'wrap' },
  balancePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#222',
    borderWidth: 1,
    borderColor: '#333',
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
  },
  balanceText: { color: '#eee', fontSize: 12, fontWeight: '800' },
  loadingBox: { paddingVertical: 55, alignItems: 'center' },
  loadingText: { color: '#ddd', marginTop: 12, fontWeight: '700' },
  sectionHeader: { marginTop: 12, marginBottom: 8 },
  sectionTitle: { color: '#fff', fontSize: 18, fontWeight: '900' },
  sectionNote: { color: '#999', fontSize: 12, marginTop: 3 },
  empty: { color: '#999', fontSize: 13, paddingVertical: 10 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 18,
    padding: 13,
    marginBottom: 10,
    borderWidth: 1,
  },
  energyCard: { backgroundColor: '#211f12', borderColor: 'rgba(255,215,0,0.25)' },
  slotCard: { backgroundColor: '#102016', borderColor: 'rgba(76,175,80,0.25)' },
  cardIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.07)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  cardTextWrap: { flex: 1 },
  cardTitle: { color: '#fff', fontSize: 15, fontWeight: '900' },
  cardSub: { color: '#a9a9a9', fontSize: 11, marginTop: 3, lineHeight: 15 },
  priceWrap: {
    minWidth: 70,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2f6fed',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 13,
    marginLeft: 8,
  },
  priceText: { color: '#fff', fontSize: 13, fontWeight: '900' },
  reloadBtn: {
    alignSelf: 'center',
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: '#333',
  },
  reloadText: { color: '#fff', fontWeight: '800' },
  loadedAt: { color: '#777', textAlign: 'center', marginTop: 7, fontSize: 11 },
});
