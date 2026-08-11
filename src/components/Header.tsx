import React, { useRef, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image, Animated } from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { useOrg } from '../context/OrgContext';

const HeaderSkeletonLoader: React.FC<{ width?: number | string; height?: number; style?: any }> = ({
  width = 100,
  height = 14,
  style,
}) => {
  const opacity = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.8,
          duration: 700,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.3,
          duration: 700,
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, [opacity]);

  return (
    <Animated.View
      style={[
        {
          width,
          height,
          borderRadius: 6,
          backgroundColor: 'rgba(255, 255, 255, 0.15)',
          opacity,
        },
        style,
      ]}
    />
  );
};

export const Header: React.FC = () => {
  const { currentOrg, loading } = useOrg();

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Xayrli tong';
    if (hour < 18) return 'Xayrli kun';
    return 'Xayrli kech';
  };

  return (
    <BlurView intensity={50} tint="dark" style={styles.headerContainer}>
      <View style={styles.leftRow}>
        {/* Skeleton for Logo */}
        <View style={styles.logoBadge}>
          {loading ? (
            <HeaderSkeletonLoader width={44} height={44} style={{ borderRadius: 12 }} />
          ) : currentOrg?.logo_url ? (
            <Image
              source={{ uri: currentOrg.logo_url }}
              style={styles.logoImage}
              resizeMode="contain"
            />
          ) : (
            <Ionicons name="trophy" size={24} color="#00FF66" />
          )}
        </View>

        {/* Skeleton for Name & Status */}
        <View style={styles.titleCol}>
          {loading ? (
            <View style={{ gap: 6 }}>
              <HeaderSkeletonLoader width={140} height={16} />
            </View>
          ) : (
            <>
              <Text style={styles.orgName}>{currentOrg?.name || 'Havas Futbol Ligasi'}</Text>
              <Text style={styles.greetingText}>{getGreeting()}</Text>
            </>
          )}
        </View>
      </View>

      <View style={styles.rightRow}>
        <TouchableOpacity style={{ position: 'relative', padding: 4 }}>
          <Ionicons name="notifications-outline" size={24} color="#FFFFFF" />
          <View style={styles.notifBadge} />
        </TouchableOpacity>
      </View>
    </BlurView>
  );
};

const styles = StyleSheet.create({
  headerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 56, // Shifted down for top space
    paddingBottom: 16,
    backgroundColor: 'transparent',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.08)',
  },
  leftRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  logoBadge: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoImage: {
    width: 44,
    height: 44,
  },
  titleCol: {
    justifyContent: 'center',
  },
  orgName: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  greetingText: {
    color: 'rgba(255, 255, 255, 0.6)',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 2,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  statusText: {
    color: 'rgba(255, 255, 255, 0.6)',
    fontSize: 11,
    fontWeight: '600',
  },
  rightRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  notifBadge: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#EF4444',
  },
});
