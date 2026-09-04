if (typeof global !== 'undefined' && (global as any).ErrorUtils) {
  const defaultHandler = (global as any).ErrorUtils.getGlobalHandler();
  (global as any).ErrorUtils.setGlobalHandler((error: any, isFatal?: boolean) => {
    console.error('=== EXPLICIT ERROR STACK TRACE ===\n', error, '\nSTACK:\n', error?.stack);
    if (defaultHandler) defaultHandler(error, isFatal);
  });
}

import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image, ActivityIndicator, DeviceEventEmitter, Alert, Animated, Platform, BackHandler, ToastAndroid } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Updates from 'expo-updates';
import Constants, { ExecutionEnvironment } from 'expo-constants';

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
import AsyncStorage from '@react-native-async-storage/async-storage';
import { StatusBar } from 'expo-status-bar';
import { Ionicons, MaterialCommunityIcons, MaterialIcons, Feather, FontAwesome } from '@expo/vector-icons';
import * as Font from 'expo-font';
import { QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { appQueryClient } from './src/api/queryClient';
import { OrgProvider, useOrg } from './src/context/OrgContext';
import { ThemeProvider, useTheme } from './src/context/ThemeContext';
import { Header } from './src/components/Header';
import { DashboardScreen } from './src/screens/DashboardScreen';
import { PlayersScreen } from './src/screens/PlayersScreen';
import { StandingsScreen } from './src/screens/StandingsScreen';
import { LoginScreen } from './src/screens/LoginScreen';
import { WelcomeScreen } from './src/screens/WelcomeScreen';
import { SplashScreen } from './src/screens/SplashScreen';
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
import { NotificationsScreen } from './src/screens/NotificationsScreen';
import { CardsScreen } from './src/screens/CardsScreen';
import { TournamentsScreen } from './src/screens/TournamentsScreen';
import { triggerIosCrescendoHaptic } from './src/utils/haptics';
import { hasSecurePin } from './src/utils/securePin';
import { SafeBlurView as BlurView } from './src/components/SafeBlurView';

const LazyScreen = ({ isActive, children }: { isActive: boolean; children: React.ReactNode }) => {
  if (Platform.OS === 'android') {
    if (!isActive) return null;
    return <View style={{ flex: 1 }}>{children}</View>;
  }

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
  const { isDark, colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState<
    'dashboard' | 'players' | 'standings' | 'account' | 'matches' | 'finished-matches' | 'create-match' | 'settings' | 'applications' | 'export' | 'leagues' | 'tournaments' | 'transfers' | 'updates' | 'sponsors' | 'news' | 'organizers' | 'notifications' | 'cards'
  >('dashboard');
  const [playersSubTab, setPlayersSubTab] = useState<'players' | 'teams'>('players');
  const [navigationHistory, setNavigationHistory] = useState<string[]>(['dashboard']);
  const lastBackPressRef = useRef<number>(0);

  const handleNavigate = (
    tab: 'dashboard' | 'players' | 'standings' | 'account' | 'matches' | 'finished-matches' | 'create-match' | 'settings' | 'applications' | 'export' | 'leagues' | 'tournaments' | 'transfers' | 'updates' | 'sponsors' | 'news' | 'organizers' | 'notifications' | 'cards',
    subTab?: 'players' | 'teams'
  ) => {
    if (userRole === 'user' && ['export', 'applications', 'transfers', 'news', 'updates', 'sponsors', 'organizers', 'cards'].includes(tab)) {
      Alert.alert('Cheklangan huquq', 'Sizda ushbu bo\'limga kirish huquqi yo\'q!');
      return;
    }
    if (subTab) {
      setPlayersSubTab(subTab);
    }
    if (tab !== activeTab) {
      setNavigationHistory(prev => [...prev, tab]);
    }
    setActiveTab(tab);
  };

  const handleGoBack = () => {
    setNavigationHistory(prev => {
      if (prev.length > 1) {
        const nextHistory = prev.slice(0, -1);
        const prevTab = nextHistory[nextHistory.length - 1];
        setActiveTab(prevTab as any);
        return nextHistory;
      } else {
        setActiveTab('dashboard');
        return ['dashboard'];
      }
    });
  };

  const handleAccountPress = () => {
    handleNavigate('account');
  };

  // Hardware Android Back Button Handler (Back in screen history, or double-tap to exit on Dashboard)
  useEffect(() => {
    if (Platform.OS !== 'android') return;

    const backAction = () => {
      // 1. If not on dashboard, step back in navigation history
      if (activeTab !== 'dashboard') {
        handleGoBack();
        return true;
      }

      // 2. If on dashboard, prevent accidental exit with double-tap
      const now = Date.now();
      if (lastBackPressRef.current && now - lastBackPressRef.current < 2000) {
        BackHandler.exitApp();
        return true;
      }
      lastBackPressRef.current = now;
      if (ToastAndroid) {
        ToastAndroid.show("Ilovadan chiqish uchun yana bir marta bosing", ToastAndroid.SHORT);
      }
      return true;
    };

    const backHandler = BackHandler.addEventListener('hardwareBackPress', backAction);
    return () => backHandler.remove();
  }, [activeTab]);

  const orgColors = Array.isArray(currentOrg?.brand_colors) ? currentOrg.brand_colors : [];
  const hasGradient = orgColors.length > 0;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  // Reorder state for Dashboard menu items
  const [isEditingDashboardOrder, setIsEditingDashboardOrder] = useState(false);
  const saveDashboardOrderRef = useRef<(() => void) | null>(null);

  // iOS Floating Navbar Shrink/Expand on Scroll Animation
  const navDockAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (Platform.OS !== 'ios') return;

    const sub = DeviceEventEmitter.addListener('nav_dock_scroll', (direction: 'up' | 'down') => {
      Animated.spring(navDockAnim, {
        toValue: direction === 'down' ? 0 : 1,
        useNativeDriver: true,
        bounciness: direction === 'down' ? 0 : 3,
        speed: 18,
      }).start();
    });

    return () => {
      sub.remove();
    };
  }, []);

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

    // 🔥 PERFORMANCE FIX: Realtime subscription o'rniga polling
    // Before: 100 admin × 10s = 10 query/s = 864,000 query/day (database never rests!)
    // After: 100 admin × on INSERT event = faqat yangi ariza kelganda query

    fetchPendingCount(); // Initial load

    const channel = supabase.channel('admin_pending_count')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'applications',
        filter: `organization_id=eq.${currentOrg?.id}`
      }, () => {
        fetchPendingCount(); // Faqat yangi ariza kelganda
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentOrg?.id]);

  // 🔔 Register Admin Push Token & Deep Link Listener
  useEffect(() => {
    const setupAdminPush = async () => {
      try {
        if (Platform.OS === 'web') return;

        // In Expo SDK 53+, remote push token is unsupported inside Expo Go on Android
        const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
        if (isExpoGo && Platform.OS === 'android') {
          // Expo Go on Android: Local and in-app notifications still fully functional
          return;
        }

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
        // Silent catch to prevent red box in development
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
    <View style={[styles.container, Platform.OS === 'android' && { backgroundColor: colors.bgPrimary }]}>
      <StatusBar style={Platform.OS === 'android' ? (isDark ? 'light' : 'dark') : 'light'} />

      {/* Organization Gradient Background on iOS only (Android uses clean solid dark theme for high performance) */}
      {hasGradient && Platform.OS === 'ios' && (
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
        <LazyScreen isActive={activeTab === 'cards'}><CardsScreen onGoBack={handleGoBack} /></LazyScreen>
        <LazyScreen isActive={activeTab === 'account'}><AccountScreen onNavigateToSettings={() => handleNavigate('settings')} onNavigateToOrganizers={() => handleNavigate('organizers')} onLogout={onLogout} /></LazyScreen>
        <LazyScreen isActive={activeTab === 'organizers'}><OrganizersScreen onGoBack={handleGoBack} /></LazyScreen>
        <LazyScreen isActive={activeTab === 'matches'}><MatchesScreen onNavigateToCreate={() => handleNavigate('create-match')} /></LazyScreen>
        <LazyScreen isActive={activeTab === 'finished-matches'}><FinishedMatchesScreen onGoBack={handleGoBack} onNavigateToCreate={() => handleNavigate('create-match')} /></LazyScreen>
        <LazyScreen isActive={activeTab === 'create-match'}><CreateMatchScreen onSuccess={() => handleNavigate('matches')} /></LazyScreen>
        <LazyScreen isActive={activeTab === 'settings'}><SettingsScreen onGoBack={handleGoBack} /></LazyScreen>
        <LazyScreen isActive={activeTab === 'leagues'}><LeaguesScreen /></LazyScreen>
        <LazyScreen isActive={activeTab === 'tournaments'}><TournamentsScreen onGoBack={handleGoBack} /></LazyScreen>
        <LazyScreen isActive={activeTab === 'notifications'}><NotificationsScreen onNavigate={handleNavigate} onGoBack={handleGoBack} /></LazyScreen>
      </View>

      {/* Tactile Navigation Dock */}
      <Animated.View
        style={[
          styles.navDockWrapper,
          Platform.OS === 'ios' && {
            transform: [
              {
                translateY: navDockAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [18, 0],
                }),
              },
              {
                scale: navDockAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0.86, 1],
                }),
              },
            ],
            opacity: navDockAnim.interpolate({
              inputRange: [0, 1],
              outputRange: [0.75, 1],
            }),
          },
          Platform.OS === 'android' && {
            // Android'da tizim navigatsiya paneli (gesture bar / 3 tugma) ostiga
            // kirib qolmasligi uchun pastki safe-area masofasi qo'shildi.
            bottom: insets.bottom,
            left: 0,
            right: 0,
            width: '100%',
            marginBottom: 0,
            paddingBottom: 0,
          },
        ]}
      >
        <View
          style={[
            styles.navDock,
            Platform.OS === 'android' && {
              backgroundColor: colors.bgCard,
              borderColor: 'transparent',
              borderTopColor: colors.border,
              borderTopWidth: 1,
              borderWidth: 0,
              borderRadius: 0,
              borderTopLeftRadius: 0,
              borderTopRightRadius: 0,
              borderBottomLeftRadius: 0,
              borderBottomRightRadius: 0,
              marginBottom: 0,
              paddingBottom: 6,
              bottom: 0,
              elevation: 0,
            },
          ]}
        >
          {Platform.OS === 'ios' && (
            <BlurView
              intensity={60}
              tint="dark"
              style={StyleSheet.absoluteFill}
              pointerEvents="none"
            />
          )}
          
          {/* Segment 1: Dashboard (Home Outline) */}
          <TouchableOpacity
            style={styles.segmentItem}
            onPress={() => setActiveTab('dashboard')}
            activeOpacity={0.7}
          >
            <Ionicons
              name="home-outline"
              size={22}
              color={activeTab === 'dashboard' ? (isDark ? '#FFFFFF' : colors.textPrimary) : colors.textMuted}
              style={activeTab === 'dashboard' && isDark && styles.glowingIcon}
            />
            <View style={[styles.activeDot, activeTab === 'dashboard' && { backgroundColor: colors.navDockActiveDot, shadowColor: colors.navDockActiveDot }]} />
          </TouchableOpacity>

          <View style={[styles.segmentDivider, { backgroundColor: colors.border }]} />

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
              color={activeTab === 'players' ? (isDark ? '#FFFFFF' : colors.textPrimary) : colors.textMuted}
              style={activeTab === 'players' && isDark && styles.glowingIcon}
            />
            <View style={[styles.activeDot, activeTab === 'players' && { backgroundColor: colors.navDockActiveDot, shadowColor: colors.navDockActiveDot }]} />
          </TouchableOpacity>

          <View style={[styles.segmentDivider, { backgroundColor: colors.border }]} />

          {/* Segment 3: CENTER '+' QUICK ADD MATCH BUTTON */}
          <TouchableOpacity
            style={styles.segmentItem}
            onPress={() => setActiveTab('create-match')}
            activeOpacity={0.7}
          >
            <Ionicons
              name="add-outline"
              size={28}
              color={activeTab === 'create-match' ? (isDark ? '#FFFFFF' : colors.textPrimary) : colors.textMuted}
              style={activeTab === 'create-match' && isDark && styles.glowingIcon}
            />
            <View style={[styles.activeDot, activeTab === 'create-match' && { backgroundColor: colors.navDockActiveDot, shadowColor: colors.navDockActiveDot }]} />
          </TouchableOpacity>

          <View style={[styles.segmentDivider, { backgroundColor: colors.border }]} />

          {/* Segment 5: Turnir Jadvali (Stats / Standings Outline) */}
          <TouchableOpacity
            style={styles.segmentItem}
            onPress={() => setActiveTab('standings')}
            activeOpacity={0.7}
          >
            <Ionicons
              name="stats-chart-outline"
              size={22}
              color={activeTab === 'standings' ? (isDark ? '#FFFFFF' : colors.textPrimary) : colors.textMuted}
              style={activeTab === 'standings' && isDark && styles.glowingIcon}
            />
            <View style={[styles.activeDot, activeTab === 'standings' && { backgroundColor: colors.navDockActiveDot, shadowColor: colors.navDockActiveDot }]} />
          </TouchableOpacity>

          <View style={[styles.segmentDivider, { backgroundColor: colors.border }]} />

          {/* Segment 6: Admin Akkount / Profil */}
          <TouchableOpacity
            style={styles.segmentItem}
            onPress={handleAccountPress}
            activeOpacity={0.7}
          >
            {Platform.OS === 'ios' && userRole !== 'user' && currentOrg?.logo_url ? (
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
                color={activeTab === 'account' ? (isDark ? '#FFFFFF' : colors.textPrimary) : colors.textMuted}
                style={activeTab === 'account' && isDark && styles.glowingIcon}
              />
            )}
            <View style={[styles.activeDot, activeTab === 'account' && { backgroundColor: colors.navDockActiveDot, shadowColor: colors.navDockActiveDot }]} />
          </TouchableOpacity>
        </View>
      </Animated.View>
    </View>
  );
}

