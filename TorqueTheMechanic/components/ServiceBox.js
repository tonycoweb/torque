import React, { useState, useEffect, useRef } from 'react';
import { KeyboardAvoidingView, Platform, ActivityIndicator } from 'react-native';
import DatePicker from 'react-native-date-picker';
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
  TextInput,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { showRewardedAd, preloadRewardedAd } from '../components/RewardedAdManager';

export default function ServiceBox({ selectedVehicle }) {
  const [modalVisible, setModalVisible] = useState(false);
  const [imageModal, setImageModal] = useState(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [services, setServices] = useState([]);
  const [editService, setEditService] = useState(null);
  const [tempNotes, setTempNotes] = useState('');
  const [tempMileage, setTempMileage] = useState('');
  const [tempDate, setTempDate] = useState('');
  const [cameraPermission, requestCameraPermission] = ImagePicker.useCameraPermissions();
  const [mediaPermission, requestMediaPermission] = ImagePicker.useMediaLibraryPermissions();
  const scrollViewRef = useRef(null);
  const screenWidth = Dimensions.get('window').width;
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [date, setDate] = useState(new Date());
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showInfoModal, setShowInfoModal] = useState(false);
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [currentMileage, setCurrentMileage] = useState('');
  const [customTitle, setCustomTitle] = useState('');
  const [customMileage, setCustomMileage] = useState('');
  const [hasGeneratedServices, setHasGeneratedServices] = useState(false);
  const [showDecodingModal, setShowDecodingModal] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false); // New state to lock UI during generation

  useEffect(() => {
    console.log('ServiceBox: selectedVehicle prop:', selectedVehicle);
    const loadData = async () => {
      if (!selectedVehicle?.id) {
        setServices([]);
        setHasGeneratedServices(false);
        return;
      }
      try {
        const storageKey = `servicesData_${selectedVehicle.id}`;
        const generatedKey = `generatedServices_${selectedVehicle.id}`;
        const [storedServices, generatedFlag] = await Promise.all([
          AsyncStorage.getItem(storageKey),
          AsyncStorage.getItem(generatedKey),
        ]);
        if (storedServices) {
          setServices(JSON.parse(storedServices));
          console.log(`Loaded services for vehicle ${selectedVehicle.id}:`, JSON.parse(storedServices));
        } else {
          setServices([]);
          console.log(`No services found for vehicle ${selectedVehicle.id}`);
        }
        setHasGeneratedServices(!!generatedFlag);
        console.log(`Generated services flag for vehicle ${selectedVehicle.id}:`, !!generatedFlag);
      } catch (e) {
        console.error('Failed to load data:', e);
        setServices([]);
        setHasGeneratedServices(false);
      }
    };
    loadData();
  }, [selectedVehicle]);

  useEffect(() => {
    if (modalVisible) {
      console.log('🔄 Preloading ad for ServiceBox modal...');
      try {
        preloadRewardedAd();
      } catch (error) {
        console.error('❌ Error during ad preloading:', error);
      }
    }
  }, [modalVisible]);

  let saveTimeout = null;
  const saveServicesToStorage = async (updatedServices) => {
    if (!selectedVehicle?.id) {
      console.warn('No vehicle selected, skipping service save');
      return;
    }
    if (saveTimeout) {
      clearTimeout(saveTimeout);
    }
    saveTimeout = setTimeout(async () => {
      try {
        const storageKey = `servicesData_${selectedVehicle.id}`;
        await AsyncStorage.setItem(storageKey, JSON.stringify(updatedServices));
        console.log(`Services saved to AsyncStorage for vehicle ${selectedVehicle.id}:`, updatedServices);
      } catch (e) {
        console.error('Failed to save services:', e);
      }
    }, 500);
  };

  const handleGenerateRecommendations = () => {
    console.log('handleGenerateRecommendations: selectedVehicle:', selectedVehicle);
    if (!selectedVehicle) {
      Alert.alert('No Vehicle Selected', 'Please select a vehicle to generate service recommendations.');
      return;
    }
    setModalVisible(false);
    setTimeout(() => {
      setShowGenerateModal(true);
    }, 200);
  };

  const confirmAndGenerate = async () => {
    if (isGenerating) return; // Prevent multiple generations
    setIsGenerating(true);
    setShowGenerateModal(false);
    setShowDecodingModal(true);
    await handleConfirmGenerate();
    setIsGenerating(false);
  };

