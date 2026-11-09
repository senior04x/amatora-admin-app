import React, { useLayoutEffect, useMemo, useRef } from 'react';
import { ActivityIndicator, Animated, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

const HANDLE = 44;
const INSET = 4;

type Props = {
  label: string;
  accent: string;
  disabled: boolean;
  busy: boolean;
  isDark: boolean;
  onComplete: () => Promise<void>;
};

export default function MatchActionSlider({ label, accent, disabled, busy, isDark, onComplete }: Props) {
  const offset = useRef(new Animated.Value(0)).current;
  const travel = useRef(0);
  const submitting = useRef(false);
  const mounted = useRef(false);
  const latest = useRef({ onComplete, unavailable: true });
  const unavailable = disabled || busy;

  useLayoutEffect(() => {
    latest.current = { onComplete, unavailable };
  }, [onComplete, unavailable]);

  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      offset.stopAnimation();
    };
  }, [offset]);

  const actions = useMemo(() => {
    const reset = () => {
      Animated.spring(offset, { toValue: 0, speed: 22, bounciness: 0, useNativeDriver: true }).start();
    };
    const submit = async () => {
      if (!mounted.current || latest.current.unavailable || submitting.current || travel.current <= 0) return;
      submitting.current = true;
      offset.setValue(travel.current);
      void Haptics.selectionAsync().catch(() => {});
      try {
        await latest.current.onComplete();
      } finally {
        submitting.current = false;
        if (mounted.current) reset();
      }
    };
    const pan = Gesture.Pan()
      .runOnJS(true)
      .enabled(!unavailable)
      .activeOffsetX(7)
      .failOffsetY([-12, 12])
      .maxPointers(1)
      .onStart(() => offset.stopAnimation())
      .onUpdate(({ translationX }) => {
        if (!submitting.current) offset.setValue(Math.max(0, Math.min(travel.current, translationX)));
      })
      .onEnd(({ translationX }, success) => {
        if (success && translationX >= travel.current * 0.82) void submit();
      })
      .onFinalize(() => {
        if (mounted.current && !submitting.current) reset();
      });
    return { pan, submit };
  }, [offset, unavailable]);

  const labelOpacity = offset.interpolate({
    inputRange: [0, 22, 76],
    outputRange: [1, 1, 0],
    extrapolate: 'clamp',
  });

  return (
    <View
      accessible
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint="O‘ngga suring yoki ekran o‘quvchisi orqali faollashtiring."
      accessibilityState={{ disabled: unavailable, busy }}
      accessibilityActions={unavailable ? [] : [{ name: 'activate', label }]}
      onAccessibilityTap={unavailable ? undefined : () => void actions.submit()}
      onAccessibilityAction={({ nativeEvent }) => {
        if (nativeEvent.actionName === 'activate') void actions.submit();
      }}
      onLayout={({ nativeEvent }) => {
        travel.current = Math.max(0, nativeEvent.layout.width - HANDLE - INSET * 2 - 2);
      }}
      style={[
        styles.track,
        {
          backgroundColor: isDark ? `${accent}21` : `${accent}16`,
          borderColor: `${accent}7A`,
        },
      ]}
    >
      {busy ? (
        <ActivityIndicator color={isDark ? '#FFFFFF' : '#292929'} />
      ) : (
        <Animated.View pointerEvents="none" style={[styles.label, { opacity: labelOpacity }]}>
          <Text style={[styles.text, { color: isDark ? '#FFFFFF' : '#202020' }]}>{label}</Text>
        </Animated.View>
      )}
      <GestureDetector gesture={actions.pan}>
        <Animated.View style={[styles.handle, { backgroundColor: accent, opacity: busy ? 0 : 1, transform: [{ translateX: offset }] }]}>
          <Ionicons name="arrow-forward" size={21} color="#171717" />
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    alignSelf: 'center',
    width: '86%',
    maxWidth: 270,
    minHeight: HANDLE + INSET * 2 + 2,
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  label: { paddingLeft: HANDLE + INSET * 2 + 6, paddingRight: 16, paddingVertical: 9 },
  text: { textAlign: 'center', fontWeight: '700', fontSize: 14 },
  handle: {
    position: 'absolute',
    left: INSET,
    width: HANDLE,
    height: HANDLE,
    borderRadius: HANDLE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 2,
    shadowColor: '#000000',
    shadowOpacity: 0.2,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 2 },
  },
});
