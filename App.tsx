if (typeof global !== 'undefined' && (global as any).ErrorUtils) {
  const defaultHandler = (global as any).ErrorUtils.getGlobalHandler();
  (global as any).ErrorUtils.setGlobalHandler((error: any, isFatal?: boolean) => {
    console.error('=== EXPLICIT ERROR STACK TRACE ===\n', error, '\nSTACK:\n', error?.stack);
    if (defaultHandler) defaultHandler(error, isFatal);
  });
}

import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image, ActivityIndicator, DeviceEventEmitter, Alert, Animated, Platform } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Updates from 'expo-updates';

import * as Notifications from 'expo-notifications';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  } as any),
});
import { Image as ExpoImage } from 'expo-image';
import { BlurView } from 'expo-blur';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { StatusBar } from 'expo-status-bar';
import { Ionicons, MaterialCommunityIcons, MaterialIcons, Feather, FontAwesome } from '@expo/vector-icons';
import * as Font from 'expo-font';
import { QueryClientProvider } from '@tanstack/react-query';
import { appQueryClient } from './src/api/queryClient';
import { OrgProvider, useOrg } from './src/context/OrgContext';
import { Header } from './src/components/Header';
import { DashboardScreen } from './src/screens/DashboardScreen';
import { PlayersScreen } from './src/screens/PlayersScreen';
import { StandingsScreen } from './src/screens/StandingsScreen';
import { LoginScreen } from './src/screens/LoginScreen';
import { PinScreen } from './src/screens/PinScreen';
import { MatchControlScreen } from './src/screens/MatchControlScreen';
import { supabase } from './src/supabaseClient';
import { AccountScreen } from './src/screens/AccountScreen';
import { MatchesScreen } from './src/screens/MatchesScreen';
import { CreateMatchScreen } from './src/screens/CreateMatchScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { ApplicationsScreen } from './src/screens/ApplicationsScreen';
import { ExportScreen } from './src/screens/ExportScreen';
import { LeaguesScreen } from './src/screens/LeaguesScreen';
import { TransfersScreen } from './src/screens/TransfersScreen';
import { ProfileUpdatesScreen } from './src/screens/ProfileUpdatesScreen';
import { SponsorsScreen } from './src/screens/SponsorsScreen';
import { NewsScreen } from './src/screens/NewsScreen';
import { OrganizersScreen } from './src/screens/OrganizersScreen';
import { FinishedMatchesScreen } from './src/screens/FinishedMatchesScreen';
import { triggerIosCrescendoHaptic } from './src/utils/haptics';
import { hasSecurePin } from './src/utils/securePin';

const LazyScreen = ({ isActive, children }: { isActive: boolean; children: React.ReactNode }) => {
  const [hasRendered, setHasRendered] = useState(isActive);

  useEffect(() => {
    if (isActive && !hasRendered) {
      setHasRendered(true);
    }
  }, [isActive]);

  if (!hasRendered) return null;

  return (
    <View style={{ flex: 1, display: isActive ? 'flex' : 'none' }}>
      {children}
    </View>
  );
};