const handleConfirmGenerate = async () => {
  console.log('Confirmed generate with current mileage:', currentMileage);
  try {
    const payload = { vehicle: selectedVehicle, currentMileage: parseInt(currentMileage) || undefined };
    console.log('Sending payload to backend:', JSON.stringify(payload, null, 2));
    
    const response = await fetch('http://192.168.1.246:3001/generate-service-recommendations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      console.error('Backend response not OK:', {
        status: response.status,
        statusText: response.statusText,
      });
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    console.log('Service recommendations response:', data);
    if (data.error) {
      Alert.alert('Error', data.error);
      setShowDecodingModal(false);
      setModalVisible(true);
      return;
    }

    const newServices = data.result.map((service, index) => {
      let notes = '';
      if (service.parts && Object.keys(service.parts).length > 0) {
        notes = Object.entries(service.parts)
          .map(([key, value]) => `${key}: ${value}`)
          .join(', ');
      }
      return {
        id: Date.now().toString() + index,
        ...service,
        completed: false,
        proofUris: [],
        notes,
        mileage: '',
        date: 'N/A',
      };
    });

    console.log('Step 1: Setting services...');
    setServices(newServices);
    console.log('Step 2: Saving to storage...');
    await saveServicesToStorage(newServices);
    console.log('Step 3: Setting async storage flag...');
    await AsyncStorage.setItem(`generatedServices_${selectedVehicle.id}`, 'true');
    console.log('Step 4: Setting hasGenerated...');
    setHasGeneratedServices(true);
    console.log('Generated services:', newServices);

    console.log('Step 5: Showing rewarded ad...');
    try {
      const adResult = await showRewardedAd();
      if (adResult) {
        console.log('✅ User earned reward from ad');
      } else {
        console.log('🔕 Ad was skipped or failed');
        Alert.alert('Ad Skipped', 'Please watch the ad to proceed with service recommendations.');
      }
    } catch (adError) {
      console.error('❌ Error showing rewarded ad:', adError);
      Alert.alert('Ad Error', 'Failed to load ad. Proceeding to service recommendations.');
    }

    console.log('Step 6: Hiding decoding modal...');
    setShowDecodingModal(false);
    console.log('Step 7: Re-opening modal...');
    setTimeout(() => {
      setModalVisible(true);
      console.log('✅ Reopened modal after ad and generation');
    }, 200); // Slight delay to ensure smooth transition

    setTimeout(() => {
      try {
        if (scrollViewRef.current?.scrollToEnd) {
          scrollViewRef.current.scrollToEnd({ animated: true });
        }
      } catch (e) {
        console.warn('⚠️ scrollToEnd failed:', e.message);
      }
    }, 300);

    setCurrentMileage('');
  } catch (error) {
    console.error('Error generating recommendations:', {
      message: error.message,
      stack: error.stack,
      name: error.name,
    });
    setShowDecodingModal(false);
    setModalVisible(true);
    Alert.alert('Error', 'Failed to generate service recommendations: ' + error.message);
  }
};

  const handleCreateCustomServiceButton = () => {
    console.log('Add Custom Service button pressed');
    setModalVisible(false);
    setImageModal(null);
    setEditService(null);
    setShowCreateModal(true);
  };

  const handleCreateCustomService = () => {
    console.log('handleCreateCustomService:', { customTitle, customMileage });
    if (!customTitle.trim()) {
      Alert.alert('Missing Title', 'Please enter a service title.');
      return;
    }

    const serviceText = customMileage.trim() ? `${customTitle} - ${customMileage} miles` : customTitle;
    const newService = {
      id: Date.now().toString(),
      text: serviceText,
      priority: 'low',
      completed: false,
      proofUris: [],
      notes: '',
      mileage: '',
      date: 'N/A',
    };

    const updatedServices = [...services, newService];
    setServices(updatedServices);
    saveServicesToStorage(updatedServices);
    console.log('New service added:', newService);

    setCustomTitle('');
    setCustomMileage('');
    setShowCreateModal(false);
    setModalVisible(true);

    setTimeout(() => {
      if (scrollViewRef.current) {
        scrollViewRef.current.scrollToEnd({ animated: true });
      }
    }, 100);
  };

  const handleDeleteService = (id) => {
    Alert.alert(
      'Delete Service',
      'Are you sure you want to delete this service?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            setServices(prev => {
              const updated = prev.filter(service => service.id !== id);
              saveServicesToStorage(updated);
              return updated;
            });
          },
        },
      ]
    );
  };

  useEffect(() => {
    console.log('Modal states:', { modalVisible, imageModal, showCreateModal, showInfoModal, showGenerateModal, editService, showDecodingModal });
  }, [modalVisible, imageModal, showCreateModal, showInfoModal, showGenerateModal, editService, showDecodingModal]);

  useEffect(() => {
    console.log('Services state updated:', services);
  }, [services]);

  const handleSaveDetails = () => {
    if (!editService) return;

    setServices(prev => {
      const updated = prev.map(service =>
        service.id === editService.id
          ? { ...service, notes: tempNotes, mileage: tempMileage, date: editService.date }
          : service
      );
      saveServicesToStorage(updated);
      return updated;
    });

    setEditService(null);
    setModalVisible(true);
  };

  const openEditDetails = (service) => {
    setModalVisible(false);
    setEditService(service);
    setTempNotes(service.notes || '');
    setTempMileage(service.mileage || '');
    setTempDate(service.date || '');
  };

  const handleMarkCompleted = (id) => {
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
        'Would you like to upload proof of service?',
        [
          { text: 'Later', style: 'cancel' },
          { text: 'Yes', onPress: () => handleUploadProof(id) },
        ]
      );
    }, 300);
  };

  const handleUnmarkCompleted = (id) => {
    Alert.alert(
      'Unmark Completed',
      'Are you sure you want to unmark this service?',
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
              mediaTypes: ImagePicker.MediaTypeOptions.Images,
              quality: 0.7,
            });
            if (!result.canceled && result.assets?.[0]?.uri) {
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
              mediaTypes: ImagePicker.MediaTypeOptions.Images,
              quality: 0.7,
            });
            if (!result.canceled && result.assets?.[0]?.uri) {
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
            setModalVisible(true);
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

  const sortedServices = [
    ...services.filter(s => !s.completed),
    ...services.filter(s => s.completed),
  ];

  const renderServiceDetails = (service) => {
    return (
      <View style={styles.detailsBox}>
        <Text style={styles.detailText}>Notes: {service.notes || 'N/A'}</Text>
        <Text style={styles.detailText}>Date: {service.date || 'N/A'}</Text>
      </View>
    );
  };

  const safeCloseModal = () => {
    setImageModal(null);
    setModalVisible(true);
  };

  return (
    <>
      <TouchableOpacity style={styles.container} onPress={() => setModalVisible(true)} disabled={isGenerating}>
        <Text style={styles.label}>Recommended Service:</Text>
        <Text style={styles.mileage}>
          {services.find(s => !s.completed && s.priority === 'high')?.text ||
            services.find(s => !s.completed)?.text ||
            'No pending service'}
        </Text>
        <MaterialIcons name="keyboard-arrow-down" size={24} color="#fff" />
      </TouchableOpacity>

      <Modal visible={modalVisible} transparent animationType="none">
        <View style={styles.modalWrapper}>
          <View style={styles.modalBox}>
            <View style={styles.headerRow}>
  <TouchableOpacity
    onPress={() => {
      setModalVisible(false);
      setTimeout(() => setShowInfoModal(true), 200);
    }}
    style={styles.headerButton}
  >
    <MaterialIcons name="info-outline" size={24} color="#fff" />
  </TouchableOpacity>
  <Text style={styles.modalTitle} numberOfLines={1} adjustsFontSizeToFit>
    All Service Recommendations
  </Text>
  <TouchableOpacity
    onPress={() => setModalVisible(false)}
    style={styles.headerButton}
  >
    <Text style={styles.modalCloseText}>×</Text>
  </TouchableOpacity>
</View>
            <ScrollView
              ref={scrollViewRef}
              contentContainerStyle={styles.scrollContent}
              initialNumToRender={10} // Optimize rendering
              windowSize={5} // Reduce active rendering window
            >
              {sortedServices.map(service => (
                <View
                  key={service.id}
                  style={[
                    styles.serviceItem,
                    service.completed
                      ? styles.serviceCompleted
                      : styles[`service${service.priority.charAt(0).toUpperCase() + service.priority.slice(1)}`],
                  ]}
                >
                  <View style={styles.serviceHeader}>
                    <Text style={styles.serviceText}>{service.text}</Text>
                    <TouchableOpacity
                      style={styles.deleteButton}
                      onPress={() => handleDeleteService(service.id)}
                    >
                      <MaterialCommunityIcons name="trash-can-outline" size={16} color="#fff" />
                    </TouchableOpacity>
                  </View>
                  {service.proofUris.length > 0 && (
                    <ScrollView
                      horizontal
                      style={styles.proofRow}
                      contentContainerStyle={styles.proofRowContent}
                    >
                      {service.proofUris.map((uri, index) => (
                        <TouchableOpacity
                          key={index}
                          onPress={() => {
                            console.log('Thumbnail clicked:', { serviceId: service.id, index, uri });
                            setModalVisible(false);
                            setImageModal({ serviceId: service.id, index });
                            setCurrentIndex(index);
                          }}
                          style={styles.thumbnailContainer}
                          activeOpacity={0.7}
                        >
                          <Image source={{ uri }} style={styles.thumbnail} />
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  )}
                  {renderServiceDetails(service)}
                  <View style={styles.buttonRow}>
                    {service.completed ? (
                      <>
                        <TouchableOpacity
                          style={styles.completeButton}
                          onPress={() => handleUnmarkCompleted(service.id)}
                        >
                          <MaterialCommunityIcons name="refresh" size={16} color="#fff" />
                          <Text style={styles.completeText}> Unmark</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.completeButton}
                          onPress={() => handleUploadProof(service.id)}
                        >
                          <MaterialCommunityIcons name="plus-circle-outline" size={16} color="#fff" />
                          <Text style={styles.completeText}> Add Proof</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.completeButton}
                          onPress={() => openEditDetails(service)}
                        >
                          <MaterialIcons name="edit" size={16} color="#fff" />
                          <Text style={styles.completeText}> Edit Details</Text>
                        </TouchableOpacity>
                      </>
                    ) : (
                      <TouchableOpacity
                        style={styles.completeButton}
                        onPress={() => handleMarkCompleted(service.id)}
                      >
                        <MaterialCommunityIcons name="check-circle-outline" size={16} color="#fff" />
                        <Text style={styles.completeText}> Mark Completed</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              ))}
              <TouchableOpacity
                style={styles.addServiceButton}
                onPress={handleCreateCustomServiceButton}
                disabled={isGenerating}
              >
                <Text style={styles.addServiceText}>+ Add Custom Service</Text>
              </TouchableOpacity>
              {!hasGeneratedServices && (
                <TouchableOpacity
                  style={styles.generateButton}
                  onPress={handleGenerateRecommendations}
                  disabled={isGenerating}
                >
                  <Text style={styles.addServiceText}>Generate Recommended Service Records</Text>
                </TouchableOpacity>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal
        visible={showInfoModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowInfoModal(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalOverlay}
        >
          <View style={styles.modalContent}>
            <TouchableOpacity
              onPress={() => {
                setShowInfoModal(false);
                setModalVisible(true);
              }}
              style={styles.modalCloseIcon}
            >
              <Text style={styles.modalCloseText}>×</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>About Service Recommendations</Text>
            <Text style={styles.infoText}>
              The ServiceBox feature in TorqueTheMechanic helps you manage your vehicle's maintenance by providing a list of recommended services tailored to your specific vehicle. You can view, mark as completed, or add custom service records, and attach proof of service (e.g., receipts).
            </Text>
            <Text style={styles.infoText}>
              The "Generate Recommended Service Records" feature uses advanced automotive expertise to suggest maintenance tasks based on your vehicle's year, make, model, and engine specifications. These recommendations are sourced from standard maintenance schedules and may include part numbers for common services like oil changes.
            </Text>
            <Text style={styles.disclaimerText}>
              Disclaimer: All service recommendations and part numbers are provided for informational purposes only. Always verify maintenance schedules and part compatibility with your vehicle's manufacturer or a certified mechanic before performing any service. TorqueTheMechanic is not liable for any damages or issues arising from the use of these recommendations.
            </Text>
            <TouchableOpacity
              style={styles.completeButton}
              onPress={() => {
                setShowInfoModal(false);
                setModalVisible(true);
              }}
            >
              <Text style={styles.completeText}>Close</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        visible={showGenerateModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowGenerateModal(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalOverlay}
        >
          <View style={styles.modalContent}>
            <TouchableOpacity
              onPress={() => {
                setShowGenerateModal(false);
                setModalVisible(true);
              }}
              style={styles.modalCloseIcon}
            >
              <Text style={styles.modalCloseText}>×</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Generate Service Recommendations</Text>
            <Text style={styles.infoText}>
              This feature will generate a personalized list of recommended maintenance tasks for your {selectedVehicle?.year} {selectedVehicle?.make} {selectedVehicle?.model}. The recommendations are based on standard maintenance schedules and may include part numbers for services like oil changes or filter replacements.
            </Text>
            <Text style={styles.infoText}>
              To provide the most accurate recommendations, you can optionally enter your vehicle's current mileage below. This helps prioritize services based on how close your vehicle is to recommended intervals (e.g., a timing belt replacement may be low priority at 20,000 miles but high priority near 105,000 miles).
            </Text>
            <TextInput
              style={styles.inputField}
              placeholder="Current Mileage (optional)"
              value={currentMileage}
              onChangeText={setCurrentMileage}
              placeholderTextColor="#777"
              keyboardType="numeric"
            />
            <Text style={styles.disclaimerText}>
              Transparency: Recommendations are generated using advanced automotive expertise and trusted data sources. Always verify with your vehicle's manual or a certified mechanic to ensure accuracy and safety.
            </Text>
            <View style={styles.buttonRow}>
              <TouchableOpacity
                style={[styles.completeButton, { backgroundColor: '#4CAF50' }]}
                onPress={confirmAndGenerate}
                disabled={isGenerating}
              >
                <Text style={styles.completeText}>Continue</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.completeButton, { backgroundColor: '#FF5252' }]}
                onPress={() => {
                  setShowGenerateModal(false);
                  setModalVisible(true);
                }}
              >
                <Text style={styles.completeText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        visible={!!imageModal}
        transparent
        animationType="fade"
        onRequestClose={safeCloseModal}
      >
        <View style={styles.imageModalOverlay}>
          <TouchableOpacity
            style={styles.closeIcon}
            onPress={safeCloseModal}
            activeOpacity={0.7}
          >
            <Text style={styles.closeIconText}>✕</Text>
          </TouchableOpacity>
          {imageModal && services.find(s => s.id === imageModal.serviceId)?.proofUris?.length > 0 ? (
            <ScrollView
              ref={scrollViewRef}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              onMomentumScrollEnd={(e) => {
                const newIndex = Math.round(e.nativeEvent.contentOffset.x / screenWidth);
                console.log('ScrollView index:', newIndex);
                setCurrentIndex(newIndex);
              }}
              style={styles.imageScrollView}
            >
              {services
                .find(s => s.id === imageModal.serviceId)
                .proofUris.map((uri, index) => (
                  <View
                    key={index}
                    style={[styles.fullImageWrapper, { width: screenWidth }]}
                  >
                    <Image
                      source={{ uri }}
                      style={styles.fullImage}
                      resizeMode="contain"
                      onError={(e) => console.log('Image load error:', e.nativeEvent.error)}
                    />
                  </View>
                ))}
            </ScrollView>
          ) : (
            <View style={styles.fullImageWrapper}>
              <Text style={styles.errorText}>No images available for this service</Text>
            </View>
          )}
          <View style={styles.imageActions}>
            <TouchableOpacity
              style={styles.iconButtonLeft}
              onPress={() => deleteImage(imageModal.serviceId, currentIndex)}
              activeOpacity={0.7}
            >
              <MaterialCommunityIcons name="trash-can-outline" size={32} color="red" />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.iconButtonRight}
              onPress={() => {
                const uri = services.find(s => s.id === imageModal.serviceId)?.proofUris[currentIndex];
                if (uri) {
                  downloadImage(uri);
                } else {
                  Alert.alert('Error', 'No image available to download');
                }
              }}
              activeOpacity={0.7}
            >
              <MaterialCommunityIcons name="download" size={32} color="#fff" />
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={!!editService} transparent animationType="fade">
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalWrapper}
        >
          <ScrollView contentContainerStyle={styles.scrollContent}>
            <View style={styles.modalBox}>
              <Text style={styles.modalTitle}>Edit Details for:</Text>
              <Text style={styles.serviceLabel}>{editService?.text}</Text>
              <Text style={styles.label}>Notes</Text>
              <TextInput
                placeholder="Describe what was done..."
                value={tempNotes}
                onChangeText={setTempNotes}
                style={[styles.inputField, { height: 80, textAlignVertical: 'top' }]}
                multiline
              />
              <Text style={styles.label}>Date</Text>
              <TouchableOpacity onPress={() => setShowDatePicker(true)}>
                <View style={[styles.inputField, { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }]}>
                  <Text style={{ color: '#fff' }}>
                    {editService?.date ? editService.date : 'Select a Date'}
                  </Text>
                  <MaterialIcons name="calendar-today" size={20} color="#fff" />
                </View>
              </TouchableOpacity>
              <DatePicker
                modal
                open={showDatePicker}
                date={date}
                mode="date"
                theme="dark"
                onConfirm={(selectedDate) => {
                  setShowDatePicker(false);
                  setDate(selectedDate);
                  setEditService(prev => ({
                    ...prev,
                    date: selectedDate.toISOString().split('T')[0],
                  }));
                }}
                onCancel={() => setShowDatePicker(false)}
              />
              <View style={styles.buttonRow}>
                <TouchableOpacity
                  onPress={handleSaveDetails}
                  style={[styles.modalButton, { backgroundColor: '#4CAF50' }]}
                >
                  <Text style={styles.modalButtonText}>✅ Save</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => {
                    setEditService(null);
                    setModalVisible(true);
                  }}
                  style={[styles.modalButton, { backgroundColor: '#FF5252' }]}
                >
                  <Text style={styles.modalButtonText}>✖ Cancel</Text>
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        visible={showCreateModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowCreateModal(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalOverlay}
        >
          <View style={styles.modalContent}>
            <TouchableOpacity
              onPress={() => {
                setShowCreateModal(false);
                setModalVisible(true);
              }}
              style={styles.modalCloseIcon}
            >
              <Text style={styles.modalCloseText}>×</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Add Custom Service</Text>
            <TextInput
              style={styles.inputField}
              placeholder="Service Title"
              value={customTitle}
              onChangeText={setCustomTitle}
              placeholderTextColor="#777"
            />
            <TextInput
              style={styles.inputField}
              placeholder="Mileage"
              value={customMileage}
              onChangeText={setCustomMileage}
              placeholderTextColor="#777"
              keyboardType="numeric"
            />
            <TouchableOpacity
              style={styles.completeButton}
              onPress={handleCreateCustomService}
            >
              <Text style={styles.completeText}>Create</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={showDecodingModal} transparent animationType="fade">
        <View style={styles.decodingModal}>
          <Text style={styles.decodingText}>🔧 Torque is generating the service intervals...</Text>
          <ActivityIndicator size="large" color="#4CAF50" />
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#333',
    borderRadius: 12,
    padding: 26,
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
    backgroundColor: 'rgba(0,0,0,0.95)',
    paddingTop: 50,
    zIndex: 0,
  },
  scrollContent: {
    flexGrow: 1,
    paddingBottom: 20,
  },
  modalBox: {
    backgroundColor: 'rgba(0,0,0,0.95)',
    borderRadius: 20,
    marginHorizontal: 16,
    elevation: 10,
    paddingBottom: 20,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    marginBottom: 16,
  },
  infoButton: {
    padding: 10,
  },
  modalTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold',
    alignSelf: 'center',
  },
  serviceLabel: {
    fontSize: 14,
    color: '#FFD700',
    marginBottom: 16,
  },
  serviceItem: {
    borderRadius: 8,
    padding: 12,
    marginBottom: 10,
  },
  serviceHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  serviceText: {
    color: '#fff',
    fontSize: 16,
    marginBottom: 4,
    flex: 1,
  },
  deleteButton: {
    backgroundColor: '#FF5252',
    padding: 6,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  proofRow: {
    marginTop: 8,
  },
  proofRowContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  thumbnailContainer: {
    marginRight: 8,
    borderRadius: 6,
    width: 60,
    height: 60,
    zIndex: 100,
    pointerEvents: 'auto',
  },
  thumbnail: {
    width: '100%',
    height: '100%',
    borderRadius: 6,
  },
  detailsBox: {
    marginTop: 8,
    backgroundColor: '#2b2b2b',
    padding: 8,
    borderRadius: 6,
  },
  detailText: {
    color: '#ccc',
    fontSize: 12,
    marginBottom: 2,
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
    marginTop: 24,
    flexWrap: 'wrap',
  },
  modalButton: {
    flex: 1,
    padding: 12,
    borderRadius: 10,
    marginHorizontal: 5,
  },
  modalButtonText: {
    textAlign: 'center',
    color: '#fff',
    fontWeight: '600',
  },
  completeButton: {
    backgroundColor: '#4CAF50',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 6,
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 8,
    marginBottom: 6,
  },
  completeText: {
    color: '#fff',
    fontSize: 12,
    marginLeft: 5,
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
  inputField: {
    backgroundColor: '#111',
    color: '#fff',
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#444',
    fontSize: 14,
    marginBottom: 12,
  },
  imageModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.9)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 2000,
  },
  imageScrollView: {
    flex: 1,
    width: '100%',
  },
  fullImageWrapper: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    width: Dimensions.get('window').width,
    backgroundColor: '#000',
  },
  fullImage: {
    width: '100%',
    height: '80%',
    maxHeight: Dimensions.get('window').height * 0.8,
    backgroundColor: '#333',
  },
  closeIcon: {
    position: 'absolute',
    top: 40,
    right: 20,
    zIndex: 2010,
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
    bottom: 40,
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    paddingHorizontal: 20,
    zIndex: 2010,
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
  errorText: {
    color: '#fff',
    fontSize: 16,
    textAlign: 'center',
  },
  modalCloseIcon: {
    position: 'absolute',
    right: 5,
    zIndex: 1000,
    backgroundColor: '#fff',
    width: 27,
    height: 27,
    borderRadius: 13.5,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
  },
  modalCloseText: {
    color: '#000',
    fontSize: 18,
    fontWeight: 'bold',
    lineHeight: 20,
  },
  addServiceButton: {
    marginTop: 10,
    marginBottom: 50,
    alignSelf: 'center',
    backgroundColor: '#4CAF50',
    paddingVertical: 10,
    paddingHorizontal: 36,
    height: 40,
    borderRadius: 10,
    zIndex: 1000,
  },
  generateButton: {
    marginTop: 10,
    marginBottom: 20,
    alignSelf: 'center',
    backgroundColor: '#2196F3',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 10,
    zIndex: 1000,
  },
  addServiceText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.95)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: '#222',
    borderRadius: 20,
    padding: 20,
    width: '90%',
    maxHeight: '80%',
  },
  infoText: {
    color: '#fff',
    fontSize: 14,
    marginBottom: 12,
    lineHeight: 20,
  },
  disclaimerText: {
    color: '#ccc',
    fontSize: 12,
    marginBottom: 12,
    lineHeight: 18,
    fontStyle: 'italic',
  },
  decodingModal: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.85)',
    zIndex: 9999,
  },
  decodingText: {
    color: '#fff',
    fontSize: 18,
    marginBottom: 20,
  },
  headerRow: {
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'space-between',
  paddingHorizontal: 16,
  marginBottom: 16,
  width: '100%',
},
headerButton: {
  width: 36,
  height: 36,
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: 'rgba(255, 255, 255, 0.1)',
  borderRadius: 22,
},
modalTitle: {
  color: '#fff',
  fontSize: 20,
  fontWeight: 'bold',
  flex: 1,
  textAlign: 'center',
  marginHorizontal: 8,
},
modalCloseText: {
  color: '#fff',
  fontSize: 20,
  fontWeight: 'bold',
  lineHeight: 22,
},
});