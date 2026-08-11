import { useState, useEffect } from 'react';
import NetInfo, { NetInfoState } from '@react-native-community/netinfo';

export function useNetworkStatus(): NetInfoState {
  const [networkStatus, setNetworkStatus] = useState<NetInfoState>({
    type: 'unknown',
    isConnected: null,
    isInternetReachable: null,
    details: null,
  } as unknown as NetInfoState);

  useEffect(() => {
    // Get initial state
    NetInfo.fetch().then((state) => {
      setNetworkStatus(state);
    });

    // Subscribe to state updates
    const unsubscribe = NetInfo.addEventListener((state) => {
      setNetworkStatus(state);
    });

    return () => {
      unsubscribe();
    };
  }, []);

  return networkStatus;
}

export default useNetworkStatus;
