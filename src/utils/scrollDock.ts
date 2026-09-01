import { useRef, useCallback } from 'react';
import { DeviceEventEmitter, NativeSyntheticEvent, NativeScrollEvent, Platform } from 'react-native';

export const emitScrollDirection = (direction: 'up' | 'down') => {
  if (Platform.OS === 'ios') {
    DeviceEventEmitter.emit('nav_dock_scroll', direction);
  }
};

export const useScrollDockHandler = () => {
  const lastScrollYRef = useRef(0);
  const lastDirectionRef = useRef<'up' | 'down'>('up');

  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (Platform.OS !== 'ios') return;

    const currentY = event.nativeEvent?.contentOffset?.y ?? 0;
    const diff = currentY - lastScrollYRef.current;

    // Return to full size near the top
    if (currentY <= 15) {
      if (lastDirectionRef.current !== 'up') {
        lastDirectionRef.current = 'up';
        emitScrollDirection('up');
      }
      lastScrollYRef.current = currentY;
      return;
    }

    if (diff > 8 && lastDirectionRef.current !== 'down') {
      lastDirectionRef.current = 'down';
      emitScrollDirection('down');
    } else if (diff < -8 && lastDirectionRef.current !== 'up') {
      lastDirectionRef.current = 'up';
      emitScrollDirection('up');
    }

    lastScrollYRef.current = currentY;
  }, []);

  return { onScroll, scrollEventThrottle: 16 };
};
