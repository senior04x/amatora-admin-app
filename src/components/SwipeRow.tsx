import React, { useRef, useEffect } from 'react';
import { View, StyleSheet, Animated, PanResponder, TouchableWithoutFeedback } from 'react-native';

interface Props {
  isOpen?: boolean;
  onOpen?: () => void;
  onClose?: () => void;
  children: React.ReactNode;
  actions: React.ReactNode;
  actionWidth?: number;
}

export const SwipeRow: React.FC<Props> = ({
  isOpen = false,
  onOpen,
  onClose,
  children,
  actions,
  actionWidth = 110,
}) => {
  const panX = useRef(new Animated.Value(0)).current;
  const isOpenRef = useRef(isOpen);

  useEffect(() => {
    isOpenRef.current = isOpen;
    if (!isOpen) {
      Animated.spring(panX, {
        toValue: 0,
        useNativeDriver: true,
        bounciness: 4,
      }).start();
    } else {
      Animated.spring(panX, {
        toValue: -actionWidth,
        useNativeDriver: true,
        bounciness: 4,
      }).start();
    }
  }, [isOpen, actionWidth]);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gestureState) => {
        return Math.abs(gestureState.dx) > 8 && Math.abs(gestureState.dy) < 12;
      },
      onPanResponderGrant: () => {
        if (!isOpenRef.current && onOpen) {
          onOpen();
        }
      },
      onPanResponderMove: (_, gestureState) => {
        const startVal = isOpenRef.current ? -actionWidth : 0;
        let newX = startVal + gestureState.dx;
        if (newX > 0) newX = 0;
        if (newX < -actionWidth - 20) newX = -actionWidth - 20;
        panX.setValue(newX);
      },
      onPanResponderRelease: (_, gestureState) => {
        if (gestureState.dx < -actionWidth / 3) {
          Animated.spring(panX, {
            toValue: -actionWidth,
            useNativeDriver: true,
            bounciness: 4,
          }).start();
          if (onOpen) onOpen();
        } else {
          Animated.spring(panX, {
            toValue: 0,
            useNativeDriver: true,
            bounciness: 4,
          }).start();
          if (onClose) onClose();
        }
      },
    })
  ).current;

  const handleRowPress = () => {
    if (isOpenRef.current) {
      Animated.spring(panX, {
        toValue: 0,
        useNativeDriver: true,
      }).start();
      if (onClose) onClose();
    }
  };

  // Actions slide in smoothly from the right edge with fading opacity & scale
  const actionsTranslateX = panX.interpolate({
    inputRange: [-actionWidth, 0],
    outputRange: [0, actionWidth * 0.8],
    extrapolate: 'clamp',
  });

  const actionsOpacity = panX.interpolate({
    inputRange: [-actionWidth, -15, 0],
    outputRange: [1, 0.3, 0],
    extrapolate: 'clamp',
  });

  const actionsScale = panX.interpolate({
    inputRange: [-actionWidth, 0],
    outputRange: [1, 0.85],
    extrapolate: 'clamp',
  });

  return (
    <View style={styles.container}>
      {/* Action Buttons sliding in from right */}
      <Animated.View
        pointerEvents={isOpen ? 'auto' : 'none'}
        style={[
          styles.actionsContainer,
          {
            width: actionWidth,
            opacity: actionsOpacity,
            transform: [
              { translateX: actionsTranslateX },
              { scale: actionsScale },
            ],
          },
        ]}
      >
        {actions}
      </Animated.View>

      {/* Main Foreground Content */}
      <Animated.View
        style={[styles.content, { transform: [{ translateX: panX }] }]}
        {...panResponder.panHandlers}
      >
        <TouchableWithoutFeedback onPress={handleRowPress}>
          <View style={{ flex: 1 }}>{children}</View>
        </TouchableWithoutFeedback>
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'relative',
    marginBottom: 12,
    overflow: 'hidden',
    borderRadius: 18,
  },
  actionsContainer: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
    paddingRight: 6,
    zIndex: 1,
  },
  content: {
    backgroundColor: 'transparent',
    borderRadius: 18,
    zIndex: 2,
  },
});
