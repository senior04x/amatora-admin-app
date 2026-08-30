import React, { useRef, useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image, Animated, Platform } from 'react-native';
import { BlurView } from './SafeBlurView';
import { Ionicons } from '@expo/vector-icons';
import { useOrg } from '../context/OrgContext';
import { useTheme } from '../context/ThemeContext';
import { supabase } from '../supabaseClient';

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

export const Header: React.FC<{
  isEditingOrder?: boolean;
  onSaveOrder?: () => void;
  onNavigate?: (tab: any) => void;
}> = ({ isEditingOrder = false, onSaveOrder, onNavigate }) => {
  const { currentOrg, currentUser, loading, userRole, unreadNotificationsCount, markAllNotificationsAsRead } = useOrg();
  const { isDark, colors, toggleTheme } = useTheme();
  const unreadCount = unreadNotificationsCount;

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Xayrli tong';
    if (hour < 18) return 'Xayrli kun';
    return 'Xayrli kech';
  };

  const displayName =
    userRole === 'user'
      ? (currentUser?.full_name || 'Organizator')
      : (currentOrg?.owner_name || currentOrg?.owner || currentOrg?.admin_name || currentOrg?.leader_name || currentUser?.full_name || currentOrg?.name || 'Admin');
  const displayAvatar = userRole === 'user' ? currentUser?.avatar_url : currentOrg?.logo_url;

  return (
    <>
      <BlurView
        intensity={Platform.OS === 'ios' ? 55 : 80}
        tint="dark"
        experimentalBlurMethod="dimezisBlurView"
        style={[
          styles.headerContainer,
          { borderBottomColor: colors.border },
          Platform.OS === 'android' && { backgroundColor: isDark ? '#0F172A' : '#FFFFFF' },
        ]}
      >
        {Platform.OS === 'android' && isDark && <View style={styles.androidHeaderBackdrop} />}
        
        <View style={styles.leftRow}>
          {/* Logo / Avatar (iOS only) */}
          {Platform.OS === 'ios' && (
            <View style={[styles.logoBadge, { borderColor: colors.border, backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : '#F1F5F9' }]}>
              {loading && !displayName ? (
                <HeaderSkeletonLoader width={44} height={44} style={{ borderRadius: 12 }} />
              ) : displayAvatar ? (
                <Image
                  source={{ uri: displayAvatar }}
                  style={[styles.logoImage, userRole === 'user' && { borderRadius: 22 }]}
                  resizeMode={userRole === 'user' ? "cover" : "contain"}
                />
              ) : (
                <Ionicons
                  name={userRole === 'user' ? "person-circle" : "trophy"}
                  size={30}
                  color={userRole === 'user' ? colors.accentBlue : colors.accentGreen}
                />
              )}
            </View>
          )}

          {/* Name & Greeting */}
          <View style={styles.titleCol}>
            {loading && !displayName ? (
              <View style={{ gap: 6 }}>
                <HeaderSkeletonLoader width={140} height={16} />
              </View>
            ) : (
              <>
                <Text style={[styles.orgName, { color: colors.textPrimary }]}>{displayName}</Text>
                <Text style={[styles.greetingText, { color: colors.textMuted }]}>{getGreeting()}</Text>
              </>
            )}
          </View>
        </View>

        <View style={styles.rightRow}>
          {isEditingOrder ? (
            <TouchableOpacity
              style={[styles.saveOrderBtn, { backgroundColor: colors.accentGreen }]}
              onPress={onSaveOrder}
              activeOpacity={0.7}
            >
              <Ionicons name="checkmark-outline" size={17} color="#FFFFFF" />
              <Text style={styles.saveOrderBtnText}>{"Tayyor"}</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[
                styles.iconBtn,
                {
                  backgroundColor: isDark ? 'rgba(255, 255, 255, 0.08)' : '#F1F5F9',
                  borderColor: isDark ? 'rgba(255, 255, 255, 0.15)' : '#CBD5E1',
                },
              ]}
              activeOpacity={0.75}
              onPress={() => {
                if (unreadCount > 0 && markAllNotificationsAsRead) {
                  markAllNotificationsAsRead([]);
                }
                if (onNavigate) onNavigate('notifications');
              }}
            >
              <Ionicons name="notifications-outline" size={21} color={colors.textPrimary} />
              {unreadCount > 0 && (
                <View style={styles.notifBadge}>
                  {unreadCount > 9 ? (
                    <Text style={styles.notifBadgeText}>9+</Text>
                  ) : unreadCount > 1 ? (
                    <Text style={styles.notifBadgeText}>{unreadCount}</Text>
                  ) : (
                    <View style={styles.notifDotInner} />
                  )}
                </View>
              )}
            </TouchableOpacity>
          )}
        </View>
      </BlurView>
    </>
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
    borderBottomWidth: 1,
  },
  leftRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  logoBadge: {
    width: 44,
    height: 44,
    borderRadius: 13,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  logoImage: {
    width: 34,
    height: 34,
  },
  titleCol: {
    flex: 1,
    justifyContent: 'center',
    gap: 2,
  },
  orgName: {
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: -0.3,
  },
  greetingText: {
    fontSize: 12,
    fontWeight: '600',
  },
  androidHeaderBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(8, 8, 12, 0.68)',
  },
  rightRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  iconBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    borderWidth: 1.2,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  notifBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#EF4444',
    borderWidth: 1.5,
    borderColor: '#0F172A',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 3,
  },
  notifBadgeText: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: '900',
  },
  notifDotInner: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: '#FFFFFF',
  },
  saveOrderBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: 20,
  },
  saveOrderBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
});
