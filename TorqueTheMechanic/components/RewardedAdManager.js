import {
  RewardedAd,
  RewardedAdEventType,
  TestIds,
} from 'react-native-google-mobile-ads';

let rewarded = RewardedAd.createForAdRequest(TestIds.REWARDED);

export const showRewardedAd = () => {
  return new Promise((resolve) => {
    const cleanup = () => {
      rewarded.removeAllListeners();
      rewarded = RewardedAd.createForAdRequest(TestIds.REWARDED);
    };

    rewarded.addAdEventListener(RewardedAdEventType.LOADED, () => {
      console.log('🚀 TEST Ad loaded');
      rewarded.show();
    });

    rewarded.addAdEventListener(RewardedAdEventType.EARNED_REWARD, (reward) => {
      console.log('✅ Reward from TEST ad:', reward);
      cleanup();
      resolve(true);
    });

    rewarded.addAdEventListener(RewardedAdEventType.CLOSED, () => {
      console.log('🔕 Ad closed without reward.');
      cleanup();
      resolve(false);
    });

    rewarded.addAdEventListener(RewardedAdEventType.ERROR, (e) => {
      console.error('❌ TEST ad error:', e);
      cleanup();
      resolve(false);
    });

    console.log('📡 Loading test ad...');
    rewarded.load();
  });
};
