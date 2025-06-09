import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  ScrollView,
  Alert,
  Image,
  Dimensions,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MaterialCommunityIcons } from '@expo/vector-icons';

export default function ServiceBox() {
  const [modalVisible, setModalVisible] = useState(false);
  const [imageModal, setImageModal] = useState(null); // { serviceId, index }
  const [currentIndex, setCurrentIndex] = useState(0);
  const [services, setServices] = useState([
    { id: '1', text: 'Timing Belt Replacement - 175,000 miles', priority: 'high', completed: false, proofUris: [] },
    { id: '2', text: 'Brake Fluid Flush - 180,000 miles', priority: 'medium', completed: false, proofUris: [] },
    { id: '3', text: 'Spark Plug Replacement - 185,000 miles', priority: 'low', completed: false, proofUris: [] },
  ]);

  const [cameraPermission, requestCameraPermission] = ImagePicker.useCameraPermissions();
  const [mediaPermission, requestMediaPermission] = ImagePicker.useMediaLibraryPermissions();
  const scrollViewRef = useRef(null);
  const screenWidth = Dimensions.get('window').width;

  useEffect(() => {
    const loadServices = async () => {
      try {
        const stored = await AsyncStorage.getItem('servicesData');
        if (stored) {
          setServices(JSON.parse(stored));
        }
      } catch (e) {
        console.log('Failed to load services:', e);
      }
    };
    loadServices();
  }, []);

  const saveServicesToStorage = async (updatedServices) => {
    try {
      await AsyncStorage.setItem('servicesData', JSON.stringify(updatedServices));
    } catch (e) {
      console.log('Failed to save services:', e);
    }
  };

  const handleUploadProof = async (serviceId) => {
    Alert.alert(
      'Attach Proof',
      'Choose an option',
      [
        {
          text: 'Camera',
          onPress: async () => {
            const cameraStatus = await requestCameraPermission();
            if (!cameraStatus.granted) {
              Alert.alert('Camera permission required');
              return;
            }
            const result = await ImagePicker.launchCameraAsync({
              mediaTypes: ['images'],
              quality: 0.7,
            });
            if (!result.canceled) {
              addProof(serviceId, result.assets[0].uri);
            }
          },
        },
        {
          text: 'Photo Library',
          onPress: async () => {
            const mediaStatus = await requestMediaPermission();
            if (!mediaStatus.granted) {
              Alert.alert('Photo library permission required');
              return;
            }
            const result = await ImagePicker.launchImageLibraryAsync({
              mediaTypes: ['images'],
              quality: 0.7,
            });
            if (!result.canceled) {
              addProof(serviceId, result.assets[0].uri);
            }
          },
        },
        { text: 'Cancel', style: 'cancel' },
      ]
    );
  };

  const addProof = (serviceId, uri) => {
    setServices(prev => {
      const updated = prev.map(service =>
        service.id === serviceId
          ? { ...service, proofUris: [...service.proofUris, uri] }
          : service
      );
      saveServicesToStorage(updated);
      return updated;
    });
  };

  const handleMarkCompleted = (id) => {
    Alert.alert(
      'Confirm Completion',
      'Are you sure you want to mark this service as completed?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Yes',
          onPress: () => {
            setServices(prev => {
              const updated = prev.map(service =>
                service.id === id ? { ...service, completed: true } : service
              );
              saveServicesToStorage(updated);
              return updated;
            });

            setTimeout(() => {
              Alert.alert(
                'Attach Receipt',
                'Would you like to upload proof of service (e.g. receipt)?',
                [
                  { text: 'Later', style: 'cancel' },
                  {
                    text: 'Yes',
                    onPress: () => handleUploadProof(id),
                  },
                ]
              );
            }, 300);
          },
        },
      ]
    );
  };

  const handleUnmarkCompleted = (id) => {
    Alert.alert(
      'Unmark Completed',
      'Are you sure you want to unmark this service as completed?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Yes',
          onPress: () => {
            setServices(prev => {
              const updated = prev.map(service =>
                service.id === id ? { ...service, completed: false } : service
              );
              saveServicesToStorage(updated);
              return updated;
            });
          },
        },
      ]
    );
  };

  const deleteImage = (serviceId, index) => {
    Alert.alert(
      'Confirm Delete',
      'Are you sure you want to delete this image?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            setServices(prev => {
              const updated = prev.map(service => {
                if (service.id === serviceId) {
                  const newUris = [...service.proofUris];
                  newUris.splice(index, 1);
                  return { ...service, proofUris: newUris };
                }
                return service;
              });
              saveServicesToStorage(updated);
              return updated;
            });
            setImageModal(null);
          },
        },
      ]
    );
  };

  const downloadImage = async (uri) => {
    const filename = uri.split('/').pop();
    const newPath = FileSystem.documentDirectory + filename;

    try {
      await FileSystem.copyAsync({
        from: uri,
        to: newPath,
      });

      const asset = await MediaLibrary.createAssetAsync(newPath);
      await MediaLibrary.createAlbumAsync('Download', asset, false);

      Alert.alert('Success', 'Image saved to gallery.');
    } catch (e) {
      console.log('Error saving image:', e);
      Alert.alert('Error', 'Failed to save image.');
    }
  };

  const highestPriority = services.find(s => !s.completed && s.priority === 'high') || services.find(s => !s.completed);

  const sortedServices = [
    ...services.filter(s => !s.completed),
    ...services.filter(s => s.completed),
  ];

  const safeCloseModal = () => {
    setImageModal(null);
    setTimeout(() => setModalVisible(false), 300);
  };

  return (
    <>
      <TouchableOpacity style={styles.container} onPress={() => setModalVisible(true)}>
        <Text style={styles.label}>Recommended Service:</Text>
        <Text style={styles.mileage}>{highestPriority?.text || 'No pending service'}</Text>
        <MaterialIcons name="keyboard-arrow-down" size={24} color="#fff" />
      </TouchableOpacity>

      <Modal visible={modalVisible} transparent animationType="slide">
        <View style={styles.modalWrapper}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>All Service Recommendations</Text>
            <ScrollView>
              {sortedServices.map(service => (
                <View
                  key={service.id}
                  style={[styles.serviceItem, service.completed ? styles.serviceCompleted : styles[`service${service.priority.charAt(0).toUpperCase() + service.priority.slice(1)}`]]}
                >
                  <Text style={styles.serviceText}>{service.text}</Text>

                  {service.proofUris.length > 0 && (
                    <ScrollView horizontal style={styles.proofRow}>
                      {service.proofUris.map((uri, index) => (
                        <TouchableOpacity
                          key={index}
                          onPress={() => {
                            setImageModal({ serviceId: service.id, index });
                            setCurrentIndex(index);
                            setTimeout(() => {
                              scrollViewRef.current?.scrollTo({
                                x: index * screenWidth,
                                animated: false,
                              });
                            }, 50);
                          }}
                          style={styles.thumbnailContainer}
                        >
                          <Image source={{ uri }} style={styles.thumbnail} />
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  )}

                  {!service.completed ? (
                    <TouchableOpacity
                      style={styles.completeButton}
                      onPress={() => handleMarkCompleted(service.id)}
                    >
                      <MaterialCommunityIcons name="check-circle-outline" size={18} color="#fff" />
                      <Text style={styles.completeText}> Mark Completed</Text>
                    </TouchableOpacity>
                  ) : (
                    <>
                      <TouchableOpacity
                        style={styles.completeButton}
                        onPress={() => handleUnmarkCompleted(service.id)}
                      >
                        <MaterialCommunityIcons name="refresh" size={18} color="#fff" />
                        <Text style={styles.completeText}> Unmark</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.completeButton}
                        onPress={() => handleUploadProof(service.id)}
                      >
                        <MaterialCommunityIcons name="plus-circle-outline" size={18} color="#fff" />
                        <Text style={styles.completeText}> Add Proof</Text>
                      </TouchableOpacity>
                    </>
                  )}
                </View>
              ))}
            </ScrollView>

            {imageModal && (
              <View style={styles.imageModalOverlay}>
                <TouchableOpacity style={styles.closeIcon} onPress={() => setImageModal(null)}>
                  <Text style={styles.closeIconText}>✕</Text>
                </TouchableOpacity>

                <ScrollView
                  ref={scrollViewRef}
                  horizontal
                  pagingEnabled
                  showsHorizontalScrollIndicator={false}
                  onMomentumScrollEnd={(e) => {
                    const newIndex = Math.round(e.nativeEvent.contentOffset.x / screenWidth);
                    setCurrentIndex(newIndex);
                  }}
                  style={styles.imageScrollView}
                >
                  {services
                    .find(s => s.id === imageModal.serviceId)
                    .proofUris.map((uri, index) => (
                      <View key={index} style={[styles.fullImageWrapper, { width: screenWidth }]}>
                        <Image source={{ uri }} style={styles.fullImage} resizeMode="contain" />
                      </View>
                    ))}
                </ScrollView>

                <View style={styles.imageActions}>
                  <TouchableOpacity
                    style={styles.iconButtonLeft}
                    onPress={() => deleteImage(imageModal.serviceId, currentIndex)}
                  >
                    <MaterialCommunityIcons name="trash-can-outline" size={32} color="red" />
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.iconButtonRight}
                    onPress={() => {
                      const uri = services.find(s => s.id === imageModal.serviceId).proofUris[currentIndex];
                      downloadImage(uri);
                    }}
                  >
                    <MaterialCommunityIcons name="download" size={32} color="#fff" />
                  </TouchableOpacity>
                </View>
              </View>
            )}

            <TouchableOpacity onPress={safeCloseModal} style={styles.closeButton}>
              <Text style={styles.closeText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </>
  );
}



const styles = StyleSheet.create({
  container: {
    backgroundColor: '#333',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginVertical: 10,
  },
  label: {
    color: '#aaa',
    fontSize: 14,
  },
  mileage: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
    marginVertical: 4,
    textAlign: 'center',
  },
  modalWrapper: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
  },
  modalBox: {
    backgroundColor: '#222',
    borderRadius: 12,
    padding: 20,
    maxHeight: '80%',
  },
  modalTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 12,
  },
  serviceItem: {
    borderRadius: 8,
    padding: 12,
    marginBottom: 10,
  },
  serviceText: {
    color: '#fff',
    fontSize: 16,
    marginBottom: 4,
  },
  proofRow: {
    flexDirection: 'row',
    marginTop: 8,
  },
  thumbnailContainer: {
    marginRight: 8,
    borderRadius: 6,
    overflow: 'hidden',
    width: 60,
    height: 60,
  },
  thumbnail: {
    width: '100%',
    height: '100%',
  },
  completeButton: {
    marginTop: 6,
    backgroundColor: '#4CAF50',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 6,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
  },
  completeText: {
    color: '#fff',
    fontSize: 12,
    marginLeft: 5,
  },
  closeButton: {
    marginTop: 20,
    backgroundColor: '#555',
    padding: 10,
    borderRadius: 8,
  },
  closeText: {
    color: '#fff',
    textAlign: 'center',
  },
  serviceCompleted: {
    backgroundColor: '#2e7d32',
  },
  serviceHigh: {
    backgroundColor: '#b71c1c',
  },
  serviceMedium: {
    backgroundColor: '#fbc02d',
  },
  serviceLow: {
    backgroundColor: '#424242',
  },
  imageModalOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 100,
  },
  imageScrollView: {
    flex: 1,
    width: '100%',
  },
  fullImageWrapper: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  fullImage: {
    width: '100%',
    height: '100%',
  },
  closeIcon: {
    position: 'absolute',
    top: 40,
    right: 20,
    zIndex: 10,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 20,
    padding: 10,
  },
  closeIconText: {
    color: '#fff',
    fontSize: 24,
  },
  imageActions: {
    position: 'absolute',
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    bottom: 40,
    paddingHorizontal: 20,
  },
  iconButtonLeft: {
    backgroundColor: 'rgba(0,0,0,0.6)',
    padding: 10,
    borderRadius: 30,
  },
  iconButtonRight: {
    backgroundColor: 'rgba(0,0,0,0.6)',
    padding: 10,
    borderRadius: 30,
  },
});
