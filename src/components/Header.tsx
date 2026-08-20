import React, { useRef, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image, Animated } from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { useOrg } from '../context/OrgContext';
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
}> = ({ isEditingOrder = false, onSaveOrder }) => {
  const { currentOrg, loading, userRole } = useOrg();
  const [userName, setUserName] = React.useState<string | null>(null);
  const [userAvatar, setUserAvatar] = React.useState<string | null>(null);

  React.useEffect(() => {
    const fetchUserHeader = async () => {
      if (userRole === 'user') {
        try {
          const dbClient = supabase;
          const { data: sessionData } = await supabase.auth.getSession();
          const email = sessionData?.session?.user?.email;
          if (email) {
            const { data: uRec } = await dbClient
              .from('organization_users')
              .select('full_name, avatar_url')
              .ilike('email', email)
              .maybeSingle();

            if (uRec) {
              setUserName(uRec.full_name || 'Organizator');
              setUserAvatar(uRec.avatar_url || null);
            }
          }
        } catch (e) {
          console.error('Header fetch user error:', e);
        }
      }
    };

    fetchUserHeader();
  }, [userRole]);

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Xayrli tong';
    if (hour < 18) return 'Xayrli kun';
    return 'Xayrli kech';
  };

  const displayName = userRole === 'user' ? (userName || 'Organizator') : currentOrg?.name;
  const displayAvatar = userRole === 'user' ? userAvatar : currentOrg?.logo_url;

  return (
    <BlurView intensity={50} tint="dark" style={styles.headerContainer}>
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
          <TouchableOpacity style={{ position: 'relative', padding: 4 }}>
            <Ionicons name="notifications-outline" size={24} color="#FFFFFF" />
            <View style={styles.notifBadge} />
          </TouchableOpacity>
        )}
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
