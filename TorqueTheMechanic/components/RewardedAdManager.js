import {
  RewardedAd,
  RewardedAdEventType,
} from 'react-native-google-mobile-ads';
import { Platform } from 'react-native';

const adUnitId = __DEV__
  ? Platform.OS === 'ios'
    ? 'ca-app-pub-3940256099942544/1712485313' // iOS test rewarded ad unit ID
    : 'ca-app-pub-3940256099942544/5224354917' // Android test rewarded ad unit ID
  : 'your-real-admob-id-here'; // Replace with your real AdMob ID for production

let rewarded = null;
let isLoading = false;
let isPreloaded = false;

const initializeAd = () => {
  console.log('🆕 Initializing new RewardedAd instance');
  rewarded = RewardedAd.createForAdRequest(adUnitId, {
    requestNonPersonalizedAdsOnly: true,
  });
  isPreloaded = false;
  return rewarded;
};

export const showRewardedAd = async (retries = 2) => {
  if (isLoading) {
    console.warn('🚫 Ad already loading, aborting new request');
    return false;
  }

  isLoading = true;
  console.log('📡 Attempting to show rewarded ad with unit ID:', adUnitId);
  console.log('🔍 RewardedAdEventType values:', RewardedAdEventType);

  return new Promise((resolve) => {
    const cleanup = () => {
      console.log('🧹 Cleaning up ad listeners...');
      if (rewarded) {
        rewarded.removeAllListeners();
      }
      rewarded = null;
      isLoading = false;
      isPreloaded = false;
    };

    const attemptLoad = async (attempt = 1) => {
      let ad = isPreloaded && rewarded ? rewarded : initializeAd();
      console.log(`🔍 Ad state before load (attempt ${attempt}):`, {
        isLoaded: ad && typeof ad.isLoaded === 'function' ? ad.isLoaded() : false,
        isLoading: ad && typeof ad.isLoading === 'function' ? ad.isLoading() : false,
      });

      let timeoutId = setTimeout(() => {
        console.warn(`⏱️ Ad load timeout on attempt ${attempt}`);
        cleanup();
        if (attempt < retries) {
          console.log(`🔄 Retrying ad load, attempt ${attempt + 1}`);
          attemptLoad(attempt + 1);
        } else {
          console.error('❌ Max retries reached, ad failed to load');
          resolve(false);
        }
      }, 15000);

      try {
        if (!ad) {
          console.error(`❌ Ad instance invalid on attempt ${attempt}`);
          clearTimeout(timeoutId);
          cleanup();
          if (attempt < retries) {
            console.log(`🔄 Retrying ad load, attempt ${attempt + 1}`);
            attemptLoad(attempt + 1);
          } else {
            console.error('❌ Max retries reached, ad instance invalid');
            resolve(false);
          }
          return;
        }

        ad.addAdEventListener(RewardedAdEventType.LOADED, () => {
          console.log('🚀 Rewarded ad loaded successfully');
          clearTimeout(timeoutId);
          try {
            ad.show();
            console.log('🎬 Ad displayed');
          } catch (error) {
            console.error('❌ Ad show error:', error);
            clearTimeout(timeoutId);
            cleanup();
            resolve(false);
          }
        });

        ad.addAdEventListener(RewardedAdEventType.EARNED_REWARD, (reward) => {
          console.log('✅ Reward earned from ad:', reward);
          clearTimeout(timeoutId);
          cleanup();
          resolve(true);
        });

        if (RewardedAdEventType.CLOSED) {
          ad.addAdEventListener(RewardedAdEventType.CLOSED, () => {
            console.log('🔕 Ad closed without reward');
            clearTimeout(timeoutId);
            cleanup();
            resolve(false);
          });
        } else {
          console.warn('⚠️ RewardedAdEventType.CLOSED not available');
        }

        if (RewardedAdEventType.ERROR) {
          ad.addAdEventListener(RewardedAdEventType.ERROR, (error) => {
            console.error(`❌ Rewarded ad error on attempt ${attempt}:`, {
              code: error.code,
              message: error.message,
            });
            clearTimeout(timeoutId);
            cleanup();
            if (attempt < retries) {
              console.log(`🔄 Retrying ad load, attempt ${attempt + 1}`);
              attemptLoad(attempt + 1);
            } else {
              console.error('❌ Max retries reached, ad failed');
              resolve(false);
            }
          });
        } else {
          console.warn('⚠️ RewardedAdEventType.ERROR not available');
        }

        console.log(`🔄 Loading rewarded ad, attempt ${attempt}...`);
        if (!isPreloaded || !(ad && typeof ad.isLoaded === 'function' && ad.isLoaded())) {
          ad.load();
        } else {
          console.log('🔄 Using preloaded ad...');
          ad.show();
        }
      } catch (error) {
        console.error(`❌ Ad load error on attempt ${attempt}:`, error);
        clearTimeout(timeoutId);
        cleanup();
        if (attempt < retries) {
          console.log(`🔄 Retrying ad load, attempt ${attempt + 1}`);
          attemptLoad(attempt + 1);
        } else {
          console.error('❌ Max retries reached, ad failed to load');
          resolve(false);
        }
      }
    };

    attemptLoad(1);
  });
};

export const preloadRewardedAd = () => {
  if (!isLoading && !isPreloaded) {
    console.log('🔄 Preloading rewarded ad...');
    console.log('🔍 RewardedAdEventType values:', RewardedAdEventType);
    const ad = initializeAd();
    try {
      ad.addAdEventListener(RewardedAdEventType.LOADED, () => {
        console.log('🚀 Preloaded ad ready');
        isPreloaded = true;
      });
      ad.load();
    } catch (error) {
      console.error('❌ Preload ad setup error:', error);
      isPreloaded = false;
      rewarded = null;
    }
  } else {
    console.log('🔄 Skipping preload: ad already loading or preloaded');
  }
};