function MainAppContent({ onLogout }: { onLogout: () => void }) {
  const { currentOrg, userRole } = useOrg();
  const [activeTab, setActiveTab] = useState<
    'dashboard' | 'players' | 'standings' | 'account' | 'matches' | 'finished-matches' | 'create-match' | 'settings' | 'applications' | 'export' | 'leagues' | 'transfers' | 'updates' | 'sponsors' | 'news' | 'organizers'
  >('dashboard');
  const [playersSubTab, setPlayersSubTab] = useState<'players' | 'teams'>('players');

  const handleNavigate = (
    tab: 'dashboard' | 'players' | 'standings' | 'account' | 'matches' | 'finished-matches' | 'create-match' | 'settings' | 'applications' | 'export' | 'leagues' | 'transfers' | 'updates' | 'sponsors' | 'news' | 'organizers',
    subTab?: 'players' | 'teams'
  ) => {
    if (userRole === 'user' && ['export', 'applications', 'transfers', 'news', 'updates', 'sponsors', 'organizers'].includes(tab)) {
      Alert.alert('Cheklangan huquq', 'Sizda ushbu bo\'limga kirish huquqi yo\'q!');
      return;
    }
    if (subTab) {
      setPlayersSubTab(subTab);
    }
    setActiveTab(tab);
  };

  const handleAccountPress = () => {
    setActiveTab('account');
  };

  const orgColors = Array.isArray(currentOrg?.brand_colors) ? currentOrg.brand_colors : [];
  const hasGradient = orgColors.length > 0;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  // Reorder state for Dashboard menu items
  const [isEditingDashboardOrder, setIsEditingDashboardOrder] = useState(false);
  const saveDashboardOrderRef = useRef<(() => void) | null>(null);

  // Preload Ionicons font explicitly so icons never appear as question marks
  const [iconsLoaded, setIconsLoaded] = useState(false);

  useEffect(() => {
    async function loadAllIcons() {
      try {
        await Font.loadAsync(Ionicons.font);
      } catch (e) {}
      setIconsLoaded(true);
    }
    loadAllIcons();
  }, []);

  // Realtime Pending Unconfirmed Count for "Ma'lumot Almashinuvi" (Updates / Applications)
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    const fetchPendingCount = async () => {
      try {
        let query = supabase
          .from('applications')
          .select('id', { count: 'exact', head: true })
          .or('status.eq.pending,status.eq.kutilmoqda,status.is.null');

        if (currentOrg?.id) {
          query = query.eq('organization_id', currentOrg.id);
        }

        const { count } = await query;
        setPendingCount(count || 0);
      } catch (e) {
        console.error('Error fetching pending count:', e);
      }
    };

    fetchPendingCount();
    const interval = setInterval(fetchPendingCount, 10000);
    return () => clearInterval(interval);
  }, [currentOrg?.id]);

  // 🔔 Register Admin Push Token & Deep Link Listener
  useEffect(() => {
    const setupAdminPush = async () => {
      try {
        if (Platform.OS === 'web') return;
        const { status: existingStatus } = await Notifications.getPermissionsAsync();
        let finalStatus = existingStatus;
        if (existingStatus !== 'granted') {
          const { status } = await Notifications.requestPermissionsAsync();
          finalStatus = status;
        }
        if (finalStatus !== 'granted') return;

        const tokenData = await Notifications.getExpoPushTokenAsync({
          projectId: '14fddb89-af52-47b3-90ab-f437d786254b',
        });
        const token = tokenData?.data;

        if (token) {
          const orgIdVal = currentOrg?.id || 1;
          await fetch('https://web-production-eaa31.up.railway.app/api/notifications/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              token,
              userId: `admin_${orgIdVal}`,
              role: 'admin',
              organizationId: orgIdVal,
              platform: Platform.OS,
            }),
          });
          console.log('✅ Admin Push Token registered:', `admin_${orgIdVal}`);
        }
      } catch (err) {
        console.log('Admin push registration note:', err);
      }
    };

    setupAdminPush();

    // Deep linking on Notification tap
    let responseListener: any;
    try {
      if (Platform.OS !== 'web') {
        responseListener = Notifications.addNotificationResponseReceivedListener((response) => {
          const data = response?.notification?.request?.content?.data;
          console.log('👆 Admin Tapped Push:', data);
          if (!data) return;

          if (data.type === 'new_application') {
            setActiveTab('applications');
          } else if (data.type === 'profile_update') {
            setActiveTab('updates');
          } else if (data.type === 'new_transfer') {
            setActiveTab('transfers');
          }
        });
      }
    } catch (e) {}

    return () => {
      if (responseListener) responseListener.remove();
    };
  }, [currentOrg?.id]);

  useEffect(() => {
    if (hasGradient) {
      triggerIosCrescendoHaptic();
      fadeAnim.setValue(0);
      Animated.timing(fadeAnim, {
        toValue: 0.85,
        duration: 1200,
        useNativeDriver: true,
      }).start();
    }
  }, [JSON.stringify(orgColors)]);

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      {/* Organization Gradient Background with smooth animated fade-in */}
      {hasGradient && (
        <Animated.View style={[StyleSheet.absoluteFillObject, { opacity: fadeAnim }]}>
          <LinearGradient
            colors={(orgColors.length > 1 ? orgColors : [orgColors[0] || '#0F172A', orgColors[0] || '#0F172A']) as any}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFillObject}
          />
        </Animated.View>
      )}

      <Header
        isEditingOrder={activeTab === 'dashboard' && isEditingDashboardOrder}
        onSaveOrder={() => {
          if (saveDashboardOrderRef.current) {
            saveDashboardOrderRef.current();
          }
        }}
        onNavigate={handleNavigate}
      />

      <View style={styles.screenContainer}>
        <LazyScreen isActive={activeTab === 'dashboard'}>
          <DashboardScreen
            onNavigate={handleNavigate}
            isEditingOrder={isEditingDashboardOrder}
            setIsEditingOrder={setIsEditingDashboardOrder}
            onRegisterSaveOrder={(fn) => {
              saveDashboardOrderRef.current = fn;
            }}
          />
        </LazyScreen>
        <LazyScreen isActive={activeTab === 'export'}><ExportScreen /></LazyScreen>
        <LazyScreen isActive={activeTab === 'applications'}><ApplicationsScreen initialTab={playersSubTab} /></LazyScreen>
        <LazyScreen isActive={activeTab === 'players'}><PlayersScreen initialSegmentTab={playersSubTab} /></LazyScreen>
        <LazyScreen isActive={activeTab === 'transfers'}><TransfersScreen /></LazyScreen>
        <LazyScreen isActive={activeTab === 'updates'}><ProfileUpdatesScreen /></LazyScreen>
        <LazyScreen isActive={activeTab === 'sponsors'}><SponsorsScreen /></LazyScreen>
        <LazyScreen isActive={activeTab === 'news'}><NewsScreen /></LazyScreen>
        <LazyScreen isActive={activeTab === 'standings'}><StandingsScreen /></LazyScreen>
        <LazyScreen isActive={activeTab === 'account'}><AccountScreen onNavigateToSettings={() => setActiveTab('settings')} onNavigateToOrganizers={() => setActiveTab('organizers')} onLogout={onLogout} /></LazyScreen>
        <LazyScreen isActive={activeTab === 'organizers'}><OrganizersScreen onGoBack={() => setActiveTab('account')} /></LazyScreen>
        <LazyScreen isActive={activeTab === 'matches'}><MatchesScreen onNavigateToCreate={() => setActiveTab('create-match')} /></LazyScreen>
        <LazyScreen isActive={activeTab === 'finished-matches'}><FinishedMatchesScreen onGoBack={() => setActiveTab('dashboard')} onNavigateToCreate={() => setActiveTab('create-match')} /></LazyScreen>
        <LazyScreen isActive={activeTab === 'create-match'}><CreateMatchScreen onSuccess={() => setActiveTab('matches')} /></LazyScreen>
        <LazyScreen isActive={activeTab === 'settings'}><SettingsScreen onGoBack={() => setActiveTab('account')} /></LazyScreen>
        <LazyScreen isActive={activeTab === 'leagues'}><LeaguesScreen /></LazyScreen>
      </View>

      {/* Tactile Dark Navigation Dock */}
      <View style={styles.navDockWrapper}>
        <View style={styles.navDock}>
          {Platform.OS === 'android' && <View style={styles.androidNavBackdrop} />}
          <BlurView
            intensity={Platform.OS === 'ios' ? 60 : 85}
            tint="dark"
            experimentalBlurMethod="dimezisBlurView"
            style={StyleSheet.absoluteFill}
          />
          
          {/* Segment 1: Dashboard (Home Outline) */}
          <TouchableOpacity
            style={styles.segmentItem}
            onPress={() => setActiveTab('dashboard')}
            activeOpacity={0.7}
          >
            <Ionicons
              name="home-outline"
              size={22}
              color={activeTab === 'dashboard' ? '#FFFFFF' : 'rgba(255, 255, 255, 0.35)'}
              style={activeTab === 'dashboard' && styles.glowingIcon}
            />
            <View style={[styles.activeDot, activeTab === 'dashboard' && styles.activeDotGlow]} />
          </TouchableOpacity>

          <View style={styles.segmentDivider} />

          {/* Segment 2: O'yinchilar & Jamoalar (Grid Outline) */}
          <TouchableOpacity
            style={styles.segmentItem}
            onPress={() => {
              setPlayersSubTab('players');
              setActiveTab('players');
            }}
            activeOpacity={0.7}
          >
            <Ionicons
              name="grid-outline"
              size={22}
              color={activeTab === 'players' ? '#FFFFFF' : 'rgba(255, 255, 255, 0.35)'}
              style={activeTab === 'players' && styles.glowingIcon}
            />
            <View style={[styles.activeDot, activeTab === 'players' && styles.activeDotGlow]} />
          </TouchableOpacity>

          <View style={styles.segmentDivider} />

          {/* Segment 3: CENTER '+' QUICK ADD MATCH BUTTON */}
          <TouchableOpacity
            style={styles.segmentItem}
            onPress={() => setActiveTab('create-match')}
            activeOpacity={0.7}
          >
            <Ionicons
              name="add-outline"
              size={28}
              color={activeTab === 'create-match' ? '#FFFFFF' : 'rgba(255, 255, 255, 0.4)'}
              style={activeTab === 'create-match' && styles.glowingIcon}
            />
            <View style={[styles.activeDot, activeTab === 'create-match' && styles.activeDotGlow]} />
          </TouchableOpacity>

          <View style={styles.segmentDivider} />

          {/* Segment 5: Turnir Jadvali (Stats / Standings Outline) */}
          <TouchableOpacity
            style={styles.segmentItem}
            onPress={() => setActiveTab('standings')}
            activeOpacity={0.7}
          >
            <Ionicons
              name="stats-chart-outline"
              size={22}
              color={activeTab === 'standings' ? '#FFFFFF' : 'rgba(255, 255, 255, 0.35)'}
              style={activeTab === 'standings' && styles.glowingIcon}
            />
            <View style={[styles.activeDot, activeTab === 'standings' && styles.activeDotGlow]} />
          </TouchableOpacity>

          <View style={styles.segmentDivider} />

          {/* Segment 6: Admin Akkount / Profil */}
          <TouchableOpacity
            style={styles.segmentItem}
            onPress={handleAccountPress}
            activeOpacity={0.7}
          >
            {userRole !== 'user' && currentOrg?.logo_url ? (
              <Image
                source={{ uri: currentOrg.logo_url }}
                style={[
                  styles.navOrgAvatar,
                  activeTab === 'account' && styles.activeNavOrgAvatar,
                ]}
              />
            ) : (
              <Ionicons
                name="person-outline"
                size={22}
                color={activeTab === 'account' ? '#FFFFFF' : 'rgba(255, 255, 255, 0.35)'}
                style={activeTab === 'account' && styles.glowingIcon}
              />
            )}
            <View style={[styles.activeDot, activeTab === 'account' && styles.activeDotGlow]} />
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const [fontsLoaded, setFontsLoaded] = useState(false);
  const [pinState, setPinState] = useState<'checking' | 'locked' | 'not_set' | 'unlocked' | 'editing'>('checking');

  useEffect(() => {
    async function loadFonts() {
      try {
        await Font.loadAsync({
          ...Ionicons.font,
          ...MaterialCommunityIcons.font,
          ...MaterialIcons.font,
          ...Feather.font,
          ...FontAwesome.font,
        });
      } catch (e) {
        console.warn('Vector icons font loading error:', e);
      } finally {
        setFontsLoaded(true);
      }
    }
    loadFonts();
  }, []);

  useEffect(() => {
    async function onFetchUpdateAsync() {
      try {
        const update = await Updates.checkForUpdateAsync();
        if (update.isAvailable) {
          await Updates.fetchUpdateAsync();
          Alert.alert(
            "Yangi Yangilanish 🚀",
            "Ilovaning yangi versiyasi yuklab olindi. O'zgarishlarni ko'rish uchun ilova qayta ishga tushadi.",
            [{ text: "OK", onPress: async () => await Updates.reloadAsync() }],
            { cancelable: false }
          );
        }
      } catch (error) {
        console.log("Yangilanishni tekshirishda xatolik:", error);
      }
    }
    
    if (!__DEV__) {
      onFetchUpdateAsync();
    }
  }, []);

  useEffect(() => {
    // Check active session
    supabase.auth.getSession().then(({ data: { session } }) => {
      const loggedIn = !!session;
      setIsLoggedIn(loggedIn);
      if (loggedIn) {
        checkPinStatus(false);
      } else {
        setAuthLoading(false);
      }
    });

    // Listen for auth changes (logout)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT' || !session) {
        setIsLoggedIn(false);
        setPinState('checking');
      }
    });

    const resetListener = DeviceEventEmitter.addListener('app_pin_reset', () => {
      checkPinStatus(false);
    });

    const editListener = DeviceEventEmitter.addListener('app_pin_edit', () => {
      setPinState('editing');
    });

    return () => {
      subscription.unsubscribe();
      resetListener.remove();
      editListener.remove();
    };
  }, []);

  const checkPinStatus = async (isFreshLogin: boolean = false) => {
    try {
      const isPinSet = await hasSecurePin();
      if (isPinSet) {
        setPinState('locked');
      } else {
        const skipped = await AsyncStorage.getItem('@amatora_pin_skipped');
        if (skipped === 'true') {
          setPinState('unlocked');
        } else if (isFreshLogin) {
          setPinState('not_set');
        } else {
          setPinState('unlocked');
        }
      }
    } catch (e) {
      setPinState('unlocked');
    } finally {
      setAuthLoading(false);
    }
  };

  return (
    <QueryClientProvider client={appQueryClient}>
      <View style={styles.container}>
        <StatusBar style="light" />
        {/* App-wide background image for all screens including Login/Pin */}
        <Image
          source={require('./assets/bg-img.png')}
          style={styles.bgImage}
          resizeMode="cover"
        />

        {authLoading || !fontsLoaded ? (
          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
            <ActivityIndicator size="large" color="#00FF66" />
          </View>
        ) : !isLoggedIn ? (
          <LoginScreen onLoginSuccess={() => {
            setIsLoggedIn(true);
            checkPinStatus(true);
          }} />
        ) : pinState === 'locked' || pinState === 'not_set' || pinState === 'editing' ? (
          <PinScreen
            action={pinState === 'editing' ? 'edit' : 'login'}
            onSuccess={() => {
              setPinState('unlocked');
              DeviceEventEmitter.emit('app_pin_changed');
            }}
            onReset={() => {
              setIsLoggedIn(false);
              setPinState('checking');
              supabase.auth.signOut().catch(() => {});
            }}
          />
        ) : (
          <OrgProvider>
            <MainAppContent onLogout={() => {
              setIsLoggedIn(false);
              setPinState('checking');
              supabase.auth.signOut().catch(() => {});
            }} />
          </OrgProvider>
        )}
      </View>
    </QueryClientProvider>
  );
}

