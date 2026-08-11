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

  return (
    <View style={styles.container}>
      {/* Hidden Action Buttons behind */}
      <View style={[styles.actionsContainer, { width: actionWidth }]}>
        {actions}
      </View>

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
    backgroundColor: '#1E293B',
    borderRadius: 18,
    zIndex: 2,
  },
});
