import React, { useRef, useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image, Animated, Platform } from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { useOrg } from '../context/OrgContext';
import { supabase } from '../supabaseClient';
import { NotificationsModal } from './NotificationsModal';

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
  const { currentOrg, currentUser, loading, userRole, orgId } = useOrg();
  const [showNotifModal, setShowNotifModal] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  // Realtime unread count fetch from pending applications & teams
  useEffect(() => {
    const fetchCount = async () => {
      try {
        const targetOrgId = currentOrg?.id || orgId || 1;
        let query = supabase
          .from('applications')
          .select('id', { count: 'exact', head: true })
          .or('status.eq.pending,status.eq.kutilmoqda,status.eq.yangi,status.is.null');

        if (targetOrgId) {
          query = query.or(`organization_id.eq.${targetOrgId},organization_id.is.null`);
        }

        const { count: appCount } = await query;

        let tQuery = supabase
          .from('teams')
          .select('id', { count: 'exact', head: true })
          .in('status', ['pending', 'kutilmoqda']);

        if (targetOrgId) {
          tQuery = tQuery.or(`organization_id.eq.${targetOrgId},organization_id.is.null`);
        }

        const { count: teamCount } = await tQuery;
        setUnreadCount((appCount || 0) + (teamCount || 0));
      } catch (e) {}
    };

    fetchCount();

    const channel = supabase
      .channel(`header_notif_sub_${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'applications' }, () => {
        fetchCount();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'teams' }, () => {
        fetchCount();
      })
      .subscribe();

    return () => {
      try {
        supabase.removeChannel(channel);
      } catch (e) {}
    };
  }, [currentOrg?.id, orgId]);

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Xayrli tong';
    if (hour < 18) return 'Xayrli kun';
    return 'Xayrli kech';
  };

  const displayName = userRole === 'user' ? (currentUser?.full_name || 'Organizator') : currentOrg?.name;
  const displayAvatar = userRole === 'user' ? currentUser?.avatar_url : currentOrg?.logo_url;

  return (
    <>
      <BlurView
        intensity={Platform.OS === 'ios' ? 55 : 80}
        tint="dark"
        experimentalBlurMethod="dimezisBlurView"
        style={styles.headerContainer}
      >
        {Platform.OS === 'android' && <View style={styles.androidHeaderBackdrop} />}
        
        <View style={styles.leftRow}>
          {/* Logo / Avatar */}
          <View style={styles.logoBadge}>
            {loading && !displayName ? (
              <HeaderSkeletonLoader width={44} height={44} style={{ borderRadius: 12 }} />
            ) : displayAvatar ? (
              <Image
                source={{ uri: displayAvatar }}
                style={[styles.logoImage, userRole === 'user' && { borderRadius: 22 }]}
                resizeMode={userRole === 'user' ? "cover" : "contain"}
              />
            ) : (
              <Ionicons name={userRole === 'user' ? "person-circle" : "trophy"} size={32} color={userRole === 'user' ? "#38BDF8" : "#00FF66"} />
            )}
          </View>

          {/* Name & Greeting */}
          <View style={styles.titleCol}>
            {loading && !displayName ? (
              <View style={{ gap: 6 }}>
                <HeaderSkeletonLoader width={140} height={16} />
              </View>
            ) : (
              <>
                <Text style={styles.orgName}>{displayName}</Text>
                <Text style={styles.greetingText}>{getGreeting()}</Text>
              </>
            )}
          </View>
        </View>

        <View style={styles.rightRow}>
          {isEditingOrder ? (
            <TouchableOpacity
              style={styles.saveOrderBtn}
              onPress={onSaveOrder}
              activeOpacity={0.7}
            >
              <Ionicons name="checkmark-outline" size={17} color="#FFFFFF" />
              <Text style={styles.saveOrderBtnText}>{"Tayyor"}</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={styles.bellBtn}
              activeOpacity={0.75}
              onPress={() => setShowNotifModal(true)}
            >
              <Ionicons name="notifications-outline" size={22} color="#FFFFFF" />
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

      {/* Live System Notifications Modal */}
      <NotificationsModal
        visible={showNotifModal}
        onClose={() => setShowNotifModal(false)}
        onNavigate={onNavigate}
        onUnreadCountChange={(cnt) => setUnreadCount(cnt)}
      />
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
  androidHeaderBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(8, 8, 12, 0.68)',
  },
  rightRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  bellBtn: {
    width: 40,
    height: 40,
    borderRadius: 13,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1.2,
    borderColor: 'rgba(255, 255, 255, 0.15)',
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
    backgroundColor: 'rgba(255, 255, 255, 0.16)',
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.25)',
  },
  saveOrderBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
});
