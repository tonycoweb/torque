import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  FlatList,
  Alert,
} from 'react-native';
import { getAllVehicles } from '../utils/VehicleStorage';
import { useEffect } from 'react';

export default function VehicleSelector({ selectedVehicle=null, onSelectVehicle, triggerVinCamera }) {
  const [modalVisible, setModalVisible] = useState(false);
  const [showVinModal, setShowVinModal] = useState(false);
  const [detailsModalVisible, setDetailsModalVisible] = useState(false);
  const [vehicles, setVehicles] = useState([]);

  useEffect(() => {
    if (modalVisible) {
      loadGarage();
    }
  }, [modalVisible]);
  
  const loadGarage = async () => {
    const saved = await getAllVehicles();
    setVehicles(saved.reverse()); // latest at top
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
    Alert.alert('Manual Entry', 'Open form to enter vehicle details manually.');
  };

  const renderVehicle = ({ item }) => (
    <TouchableOpacity
      style={styles.vehicleCard}
      onPress={() => {
        setDetailsModalVisible(false); // clean slate
        onSelectVehicle(item);
        setModalVisible(false);
      }}
      onLongPress={() => {
        setModalVisible(false);
        onSelectVehicle(item); // still set as selected
        setTimeout(() => setDetailsModalVisible(true), 500); // open detail modal
      }}
      
    >
      <Text style={styles.title}>{item.year} {item.make} {item.model}</Text>
      <Text style={styles.details}>
  {item.engine || '—'} • {item.hp || '--'} HP • {item.mpg || '--'} MPG • GVW {item.gvw || '--'}
</Text>

    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      {selectedVehicle ? (
        <TouchableOpacity
        style={styles.selectedCard}
        onPress={() => setModalVisible(true)} // open garage list instead
        onLongPress={() => setDetailsModalVisible(true)} // long press to view full detail
        >
          <Text style={styles.title}>{selectedVehicle.year} {selectedVehicle.make}</Text>
          <Text style={styles.details}>{selectedVehicle.model} ({selectedVehicle.engine})</Text>
          <Text style={styles.stats}>MPG: {selectedVehicle.mpg} • HP: {selectedVehicle.hp} • GVW: {selectedVehicle.gvw}</Text>
        </TouchableOpacity>
      ) : (
        <TouchableOpacity style={styles.placeholder} onPress={() => setShowVinModal(true)}>
          <Text style={styles.plus}>+</Text>
          <Text style={styles.label}>Add Your Vehicle</Text>
        </TouchableOpacity>
      )}

      {/* Garage Modal */}
      <Modal visible={modalVisible} animationType="slide">
        <View style={styles.modalContainer}>
          <Text style={styles.modalTitle}>Your Garage</Text>
          <FlatList
            data={vehicles}
            keyExtractor={(item) => item.id || item.vin || Math.random().toString()}
            renderItem={renderVehicle}
            contentContainerStyle={{ paddingBottom: 40 }}
          />
          <TouchableOpacity style={styles.addNewButton} onPress={handleAddNew}>
            <Text style={styles.addNewText}>+ Add Vehicle (Manual or VIN Image)</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.closeButton}
            onPress={() => setModalVisible(false)}
          >
            <Text style={styles.closeText}>Close</Text>
          </TouchableOpacity>
        </View>
      </Modal>

      {/* VIN Modal */}
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
              <Text style={styles.hintText}>• Registration card{'\n'}• Vehicle title{'\n'}• Insurance paper{'\n'}• Driver-side door sticker{'\n'}• Front windshield (bottom corner)</Text>
              <Text style={styles.helperNote}>❓ Not sure? Just tap the camera and we’ll help detect it automatically.</Text>
            </View>
          </View>
        </Modal>
      )}

      {/* Full Details Modal */}
      <Modal visible={detailsModalVisible} animationType="slide">
  <View style={styles.modalContainer}>
    <Text style={styles.modalTitle}>Vehicle Details</Text>
    {selectedVehicle ? (
      <>
        <Text style={styles.detailsText}>Year: {selectedVehicle.year}</Text>
        <Text style={styles.detailsText}>Make: {selectedVehicle.make}</Text>
        <Text style={styles.detailsText}>Model: {selectedVehicle.model}</Text>
        <Text style={styles.detailsText}>Engine: {selectedVehicle.engine}</Text>
        <Text style={styles.detailsText}>HP: {selectedVehicle.hp}</Text>
        <Text style={styles.detailsText}>GVW: {selectedVehicle.gvw}</Text>
        {selectedVehicle.vin && <Text style={styles.detailsText}>VIN: {selectedVehicle.vin}</Text>}
        {selectedVehicle.trim && <Text style={styles.detailsText}>Trim: {selectedVehicle.trim}</Text>}
        {selectedVehicle.transmission && (
          <Text style={styles.detailsText}>Transmission: {selectedVehicle.transmission}</Text>
        )}
      </>
    ) : (
      <Text style={styles.detailsText}>No vehicle selected</Text>
    )}
    <TouchableOpacity onPress={() => setDetailsModalVisible(false)} style={styles.closeButton}>
      <Text style={styles.closeText}>Close</Text>
    </TouchableOpacity>
  </View>
</Modal>

    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    paddingVertical: 20,
  },
  placeholder: {
    backgroundColor: '#444',
    padding: 32,
    borderRadius: 15,
    alignItems: 'center',
    borderColor: '#888',
    borderWidth: 1,
  },
  plus: {
    fontSize: 40,
    color: '#ccc',
  },
  label: {
    fontSize: 16,
    color: '#aaa',
    marginTop: 8,
  },
  selectedCard: {
    backgroundColor: '#333',
    padding: 28,
    borderRadius: 15,
    alignItems: 'center',
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
  },
  details: {
    fontSize: 14,
    color: '#ccc',
    marginVertical: 4,
  },
  stats: {
    fontSize: 12,
    color: '#aaa',
  },
  modalContainer: {
    flex: 1,
    backgroundColor: '#121212',
    padding: 20,
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 20,
    alignSelf: 'center',
  },
  detailsText: {
    fontSize: 16,
    color: '#ccc',
    marginBottom: 10,
  },
  vehicleCard: {
    backgroundColor: '#222',
    padding: 20,
    marginBottom: 14,
    borderRadius: 12,
  },
  addNewButton: {
    marginTop: 20,
    padding: 14,
    backgroundColor: '#444',
    borderRadius: 10,
    alignItems: 'center',
  },
  addNewText: {
    color: '#fff',
    fontSize: 16,
  },
  closeButton: {
    marginTop: 16,
    alignItems: 'center',
  },
  closeText: {
    color: '#999',
    fontSize: 14,
  },
  vinModalContainer: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  vinModalBox: {
    backgroundColor: '#1c1c1c',
    padding: 24,
    borderRadius: 16,
    width: '85%',
  },
  closeIcon: {
    position: 'absolute',
    top: 10,
    right: 10,
    padding: 8,
  },
  optionBtn: {
    backgroundColor: '#333',
    padding: 14,
    borderRadius: 12,
    marginBottom: 14,
  },
  optionText: {
    color: '#fff',
    fontSize: 16,
  },
  divider: {
    borderBottomWidth: 1,
    borderBottomColor: '#444',
    marginVertical: 16,
  },
  hintTitle: {
    color: '#ccc',
    fontWeight: 'bold',
    marginBottom: 8,
  },
  hintText: {
    color: '#aaa',
    lineHeight: 22,
  },
  helperNote: {
    color: '#888',
    marginTop: 12,
    fontStyle: 'italic',
  },
});