export default App;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  bgImage: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    width: '130%', // By making it wider than screen and left: 0, cover will shift the center right, moving the left part of the image into view
    height: '100%',
  },
  screenContainer: {
    flex: 1,
  },
  navDockWrapper: {
    position: 'absolute',
    bottom: 24,
    left: 16,
    right: 16,
    alignItems: 'center',
  },
  androidNavBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(8, 8, 14, 0.72)',
  },
  navDock: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    height: 66,
    backgroundColor: Platform.OS === 'android' ? 'rgba(8, 8, 14, 0.70)' : 'transparent',
    borderRadius: 22,
    borderWidth: 1.2,
    borderColor: 'rgba(255, 255, 255, 0.16)',
    paddingHorizontal: 4,
    paddingVertical: 4,
    overflow: 'hidden',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.6,
    shadowRadius: 18,
    elevation: 18,
  },
  segmentItem: {
    flex: 1,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    position: 'relative',
  },
  segmentDivider: {
    width: 1,
    height: '55%',
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
  },
  navOrgAvatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.3)',
  },
  activeNavOrgAvatar: {
    borderColor: '#FFFFFF',
    borderWidth: 1.5,
    shadowColor: '#FFFFFF',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 5,
  },
  glowingIcon: {
    shadowColor: '#FFFFFF',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 6,
  },
  activeDot: {
    width: 10,
    height: 3.5,
    borderRadius: 2,
    backgroundColor: 'transparent',
    marginTop: 4,
  },
  activeDotGlow: {
    backgroundColor: '#FF3B30',
    shadowColor: '#FF3B30',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 5,
  },
  badgeCircle: {
    position: 'absolute',
    top: -6,
    right: -10,
    backgroundColor: '#FF3B30',
    minWidth: 17,
    height: 17,
    borderRadius: 8.5,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 3,
    borderWidth: 1.5,
    borderColor: '#0F172A',
    zIndex: 10,
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 9.5,
    fontWeight: '900',
  },
});