function AppContent() {
  const { isDark } = useTheme();
  const [showSplash, setShowSplash] = useState(true);
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

  const handleLogoutApp = async () => {
    setIsLoggedIn(false);
    setPinState('checking');
    try {
      await supabase.auth.signOut();
      await AsyncStorage.multiRemove([
        '@amatora_user_role',
        '@amatora_org_id',
        '@amatora_user_email',
        '@amatora_app_pin',
        '@amatora_pin_skipped',
      ]);
    } catch (e) {}
  };

  if (showSplash) {
    return <SplashScreen onFinish={() => setShowSplash(false)} />;
  }

  return (
    <View style={[styles.container, Platform.OS === 'android' && { backgroundColor: isDark ? '#0B0F17' : '#F8FAFC' }, !isLoggedIn && { backgroundColor: '#FFFFFF' }]}>
      <StatusBar style={!isLoggedIn ? 'dark' : (Platform.OS === 'android' ? (isDark ? 'light' : 'dark') : 'light')} />
      {/* App-wide background image for all screens when logged in on iOS */}
      {isLoggedIn && Platform.OS === 'ios' && (
        <Image
          source={require('./assets/bg-img.png')}
          style={styles.bgImage}
          resizeMode="cover"
        />
      )}

      {authLoading || !fontsLoaded ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#FFFFFF' }}>
          <ActivityIndicator size="large" color="#0F172A" />
        </View>
      ) : !isLoggedIn ? (
        <WelcomeScreen onLoginSuccess={() => {
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
          onReset={handleLogoutApp}
        />
      ) : (
        <OrgProvider>
          <MainAppContent onLogout={handleLogoutApp} />
        </OrgProvider>
      )}
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={appQueryClient}>
        <ThemeProvider>
          <AppContent />
        </ThemeProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

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
    bottom: Platform.OS === 'android' ? 0 : 24,
    left: Platform.OS === 'android' ? 0 : 16,
    right: Platform.OS === 'android' ? 0 : 16,
    width: Platform.OS === 'android' ? '100%' : undefined,
    alignItems: Platform.OS === 'android' ? 'stretch' : 'center',
    margin: 0,
    padding: 0,
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
    height: Platform.OS === 'android' ? 62 : 66,
    backgroundColor: Platform.OS === 'android' ? '#0F172A' : 'transparent',
    borderRadius: Platform.OS === 'android' ? 0 : 24,
    borderWidth: Platform.OS === 'android' ? 0 : 1,
    borderTopWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.14)',
    paddingHorizontal: 0,
    paddingVertical: 0,
    paddingBottom: Platform.OS === 'android' ? 6 : 0,
    margin: 0,
    marginBottom: 0,
    overflow: 'hidden',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: Platform.OS === 'android' ? 0 : 0.5,
    shadowRadius: 18,
    elevation: Platform.OS === 'android' ? 0 : 18,
  },
  segmentItem: {
    flex: 1,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    position: 'relative',
    paddingBottom: Platform.OS === 'android' ? 4 : 0,
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
  },
  glowingIcon: {
    opacity: 1,
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
