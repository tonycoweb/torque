import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  FlatList,
  Alert,
  TextInput,
  SafeAreaView,
} from 'react-native';
import { getAllVehicles, deleteVehicleByVin, saveVehicle } from '../utils/VehicleStorage';
import ManualVehicleEntry from './ManualVehicleEntry';

export default function VehicleSelector({ selectedVehicle = null, onSelectVehicle, triggerVinCamera }) {
  const [modalVisible, setModalVisible] = useState(false);
  const [showVinModal, setShowVinModal] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [vehicles, setVehicles] = useState([]);
  const [editableVehicle, setEditableVehicle] = useState(null);
  const [showManualEntry, setShowManualEntry] = useState(false);

  useEffect(() => {
    if (modalVisible) loadGarage();
  }, [modalVisible]);

  const loadGarage = async () => {
    const saved = await getAllVehicles();
    setVehicles(saved.reverse());
  };

  const handleAddNew = () => {
    setModalVisible(false);
    setShowVinModal(true);
  };

  const handleCaptureVin = () => {
    setShowVinModal(false);
    triggerVinCamera();
  };

  const handleManualEntry = () => {
    setShowVinModal(false);
    setShowManualEntry(true);
  };

  const handleDelete = async (vin) => {
    Alert.alert('Delete Vehicle?', 'This will remove it from your garage.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteVehicleByVin(vin);
          const updatedList = vehicles.filter(v => v.vin !== vin);
          setVehicles(updatedList);
          if (selectedVehicle?.vin === vin) onSelectVehicle(null);
        },
      },
    ]);
  };

  const handleEdit = (vehicle) => {
    setModalVisible(false);
    setTimeout(() => {
      // Parse mpg string into city and highway for editing
      let city = '';
      let highway = '';
      if (vehicle.mpg && typeof vehicle.mpg === 'string') {
        const match = vehicle.mpg.match(/(\d+)\s*city\s*\/\s*(\d+)\s*highway/);
        if (match) {
          city = match[1];
          highway = match[2];
        }
      }
      setEditableVehicle({ ...vehicle, mpgCity: city, mpgHighway: highway });
      setEditMode(true);
    }, 300);
  };

  const handleSaveEdit = async () => {
    const updatedVehicle = {
      ...editableVehicle,
      mpg: editableVehicle.mpgCity && editableVehicle.mpgHighway
        ? `${editableVehicle.mpgCity} city / ${editableVehicle.mpgHighway} highway`
        : editableVehicle.mpg || '',
    };
    delete updatedVehicle.mpgCity;
    delete updatedVehicle.mpgHighway;

    await saveVehicle(updatedVehicle);
    const updatedList = vehicles.map(v =>
      v.vin === updatedVehicle.vin ? updatedVehicle : v
    );
    setVehicles(updatedList);
    if (selectedVehicle?.vin === updatedVehicle.vin) {
      onSelectVehicle(updatedVehicle);
    }
    setEditMode(false);
    setEditableVehicle(null);
  };

  const renderMpg = (mpg) => {
    if (!mpg || typeof mpg !== 'string') return '--/--';
    const match = mpg.match(/(\d+)\s*city\s*\/\s*(\d+)\s*highway/);
    return match ? `${match[1]}/${match[2]}` : '--/--';
  };

  const renderVehicle = ({ item }) => (
    <TouchableOpacity
      style={styles.vehicleCard}
      onPress={() => {
        onSelectVehicle(item);
        setModalVisible(false);
      }}
    >
      <Text style={styles.title}>{item.year} {item.make} {item.model}</Text>
      <Text style={styles.details}>
        {item.engine || '—'} • {item.hp || '--'} HP • {renderMpg(item.mpg)} MPG • GVW {item.gvw || '--'}
      </Text>
      <View style={styles.inlineBtns}>
        <TouchableOpacity onPress={() => handleEdit(item)} style={styles.actionBtn}>
          <Text style={styles.smallText}>✏️ Edit</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => handleDelete(item.vin)} style={styles.actionBtn}>
          <Text style={styles.smallText}>🗑️ Delete</Text>
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      {selectedVehicle ? (
        <TouchableOpacity
          style={styles.selectedCard}
          onPress={() => setModalVisible(true)}
        >
          <Text style={styles.title}>{selectedVehicle.year} {selectedVehicle.make}</Text>
          <Text style={styles.details}>{selectedVehicle.model} ({selectedVehicle.engine})</Text>
          <Text style={styles.stats}>
            MPG: {renderMpg(selectedVehicle.mpg)} • HP: {selectedVehicle.hp || '--'} • GVW: {selectedVehicle.gvw || '--'}
          </Text>
        </TouchableOpacity>
      ) : (
        <TouchableOpacity style={styles.placeholder} onPress={() => setShowVinModal(true)}>
          <Text style={styles.plus}>+</Text>
          <Text style={styles.label}>Add Your Vehicle</Text>
        </TouchableOpacity>
      )}

      <Modal visible={modalVisible} animationType="slide">
        <SafeAreaView style={styles.modalContainer}>
          <Text style={styles.modalTitle}>Your Garage</Text>
          <FlatList
            data={vehicles}
            keyExtractor={(item) => item.vin || Math.random().toString()}
            renderItem={renderVehicle}
            contentContainerStyle={{ paddingBottom: 40 }}
          />
          <TouchableOpacity style={styles.addNewButton} onPress={handleAddNew}>
            <Text style={styles.addNewText}>+ Add Vehicle (Manual or VIN Image)</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.closeButton} onPress={() => setModalVisible(false)}>
            <Text style={styles.closeText}>Close</Text>
          </TouchableOpacity>
        </SafeAreaView>
      </Modal>

      {showVinModal && (
        <Modal transparent={true} animationType="slide">
          <View style={styles.vinModalContainer}>
            <View style={styles.vinModalBox}>
              <TouchableOpacity onPress={() => setShowVinModal(false)} style={styles.closeIcon}>
                <Text style={{ color: '#ccc', fontSize: 20 }}>✖</Text>
              </TouchableOpacity>
              <Text style={styles.modalTitle}>Add a Vehicle</Text>
              <TouchableOpacity style={styles.optionBtn} onPress={handleCaptureVin}>
                <Text style={styles.optionText}>📷 Use Camera to Scan VIN</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.optionBtn} onPress={handleManualEntry}>
                <Text style={styles.optionText}>📝 Enter Vehicle Details Manually</Text>
              </TouchableOpacity>
              <View style={styles.divider} />
              <Text style={styles.hintTitle}>🧾 Where to find your VIN?</Text>
              <Text style={styles.hintText}>
                {`• Registration card\n• Vehicle title\n• Insurance paper\n• Driver-side door sticker\n• Front windshield (bottom corner)`}
              </Text>
              <Text style={styles.helperNote}>❓ Not sure? Just tap the camera and we’ll help detect it automatically.</Text>
            </View>
          </View>
        </Modal>
      )}

      {editMode && editableVehicle && (
        <Modal visible={editMode} animationType="slide">
          <View style={styles.modalContainer}>
            <Text style={styles.modalTitle}>Edit Vehicle</Text>
            {[
              { key: 'year', label: 'Year' },
              { key: 'make', label: 'Make' },
              { key: 'model', label: 'Model' },
              { key: 'engine', label: 'Engine' },
              { key: 'mpgCity', label: 'MPG (City)' },
              { key: 'mpgHighway', label: 'MPG (Highway)' },
              { key: 'hp', label: 'Horsepower (HP)' },
              { key: 'gvw', label: 'GVW (Gross Vehicle Weight)' },
            ].map(({ key, label }) => (
              <View key={key} style={{ marginBottom: 12 }}>
                <Text style={styles.inputLabel}>{label}</Text>
                <TextInput
                  style={styles.input}
                  placeholder={label}
                  placeholderTextColor="#777"
                  value={editableVehicle[key]?.toString() || ''}
                  onChangeText={(text) => setEditableVehicle({ ...editableVehicle, [key]: text })}
                />
              </View>
            ))}
            <TouchableOpacity onPress={handleSaveEdit} style={styles.addNewButton}>
              <Text style={styles.addNewText}>💾 Save Changes</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setEditMode(false)} style={styles.closeButton}>
              <Text style={styles.closeText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </Modal>
      )}

      {showManualEntry && (
        <Modal animationType="slide">
          <ManualVehicleEntry
            onClose={() => setShowManualEntry(false)}
            onSave={async (result) => {
              const vehicleToSave = Array.isArray(result) ? result[0] : result;
              await saveVehicle(vehicleToSave);
              setVehicles(prev => [vehicleToSave, ...prev]);
              onSelectVehicle(vehicleToSave);
              setShowManualEntry(false);
            }}
          />
        </Modal>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { width: '100%', paddingVertical: 20 },
  placeholder: { backgroundColor: '#444', padding: 32, borderRadius: 15, alignItems: 'center', borderColor: '#888', borderWidth: 1 },
  plus: { fontSize: 40, color: '#ccc' },
  label: { fontSize: 16, color: '#aaa', marginTop: 8 },
  selectedCard: { backgroundColor: '#333', padding: 28, borderRadius: 15, alignItems: 'center' },
  title: { fontSize: 20, fontWeight: 'bold', color: '#fff' },
  details: { fontSize: 14, color: '#ccc', marginVertical: 4 },
  stats: { fontSize: 12, color: '#aaa' },
  modalContainer: { flex: 1, backgroundColor: '#121212', padding: 30, paddingTop: 50 },
  modalTitle: { fontSize: 24, fontWeight: 'bold', color: '#fff', marginBottom: 24, alignSelf: 'center' },
  vehicleCard: { backgroundColor: '#222', padding: 20, marginBottom: 14, borderRadius: 12 },
  inlineBtns: { flexDirection: 'row', justifyContent: 'space-around', marginTop: 12 },
  actionBtn: { padding: 10, backgroundColor: '#333', borderRadius: 10 },
  smallText: { fontSize: 16, color: '#fff' },
  addNewButton: { marginTop: 30, padding: 16, backgroundColor: '#4CAF50', borderRadius: 12, alignItems: 'center' },
  addNewText: { color: '#fff', fontSize: 17 },
  closeButton: { marginTop: 20, paddingVertical: 12, borderRadius: 10, alignItems: 'center' },
  closeText: { fontSize: 16, color: '#ccc' },
  vinModalContainer: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center' },
  vinModalBox: { backgroundColor: '#1c1c1c', padding: 24, borderRadius: 16, width: '85%' },
  closeIcon: { position: 'absolute', top: 10, right: 10, padding: 8 },
  optionBtn: { backgroundColor: '#333', padding: 14, borderRadius: 12, marginBottom: 14 },
  optionText: { color: '#fff', fontSize: 16 },
  divider: { borderBottomWidth: 1, borderBottomColor: '#444', marginVertical: 16 },
  hintTitle: { color: '#ccc', fontWeight: 'bold', marginBottom: 8 },
  hintText: { color: '#aaa', lineHeight: 22 },
  helperNote: { color: '#888', marginTop: 12, fontStyle: 'italic' },
  input: { backgroundColor: '#222', color: '#fff', padding: 10, borderRadius: 8, borderColor: '#444', borderWidth: 1 },
  inputLabel: { color: '#ccc', marginBottom: 4, fontSize: 14 },
});