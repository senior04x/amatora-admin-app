import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, Animated, RefreshControl, Platform, PanResponder, Easing, LayoutAnimation, UIManager, useWindowDimensions } from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useOrg } from '../context/OrgContext';
import { supabase } from '../supabaseClient';
import { Image } from 'react-native';
import { MatchControlScreen } from './MatchControlScreen';
import { triggerHapticMedium, triggerHapticSuccess } from '../utils/haptics';
import { useDashboardCountsData, useMatchesData } from '../api/hooks';
import { useQueryClient } from '@tanstack/react-query';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

interface Props {
  onNavigate: (
    tab: 'dashboard' | 'players' | 'matches' | 'finished-matches' | 'transfers' | 'settings' | 'leagues' | 'create-match' | 'export' | 'applications' | 'standings' | 'account' | 'updates' | 'sponsors' | 'news',
    subTab?: 'players' | 'teams'
  ) => void;
  isEditingOrder?: boolean;
  setIsEditingOrder?: (val: boolean) => void;
  onRegisterSaveOrder?: (saveFn: () => void) => void;
}

export const getSlotPosition = (index: number, cardWidth: number, cardHeight: number, gridGap: number = 10) => {
  const col = index % 3;
  const row = Math.floor(index / 3);
  return {
    x: col * (cardWidth + gridGap),
    y: row * (cardHeight + gridGap),
  };
};

interface DraggableCardProps {
  item: any;
  index: number;
  totalCount: number;
  cardWidth: number;
  cardHeight: number;
  gridGap: number;
  isEditingOrder: boolean;
  activeDragId: string | null;
  wiggleAnim: Animated.Value;
  onEnableEditMode: (id: string, startPos?: { x: number; y: number }) => void;
  onStartDrag: (id: string, startPos?: { x: number; y: number }) => void;
  onDragMove: (id: string, dx: number, dy: number) => void;
  onEndDrag: (id?: string) => void;
  onPressItem: (item: any) => void;
  getFinalPosition: (id: string) => { x: number; y: number };
  pendingUpdatesCount: number;
}

const DraggableCard: React.FC<DraggableCardProps> = ({
  item,
  index,
  totalCount,
  cardWidth,
  cardHeight,
  gridGap,
  isEditingOrder,
  activeDragId,
  wiggleAnim,
  onEnableEditMode,
  onStartDrag,
  onDragMove,
  onEndDrag,
  onPressItem,
  getFinalPosition,
  pendingUpdatesCount,
}) => {
  const isDragging = activeDragId === item.id;
  const pan = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;

  // Har bir cardning slot koordinatasi Animated.ValueXY sifatida
  const initialPos = getSlotPosition(index, cardWidth, cardHeight, gridGap);
  const positionAnim = useRef(new Animated.ValueXY(initialPos)).current;

  const dragScale = useRef(new Animated.Value(1)).current;
  const dragVisualProgress = useRef(new Animated.Value(0)).current;

  const dragSessionRef = useRef(0);
  const startCardSlotPosRef = useRef<{ x: number; y: number }>({ x: initialPos.x, y: initialPos.y });
  const longPressTimerRef = useRef<any>(null);
  const touchStartTimeRef = useRef(0);
  const isDragActiveRef = useRef(false);
  isDragActiveRef.current = isDragging;

  const propsRef = useRef({
    item,
    index,
    isEditingOrder,
    activeDragId,
    cardWidth,
    cardHeight,
    gridGap,
    getFinalPosition,
    onEnableEditMode,
    onStartDrag,
    onDragMove,
    onEndDrag,
    onPressItem,
  });
  propsRef.current = {
    item,
    index,
    isEditingOrder,
    activeDragId,
    cardWidth,
    cardHeight,
    gridGap,
    getFinalPosition,
    onEnableEditMode,
    onStartDrag,
    onDragMove,
    onEndDrag,
    onPressItem,
  };

  const resetDragVisuals = useCallback(() => {
    dragScale.stopAnimation();
    dragVisualProgress.stopAnimation();
    dragScale.setValue(1);
    dragVisualProgress.setValue(0);
  }, [dragScale, dragVisualProgress]);

  // Agar bu karta drag qilinmayotgan bo'lsa (yoki drag yakunlansa), visual state majburan 0 va 1 ga tozalanadi
  useEffect(() => {
    if (activeDragId !== item.id) {
      resetDragVisuals();
    }
  }, [activeDragId, item.id, resetDragVisuals]);

  // Index yoki o'lchamlar o'zgarganda (boshqa kartochkalar) yangi slotga silliq siljiydi
  useEffect(() => {
    if (isDragging) return;

    const targetPos = getSlotPosition(index, cardWidth, cardHeight, gridGap);

    if (activeDragId) {
      // Boshqa kartochka drag qilinayotgan paytda silliq siljiydi
      Animated.spring(positionAnim, {
        toValue: targetPos,
        useNativeDriver: true,
        bounciness: 4,
        speed: 16,
      }).start();
    } else {
      // Drag yo'q bo'lganda (release dan keyin yoki tinch holatda) to'g'ridan to'g'ri yangi slotda qotadi
      positionAnim.stopAnimation();
      positionAnim.setValue(targetPos);
    }
  }, [index, isDragging, activeDragId, cardWidth, cardHeight, gridGap]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => false,
      onMoveShouldSetPanResponder: (_, gs) => {
        return propsRef.current.isEditingOrder || Math.abs(gs.dx) > 6 || Math.abs(gs.dy) > 6;
      },
      onMoveShouldSetPanResponderCapture: () => false,
      onPanResponderTerminationRequest: () => {
        return !propsRef.current.isEditingOrder && !isDragActiveRef.current;
      },
      onPanResponderGrant: () => {
        // 1. Eski animatsiyalarni darhol to'xtatish va tozalash
        pan.stopAnimation();
        positionAnim.stopAnimation();
        resetDragVisuals();
        pan.setValue({ x: 0, y: 0 });

        // 2. Yangi session
        dragSessionRef.current += 1;

        touchStartTimeRef.current = Date.now();
        const currentProps = propsRef.current;

        // 3. Drag boshlanayotgan paytdagi real live slot
        const startPos = currentProps.getFinalPosition(currentProps.item.id);

        // 4. Bitta Source of Truth
        startCardSlotPosRef.current = startPos;

        // 5. Position ham shu slotga darhol sinxron qotiriladi (Freezing)
        positionAnim.setValue(startPos);

        const startVisualFeedback = () => {
          Animated.parallel([
            Animated.spring(dragScale, {
              toValue: 1.12,
              useNativeDriver: true,
              bounciness: 0,
              speed: 20,
            }),
            Animated.timing(dragVisualProgress, {
              toValue: 1,
              duration: 150,
              useNativeDriver: false,
            }),
          ]).start();
        };

        // Birinchi marta bosganda ham, tahrirlash rejimida ham bir xil biroz (350ms) bosib turib keyin siljitiladi
        const holdDuration = 350;

        longPressTimerRef.current = setTimeout(() => {
          triggerHapticMedium();
          startVisualFeedback();
          if (!currentProps.isEditingOrder) {
            currentProps.onEnableEditMode(currentProps.item.id, startPos);
          }
          currentProps.onStartDrag(currentProps.item.id, startPos);
        }, holdDuration);
      },
      onPanResponderMove: (_, gs) => {
        const currentProps = propsRef.current;
        // Agar foydalanuvchi hold timer bitmasdan barmog'ini harakatlantirsa (scroll qilmoqchi bo'lsa), bekor qilamiz
        if (!isDragActiveRef.current && currentProps.activeDragId !== currentProps.item.id && longPressTimerRef.current) {
          if (Math.hypot(gs.dx, gs.dy) > 10) {
            clearTimeout(longPressTimerRef.current);
            longPressTimerRef.current = null;
          }
        }

        if (currentProps.activeDragId === currentProps.item.id || isDragActiveRef.current) {
          pan.setValue({ x: gs.dx, y: gs.dy });
          currentProps.onDragMove(currentProps.item.id, gs.dx, gs.dy);
        }
      },
      onPanResponderRelease: (_, gs) => {
        if (longPressTimerRef.current) {
          clearTimeout(longPressTimerRef.current);
          longPressTimerRef.current = null;
        }

        const currentProps = propsRef.current;
        const duration = Date.now() - touchStartTimeRef.current;
        const dist = Math.hypot(gs.dx, gs.dy);

        if (currentProps.activeDragId === currentProps.item.id || isDragActiveRef.current) {
          // 1. Darhol final slotni aniqlaymiz
          const finalPos = currentProps.getFinalPosition(currentProps.item.id);

          // 2. Eski barcha animatsiyalarni darhol to'xtatib, final slotga o'rnatamiz
          pan.stopAnimation();
          positionAnim.stopAnimation();

          positionAnim.setValue(finalPos);
          pan.setValue({ x: 0, y: 0 });

          // 3. Visual feedbackni darhol 100% normal holatga qaytaramiz
          resetDragVisuals();

          // 4. Dragni darhol yakunlaymiz (asinxron kechikishlar kutib o'tirilmaydi)
          currentProps.onEndDrag(currentProps.item.id);
        } else if (!currentProps.isEditingOrder && duration < 380 && dist < 12) {
          currentProps.onPressItem(currentProps.item);
        }
      },
      onPanResponderTerminate: () => {
        if (longPressTimerRef.current) {
          clearTimeout(longPressTimerRef.current);
          longPressTimerRef.current = null;
        }
        const currentProps = propsRef.current;
        if (currentProps.activeDragId === currentProps.item.id || isDragActiveRef.current) {
          const finalPos = currentProps.getFinalPosition(currentProps.item.id);

          pan.stopAnimation();
          positionAnim.stopAnimation();

          positionAnim.setValue(finalPos);
          pan.setValue({ x: 0, y: 0 });

          resetDragVisuals();

          currentProps.onEndDrag(currentProps.item.id);
        }
      },
    })
  ).current;

  // Jiggle rotate
  const rotateInterpolate = wiggleAnim.interpolate({
    inputRange: [-1, 0, 1],
    outputRange: [index % 2 === 0 ? '-3.5deg' : '3.5deg', '0deg', index % 2 === 0 ? '3.5deg' : '-3.5deg'],
  });

  const cardBorderColor = dragVisualProgress.interpolate({
    inputRange: [0, 1],
    outputRange: ['rgba(255, 255, 255, 0.08)', 'rgba(255, 255, 255, 0.35)'],
  });

  const cardBackgroundColor = dragVisualProgress.interpolate({
    inputRange: [0, 1],
    outputRange: ['transparent', 'rgba(255, 255, 255, 0.08)'],
  });

  return (
    <Animated.View
      style={[
        styles.gridCardWrapper,
        {
          width: cardWidth,
          height: cardHeight,
          position: 'absolute',
          top: 0,
          left: 0,
          zIndex: isDragging ? 9999 : 1,
          elevation: isDragging ? 25 : 1,
          transform: isDragging
            ? [
                { translateX: Animated.add(positionAnim.x, pan.x) },
                { translateY: Animated.add(positionAnim.y, pan.y) },
                { scale: dragScale },
              ]
            : [
                { translateX: positionAnim.x },
                { translateY: positionAnim.y },
                { rotate: rotateInterpolate },
              ],
        },
      ]}
      {...panResponder.panHandlers}
    >
      <Animated.View
        style={[
          styles.gridCard,
          {
            borderColor: cardBorderColor,
            backgroundColor: cardBackgroundColor,
          },
        ]}
      >
        <BlurView intensity={50} tint="dark" style={StyleSheet.absoluteFill} />

        <View style={{ position: 'relative', marginBottom: 2 }}>
          <Ionicons name={item.icon as any} size={30} color={item.color} />
          {item.id === 'updates' && pendingUpdatesCount > 0 && (
            <View style={styles.badgeCircle}>
              <Text style={styles.badgeText}>
                {pendingUpdatesCount > 99 ? '99+' : pendingUpdatesCount}
              </Text>
            </View>
          )}
        </View>
        <Text style={styles.gridCardTitle} numberOfLines={1}>
          {item.title}
        </Text>
      </Animated.View>
    </Animated.View>
  );
};

const SkeletonLoader: React.FC<{ width?: number; height?: number }> = ({ width = 60, height = 24 }) => {
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
      style={{
        width,
        height,
        borderRadius: 8,
        backgroundColor: 'rgba(255, 255, 255, 0.15)',
        opacity,
        marginTop: 4,
      }}
    />
  );
};

export const DashboardScreen: React.FC<Props> = ({
  onNavigate,
  isEditingOrder: isEditingOrderProp,
  setIsEditingOrder: setIsEditingOrderProp,
  onRegisterSaveOrder,
}) => {
  const { orgId, userRole } = useOrg();
  const queryClient = useQueryClient();

  // 1. React Query Hooks for Dashboard Counts & Matches (0ms cache hit)
  const {
    data: counts = { players: 0, leagues: 0, teams: 0, applications: 0, pendingTeams: 0, pendingUpdates: 0 },
    isLoading: loading,
    refetch: refetchCounts,
  } = useDashboardCountsData(orgId);

  const {
    data: matchesList = [],
    isLoading: matchesLoading,
    refetch: refetchMatches,
  } = useMatchesData(orgId);

  const [activeControlMatchId, setActiveControlMatchId] = useState<string | number | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Active sorted matches for user role (computed from shared matches cache)
  const userMatches = React.useMemo(() => {
    const activeMatches = (matchesList || []).filter((m: any) => m.status !== 'finished');
    return [...activeMatches].sort((a: any, b: any) => {
      const statusOrder: Record<string, number> = {
        'live': 1,
        'first_half': 1,
        'second_half': 1,
        'half_time': 1,
        'scheduled': 2,
        'postponed': 3,
      };
      const getOrder = (st?: string) => statusOrder[st || 'scheduled'] || 5;
      const orderA = getOrder(a.status);
      const orderB = getOrder(b.status);
      if (orderA !== orderB) return orderA - orderB;

      const dateA = new Date(`${a.match_date || a.date || '2099-01-01'}T${a.match_time || a.time || '00:00:00'}`).getTime();
      const dateB = new Date(`${b.match_date || b.date || '2099-01-01'}T${b.match_time || b.time || '00:00:00'}`).getTime();
      return dateA - dateB;
    });
  }, [matchesList]);

  const { width: screenWidth } = useWindowDimensions();
  const gridGap = 10;
  const gridPadding = 20;
  const availableWidth = screenWidth - gridPadding * 2;
  const cardWidth = Math.floor((availableWidth - gridGap * 2) / 3);
  const cardHeight = Math.floor(cardWidth * 0.78); // Kichraytirilgan ixcham height

  // Reorder & Jiggle Animation State
  const [localIsEditingOrder, setLocalIsEditingOrder] = useState(false);
  const isEditingOrder = isEditingOrderProp !== undefined ? isEditingOrderProp : localIsEditingOrder;
  const setIsEditingOrder = setIsEditingOrderProp || setLocalIsEditingOrder;

  const [orderedItemIds, setOrderedItemIds] = useState<string[]>([]);
  const orderedItemIdsRef = useRef<string[]>([]);

  const updateOrderedItems = useCallback((updated: string[]) => {
    orderedItemIdsRef.current = updated;
    setOrderedItemIds(updated);
  }, []);

  const allMenuNavItems = React.useMemo(() => [
    {
      id: 'export',
      title: 'Export',
      icon: 'image-outline',
      color: '#38BDF8',
      action: () => onNavigate && onNavigate('export'),
      adminOnly: true,
    },
    {
      id: 'finished-matches',
      title: "Yakunlangan O'yinlar",
      icon: 'checkmark-done-circle-outline',
      color: '#10B981',
      action: () => onNavigate && onNavigate('finished-matches' as any),
      adminOnly: false,
    },
    {
      id: 'ligalar',
      title: 'Ligalar',
      icon: 'trophy-outline',
      color: '#FBBF24',
      action: () => onNavigate && onNavigate('leagues'),
      adminOnly: false,
    },
    {
      id: 'transferlar',
      title: 'Transferlar',
      icon: 'swap-horizontal-outline',
      color: '#2DD4BF',
      action: () => onNavigate && onNavigate('transfers'),
      adminOnly: true,
    },
    {
      id: 'updates',
      title: "Ma'lumotlar",
      icon: 'refresh-outline',
      color: '#A78BFA',
      action: () => onNavigate && onNavigate('updates'),
      adminOnly: true,
    },
    {
      id: 'schedule',
      title: "O'yinlar",
      icon: 'calendar-outline',
      color: '#FB7185',
      action: () => onNavigate('matches'),
      adminOnly: false,
    },
    {
      id: 'standings',
      title: 'Turnirlar',
      icon: 'grid-outline',
      color: '#38BDF8',
      action: () => Alert.alert("Turnir jadvali", "Turnir jadvali bo'limi tayyorlanmoqda"),
      adminOnly: true,
    },
    {
      id: 'sponsors',
      title: 'Homiylar',
      icon: 'business-outline',
      color: '#FB923C',
      action: () => onNavigate && onNavigate('sponsors'),
      adminOnly: true,
    },
    {
      id: 'news',
      title: 'Yangiliklar',
      icon: 'newspaper-outline',
      color: '#F87171',
      action: () => onNavigate && onNavigate('news'),
      adminOnly: true,
    },
  ], [onNavigate]);

  const baseMenuNavItems = React.useMemo(() => (
    userRole === 'user' 
      ? allMenuNavItems.filter(item => !item.adminOnly)
      : allMenuNavItems
  ), [userRole, allMenuNavItems]);

  // Sorted items based on orderedItemIds
  const menuNavItems = React.useMemo(() => {
    if (!orderedItemIds || orderedItemIds.length === 0) return baseMenuNavItems;
    const itemsMap = new Map(baseMenuNavItems.map(it => [it.id, it]));
    const sorted: typeof baseMenuNavItems = [];

    // 1. Append cached ordered items
    orderedItemIds.forEach(id => {
      const it = itemsMap.get(id);
      if (it) {
        sorted.push(it);
        itemsMap.delete(id);
      }
    });

    // 2. Append any new items not yet present in cache
    itemsMap.forEach(it => {
      sorted.push(it);
    });

    return sorted;
  }, [baseMenuNavItems, orderedItemIds]);

  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const startDragSlotIndexRef = useRef<number>(0);
  const startDragPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  const getCurrentMenuIds = useCallback(() => {
    const visibleIds = new Set(baseMenuNavItems.map(item => item.id));
    const cachedIds = orderedItemIdsRef.current.filter(id => visibleIds.has(id));
    const cachedSet = new Set(cachedIds);
    const newVisibleIds = baseMenuNavItems
      .map(item => item.id)
      .filter(id => !cachedSet.has(id));
    return [...cachedIds, ...newVisibleIds];
  }, [baseMenuNavItems]);

  const getFinalPosition = useCallback((id: string) => {
    const currentList = getCurrentMenuIds();
    const finalIdx = currentList.indexOf(id);
    return getSlotPosition(finalIdx !== -1 ? finalIdx : 0, cardWidth, cardHeight, gridGap);
  }, [cardWidth, cardHeight, gridGap, getCurrentMenuIds]);

  const handleEnableEditMode = useCallback((id: string, startPos?: { x: number; y: number }) => {
    setIsEditingOrder(true);
    setActiveDragId(id);
    if (startPos) {
      startDragPosRef.current = startPos;
    } else {
      const currentList = getCurrentMenuIds();
      const idx = currentList.indexOf(id);
      const validIdx = idx !== -1 ? idx : 0;
      startDragSlotIndexRef.current = validIdx;
      startDragPosRef.current = getSlotPosition(validIdx, cardWidth, cardHeight, gridGap);
    }
  }, [setIsEditingOrder, cardWidth, cardHeight, gridGap, getCurrentMenuIds]);

  const handleStartDrag = useCallback((id: string, startPos?: { x: number; y: number }) => {
    setActiveDragId(id);
    if (startPos) {
      startDragPosRef.current = startPos;
    } else {
      const currentList = getCurrentMenuIds();
      const idx = currentList.indexOf(id);
      const validIdx = idx !== -1 ? idx : 0;
      startDragSlotIndexRef.current = validIdx;
      startDragPosRef.current = getSlotPosition(validIdx, cardWidth, cardHeight, gridGap);
    }
  }, [cardWidth, cardHeight, gridGap, getCurrentMenuIds]);

  const handleEndDrag = useCallback((id?: string) => {
    setActiveDragId(prev => (id ? (prev === id ? null : prev) : null));
  }, []);

  // Wiggle Animated Value (Slower, gentle and organic iPhone-like jiggle)
  const wiggleAnim = useRef(new Animated.Value(0)).current;
  const loopAnimRef = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    if (isEditingOrder) {
      if (loopAnimRef.current) {
        loopAnimRef.current.stop();
        loopAnimRef.current = null;
      }
      wiggleAnim.setValue(0);
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(wiggleAnim, {
            toValue: 1,
            duration: 115,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
          Animated.timing(wiggleAnim, {
            toValue: -1,
            duration: 115,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
        ])
      );
      loopAnimRef.current = loop;
      loop.start();
    } else {
      if (loopAnimRef.current) {
        loopAnimRef.current.stop();
        loopAnimRef.current = null;
      }
      Animated.timing(wiggleAnim, {
        toValue: 0,
        duration: 150,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
      setActiveDragId(null);
    }

    return () => {
      if (loopAnimRef.current) {
        loopAnimRef.current.stop();
        loopAnimRef.current = null;
      }
    };
  }, [isEditingOrder]);

  // Load Saved Order from local storage cache
  useEffect(() => {
    const loadCachedOrder = async () => {
      try {
        const cached = await AsyncStorage.getItem('@amatora_dashboard_menu_order_v1');
        if (cached) {
          const parsed = JSON.parse(cached);
          if (Array.isArray(parsed) && parsed.length > 0) {
            updateOrderedItems(parsed);
          }
        }
      } catch (e) {}
    };
    loadCachedOrder();
  }, [updateOrderedItems]);

  // Save Order to local storage cache with smooth return to 0 position
  const saveOrderToCache = useCallback(async () => {
    try {
      if (orderedItemIds.length > 0) {
        await AsyncStorage.setItem('@amatora_dashboard_menu_order_v1', JSON.stringify(orderedItemIds));
      }
    } catch (e) {}

    // Smooth animated return of cards to initial 0deg position
    if (loopAnimRef.current) {
      loopAnimRef.current.stop();
      loopAnimRef.current = null;
    }
    Animated.timing(wiggleAnim, {
      toValue: 0,
      duration: 150,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(() => {
      setIsEditingOrder(false);
      setActiveDragId(null);
    });
  }, [orderedItemIds, setIsEditingOrder]);

  useEffect(() => {
    if (onRegisterSaveOrder) {
      onRegisterSaveOrder(saveOrderToCache);
    }
  }, [onRegisterSaveOrder, saveOrderToCache]);

  // Realtime Subscription for all dashboard entities
  useEffect(() => {
    const channel = supabase
      .channel('dashboard_realtime_channel')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches' }, () => {
        queryClient.invalidateQueries({ queryKey: ['dashboard', Number(orgId) || 1] });
        queryClient.invalidateQueries({ queryKey: ['matches', Number(orgId) || 1] });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'applications' }, () => {
        queryClient.invalidateQueries({ queryKey: ['dashboard', Number(orgId) || 1] });
        queryClient.invalidateQueries({ queryKey: ['applications', Number(orgId) || 1] });
        queryClient.invalidateQueries({ queryKey: ['players', Number(orgId) || 1] });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'teams' }, () => {
        queryClient.invalidateQueries({ queryKey: ['dashboard', Number(orgId) || 1] });
        queryClient.invalidateQueries({ queryKey: ['teams', Number(orgId) || 1] });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'leagues' }, () => {
        queryClient.invalidateQueries({ queryKey: ['dashboard', Number(orgId) || 1] });
        queryClient.invalidateQueries({ queryKey: ['leagues', Number(orgId) || 1] });
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [orgId, queryClient]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([
      refetchCounts(),
      refetchMatches(),
    ]);
    setRefreshing(false);
  }, [refetchCounts, refetchMatches]);

  const getMatchTimeRemainingText = (
    mDate?: string,
    mTime?: string,
    status?: string,
    timerSecs?: number,
    startedAt?: string,
    isRunning?: boolean
  ) => {
    if (status === 'finished') return { text: 'Uchrashuv Yakunlangan', color: '#10B981' };
    if (status === 'first_half' || status === 'second_half' || status === 'half_time' || status === 'live') {
      if (status === 'half_time') {
        return { text: 'TANAFFUS (JONLI)', color: '#F59E0B' };
      }
      let sec = timerSecs || 0;
      if (isRunning && startedAt) {
        const ms = new Date(startedAt).getTime();
        if (!isNaN(ms)) {
          const elapsed = Math.max(0, Math.floor((Date.now() - ms) / 1000));
          if (elapsed < 14400) {
            sec += elapsed;
          }
        }
      }
      const min = Math.max(1, Math.floor(sec / 60) + 1);
      const halfLabel = status === 'second_half' ? '2-Taym' : '1-Taym';
      return { text: `JONLI • ${halfLabel} (${min}')`, color: '#EF4444' };
    }
    if (!mDate || !mTime) return { text: 'Boshlanish vaqti belgilanmagan', color: 'rgba(255,255,255,0.4)' };

    try {
      const matchDateTime = new Date(`${mDate}T${mTime.length === 5 ? mTime + ':00' : mTime}`);
      const now = new Date();
      const diffMs = matchDateTime.getTime() - now.getTime();

      if (diffMs <= 0) {
        return { text: "O'yin vaqti kelgan / Jonli", color: '#3B82F6' };
      }

      const hours = Math.floor(diffMs / (1000 * 60 * 60));
      const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
      const days = Math.floor(hours / 24);

      if (days > 0) {
        return { text: `Boshlanishiga: ${days} kun ${hours % 24} soat`, color: '#F59E0B' };
      }
      return { text: `Boshlanishiga: ${hours} soat ${minutes} daqiqa`, color: '#00FF66' };
    } catch (e) {
      return { text: `${mDate} | ${mTime}`, color: 'rgba(255,255,255,0.6)' };
    }
  };

  const getLiveTimerFormattedText = (status?: string, timerSecs?: number, startedAt?: string, isRunning?: boolean) => {
    if (status === 'half_time') return 'Tanaffus';
    let sec = timerSecs || 0;
    if (isRunning && startedAt) {
      const ms = new Date(startedAt).getTime();
      if (!isNaN(ms)) {
        const elapsed = Math.max(0, Math.floor((Date.now() - ms) / 1000));
        if (elapsed < 14400) {
          sec += elapsed;
        }
      }
    }
    const mins = Math.floor(sec / 60);
    const secs = sec % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  if (activeControlMatchId) {
    return (
      <MatchControlScreen
        matchId={activeControlMatchId}
        onBack={() => {
          setActiveControlMatchId(null);
          queryClient.invalidateQueries({ queryKey: ['matches', Number(orgId) || 1] });
          queryClient.invalidateQueries({ queryKey: ['dashboard', Number(orgId) || 1] });
        }}
      />
    );
  }



  const handleDragMove = useCallback(
    (draggingId: string, dx: number, dy: number) => {
      const currentList = getCurrentMenuIds();

      const currentIdx = currentList.indexOf(draggingId);
      if (currentIdx === -1) return;

      // Barmoqning grid ichidagi joriy markaziy nuqtasi
      const currentCenterX = startDragPosRef.current.x + cardWidth / 2 + dx;
      const currentCenterY = startDragPosRef.current.y + cardHeight / 2 + dy;

      // iOS Home Screen Grid Bounding Box: qaysi ustun va qatorda ekanligi
      const col = Math.min(2, Math.max(0, Math.floor(currentCenterX / (cardWidth + gridGap))));
      const maxRows = Math.ceil(currentList.length / 3) - 1;
      const row = Math.min(maxRows, Math.max(0, Math.floor(currentCenterY / (cardHeight + gridGap))));
      const targetIndex = Math.min(currentList.length - 1, row * 3 + col);

      if (targetIndex === currentIdx) return;

      // Yangi slot markaziga yaqinlik tekshiruvi (Hysteresis)
      const targetSlot = getSlotPosition(targetIndex, cardWidth, cardHeight, gridGap);
      const targetCenterX = targetSlot.x + cardWidth / 2;
      const targetCenterY = targetSlot.y + cardHeight / 2;

      const distanceToTarget = Math.hypot(
        currentCenterX - targetCenterX,
        currentCenterY - targetCenterY
      );

      // Kartochka markazi yangi slot katagining ichki maydoniga kirganda
      const threshold = Math.min(cardWidth, cardHeight) * 0.48;
      if (distanceToTarget > threshold) return;

      const updated = [...currentList];
      const [moved] = updated.splice(currentIdx, 1);
      updated.splice(targetIndex, 0, moved);

      updateOrderedItems(updated);
    },
    [cardWidth, cardHeight, gridGap, getCurrentMenuIds, updateOrderedItems]
  );

  return (
    <View style={styles.root}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={{ paddingBottom: 120 }}
        showsVerticalScrollIndicator={false}
        scrollEnabled={!isEditingOrder}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#FFFFFF" />}
      >
      {/* Main Stats Cards (Kutilayotgan Arizalar, Qabul Qilingan O'yinchilar, Jami Ligalar, Qabul Qilingan Jamoalar) */}
      <Text style={styles.sectionTitle}>{"Umumiy Statistika"}</Text>
      <View style={styles.statsColumn}>
        {/* Card 1: Kutilayotgan Arizalar */}
        {userRole !== 'user' && (
          <TouchableOpacity
            style={[styles.mainStatCard, { borderColor: 'rgba(255, 255, 255, 0.18)' }]}
            activeOpacity={0.8}
            onPress={() => onNavigate && onNavigate('applications', 'players')}
          >
            <BlurView intensity={70} tint="dark" experimentalBlurMethod={Platform.OS === 'android' ? 'dimezisBlurView' : undefined} style={StyleSheet.absoluteFill} />
            <Ionicons name="document-text-outline" size={28} color="#60A5FA" />
            <View style={{ flex: 1 }}>
              <Text style={styles.statLabel}>{"Kutilayotgan Arizalar"}</Text>
              {loading ? (
                <SkeletonLoader width={160} height={24} />
              ) : (
                <Text style={[styles.statValue, { color: '#FFFFFF', fontSize: 14.5, fontWeight: '900' }]}>
                  {`${counts.applications}ta o'yinchi / ${counts.pendingTeams}ta jamoa`}
                </Text>
              )}
            </View>
            <Ionicons name="chevron-forward" size={20} color="rgba(255, 255, 255, 0.4)" />
          </TouchableOpacity>
        )}

        {/* Card 2: Qabul Qilingan O'yinchilar */}
        <TouchableOpacity
          style={[styles.mainStatCard, { borderColor: 'rgba(255, 255, 255, 0.18)' }]}
          activeOpacity={0.8}
          onPress={() => onNavigate && onNavigate('players', 'players')}
        >
          <BlurView intensity={70} tint="dark" experimentalBlurMethod={Platform.OS === 'android' ? 'dimezisBlurView' : undefined} style={StyleSheet.absoluteFill} />
          <Ionicons name="people-outline" size={28} color="#2DD4BF" />
          <View style={{ flex: 1 }}>
            <Text style={styles.statLabel}>{"Qabul Qilingan O'yinchilar"}</Text>
            {loading ? (
              <SkeletonLoader width={70} height={24} />
            ) : (
              <Text style={styles.statValue}>{counts.players} {"ta"}</Text>
            )}
          </View>
          <Ionicons name="chevron-forward" size={20} color="rgba(255, 255, 255, 0.4)" />
        </TouchableOpacity>

        {/* Card 3: Jami Ligalar */}
        <TouchableOpacity
          style={[styles.mainStatCard, { borderColor: 'rgba(255, 255, 255, 0.18)' }]}
          activeOpacity={0.8}
          onPress={() => onNavigate && onNavigate('leagues')}
        >
          <BlurView intensity={70} tint="dark" experimentalBlurMethod={Platform.OS === 'android' ? 'dimezisBlurView' : undefined} style={StyleSheet.absoluteFill} />
          <Ionicons name="trophy-outline" size={28} color="#FBBF24" />
          <View style={{ flex: 1 }}>
            <Text style={styles.statLabel}>{"Jami Ligalar"}</Text>
            {loading ? (
              <SkeletonLoader width={70} height={24} />
            ) : (
              <Text style={styles.statValue}>{counts.leagues} {"ta"}</Text>
            )}
          </View>
          <Ionicons name="chevron-forward" size={20} color="rgba(255, 255, 255, 0.4)" />
        </TouchableOpacity>

        {/* Card 4: Qabul Qilingan Jamoalar */}
        <TouchableOpacity
          style={[styles.mainStatCard, { borderColor: 'rgba(255, 255, 255, 0.18)' }]}
          activeOpacity={0.8}
          onPress={() => onNavigate && onNavigate('players', 'teams')}
        >
          <BlurView intensity={70} tint="dark" experimentalBlurMethod={Platform.OS === 'android' ? 'dimezisBlurView' : undefined} style={StyleSheet.absoluteFill} />
          <Ionicons name="shirt-outline" size={28} color="#4ADE80" />
          <View style={{ flex: 1 }}>
            <Text style={styles.statLabel}>{"Qabul Qilingan Jamoalar"}</Text>
            {loading ? (
              <SkeletonLoader width={70} height={24} />
            ) : (
              <Text style={styles.statValue}>{counts.teams} {"ta"}</Text>
            )}
          </View>
          <Ionicons name="chevron-forward" size={20} color="rgba(255, 255, 255, 0.4)" />
        </TouchableOpacity>
      </View>

      {/* Admin Menu Grid (Slot-Based Absolute Grid) */}
      <Text style={styles.sectionTitle}>{"Admin Menyusi Sahifalari"}</Text>
      <View style={[styles.menuGrid, { height: Math.ceil(menuNavItems.length / 3) * (cardHeight + gridGap) }]}>
        {menuNavItems.map((item, index) => {
          return (
            <DraggableCard
              key={item.id}
              item={item}
              index={index}
              totalCount={menuNavItems.length}
              cardWidth={cardWidth}
              cardHeight={cardHeight}
              gridGap={gridGap}
              isEditingOrder={isEditingOrder}
              activeDragId={activeDragId}
              wiggleAnim={wiggleAnim}
              onEnableEditMode={handleEnableEditMode}
              onStartDrag={handleStartDrag}
              onDragMove={handleDragMove}
              onEndDrag={handleEndDrag}
              onPressItem={(it) => it.action()}
              getFinalPosition={getFinalPosition}
              pendingUpdatesCount={counts.pendingUpdates}
            />
          );
        })}
      </View>

      {/* Real Live & Chronological Matches Section at the VERY BOTTOM */}
      {userRole === 'user' && (
        <View style={{ marginTop: 24, marginBottom: 12 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <Text style={styles.sectionTitle}>{"O'yinlar Jadvali"}</Text>
            <TouchableOpacity onPress={() => onNavigate && onNavigate('matches')}>
              <Text style={{ color: '#00FF87', fontSize: 12, fontWeight: '800' }}>{"BARCHA O'YINLAR →"}</Text>
            </TouchableOpacity>
          </View>

          {matchesLoading ? (
            <View style={{ gap: 14 }}>
              <SkeletonLoader width={340} height={180} />
              <SkeletonLoader width={340} height={180} />
            </View>
          ) : userMatches.length > 0 ? (
            userMatches.map((item: any, idx: number) => {
              const isCentral = item.importance === 'markaziy';
              const mDate = item.match_date || item.date;
              const mTime = item.match_time || item.time;
              const isLive = item.status === 'first_half' || item.status === 'second_half' || item.status === 'half_time' || item.status === 'live';
              const isFinished = item.status === 'finished';
              const countdownInfo = getMatchTimeRemainingText(
                mDate,
                mTime,
                item.status,
                item.timer_seconds,
                item.timer_started_at,
                item.is_timer_running
              );
              const homeName = item.home_team?.name || item.home_team_name || 'Mezbon';
              const awayName = item.away_team?.name || item.away_team_name || 'Mehmon';
              const homeLogo = item.home_team?.logo_url || item.home_team_logo || 'https://images.unsplash.com/photo-1508098682722-e99c43a406b2?w=100&auto=format&fit=crop';
              const awayLogo = item.away_team?.logo_url || item.away_team_logo || 'https://images.unsplash.com/photo-1508098682722-e99c43a406b2?w=100&auto=format&fit=crop';
              const roundStr = item.round ? `${item.round}-bosqich` : (item.tour ? `${item.tour}-bosqich` : '1-bosqich');
              const locationStr = item.location === '2-maydon' ? '2-Maydon' : (item.location || '1-Maydon');

              return (
                <View
                  key={item.id || idx}
                  style={[
                    styles.matchCard,
                    isCentral && styles.centralMatchCard,
                    isLive && { borderColor: 'rgba(239, 68, 68, 0.5)', borderWidth: 1.5 },
                  ]}
                >
                  {/* Central Match Header Badge */}
                  {isCentral && (
                    <View style={styles.centralHeaderBadge}>
                      <Ionicons name="flame-outline" size={14} color="#FF9500" />
                      <Text style={styles.centralHeaderTitle}>{"MARKAZIY O'YIN"}</Text>
                    </View>
                  )}

                  {/* Match Top Info Bar */}
                  <View style={styles.cardTopRow}>
                    <View style={styles.leagueTag}>
                      <Text style={styles.leagueTagText}>{item.league || 'LIGA'}</Text>
                      <Text style={styles.roundTagText}>{` • ${roundStr}`}</Text>
                    </View>

                    <View style={styles.fieldTag}>
                      <Ionicons name="location-outline" size={12} color="rgba(255,255,255,0.6)" />
                      <Text style={styles.fieldTagText}>{locationStr}</Text>
                    </View>
                  </View>

                  {/* Teams VS Section */}
                  <View style={styles.teamsSection}>
                    {/* Home Team */}
                    <View style={styles.teamCol}>
                      <Image source={{ uri: homeLogo }} style={styles.teamLogo} />
                      <Text style={styles.teamName} numberOfLines={2}>{homeName}</Text>
                    </View>

                    {/* Score or VS Badge */}
                    <View style={styles.scoreContainer}>
                      {isFinished || isLive ? (
                        <View style={[styles.scoreBadge, isLive && { backgroundColor: 'rgba(239, 68, 68, 0.2)', borderColor: '#EF4444' }]}>
                          <Text style={[styles.scoreText, isLive && { color: '#FF4D4D', fontWeight: '900' }]}>
                            {item.home_score ?? 0} : {item.away_score ?? 0}
                          </Text>
                        </View>
                      ) : (
                        <View style={styles.vsBadge}>
                          <Text style={styles.vsText}>VS</Text>
                        </View>
                      )}

                      {isLive ? (
                        <View style={styles.liveTimerSubPill}>
                          <Ionicons name="time-outline" size={11} color="#EF4444" />
                          <Text style={styles.liveTimerSubText}>
                            {getLiveTimerFormattedText(item.status, item.timer_seconds, item.timer_started_at, item.is_timer_running)}
                          </Text>
                        </View>
                      ) : (
                        <Text style={styles.matchTimeText}>{mTime || '18:00'}</Text>
                      )}
                    </View>

                    {/* Away Team */}
                    <View style={styles.teamCol}>
                      <Image source={{ uri: awayLogo }} style={styles.teamLogo} />
                      <Text style={styles.teamName} numberOfLines={2}>{awayName}</Text>
                    </View>
                  </View>

                  {/* Countdown & Match Status Bar */}
                  <View style={[styles.countdownBar, isLive && { backgroundColor: 'rgba(239, 68, 68, 0.12)' }]}>
                    <Ionicons name={isLive ? "radio-outline" : "time-outline"} size={13} color={countdownInfo.color} />
                    <Text style={[styles.countdownText, { color: countdownInfo.color, fontWeight: isLive ? '900' : '700' }]}>
                      {countdownInfo.text}
                    </Text>
                  </View>

                  {/* PROMINENT CENTERED "O'YINNI BOSHQARISH" ACTION BUTTON */}
                  <TouchableOpacity
                    style={styles.centralManageBtn}
                    onPress={() => setActiveControlMatchId(item.id)}
                    activeOpacity={0.8}
                  >
                    <Ionicons name="settings-outline" size={18} color="#000000" />
                    <Text style={styles.centralManageBtnText}>{"O'YINNI BOSHQARISH"}</Text>
                  </TouchableOpacity>
                </View>
              );
            })
          ) : (
            <View style={styles.dashEmptyMatchCard}>
              <Ionicons name="calendar-outline" size={28} color="rgba(255,255,255,0.4)" />
              <Text style={styles.dashEmptyText}>Hozircha rejalashtirilgan o'yinlar mavjud emas</Text>
            </View>
          )}
        </View>
      )}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  container: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  sectionTitle: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '800',
    marginBottom: 14,
    letterSpacing: -0.3,
  },
  statsColumn: {
    gap: 12,
    marginBottom: 24,
  },
  mainStatCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'transparent',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    gap: 14,
    overflow: 'hidden',
  },
  statIconBox: {
    width: 50,
    height: 50,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statLabel: {
    color: 'rgba(255, 255, 255, 0.65)',
    fontSize: 13,
    fontWeight: '700',
  },
  statValue: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '900',
    marginTop: 2,
  },
  menuGrid: {
    position: 'relative',
    width: '100%',
    marginBottom: 16,
  },
  gridCardWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  gridCard: {
    width: '100%',
    height: '100%',
    backgroundColor: 'transparent',
    borderRadius: 18,
    paddingVertical: 4,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    overflow: 'hidden',
    position: 'relative',
  },
  gridCardDragging: {
    borderColor: 'rgba(255, 255, 255, 0.35)',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.5,
    shadowRadius: 12,
    elevation: 20,
  },
  gridIconBox: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  gridCardTitle: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'center',
  },
  badgeCircle: {
    position: 'absolute',
    top: -6,
    right: -10,
    backgroundColor: '#EF4444',
    borderRadius: 10,
    minWidth: 18,
    height: 18,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 4,
    borderWidth: 1.5,
    borderColor: '#0F172A',
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '900',
  },  // Matches List Styles
  matchCard: {
    backgroundColor: '#1E293B',
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    gap: 12,
    marginBottom: 12,
  },
  centralMatchCard: {
    borderColor: 'rgba(255, 149, 0, 0.4)',
    borderWidth: 1.5,
  },
  centralHeaderBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: 'rgba(255, 149, 0, 0.15)',
    paddingVertical: 5,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255, 149, 0, 0.3)',
  },
  centralHeaderTitle: {
    color: '#FF9500',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  cardTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  leagueTag: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  leagueTagText: {
    color: '#00FF66',
    fontSize: 12,
    fontWeight: '800',
  },
  roundTagText: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 12,
    fontWeight: '600',
  },
  fieldTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255,255,255,0.06)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  fieldTagText: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 11,
    fontWeight: '700',
  },
  teamsSection: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingVertical: 6,
  },
  teamCol: {
    alignItems: 'center',
    flex: 1,
    gap: 6,
  },
  teamLogo: {
    width: 52,
    height: 52,
    borderRadius: 18,
    backgroundColor: '#263044',
  },
  teamName: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
    textAlign: 'center',
  },
  scoreContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  scoreBadge: {
    backgroundColor: '#00FF66',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 12,
  },
  scoreText: {
    color: '#000000',
    fontSize: 16,
    fontWeight: '900',
  },
  vsBadge: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  vsText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '900',
  },
  matchTimeText: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 11,
    fontWeight: '700',
  },
  liveTimerSubPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
  },
  liveTimerSubText: {
    color: '#FF4D4D',
    fontSize: 10.5,
    fontWeight: '900',
  },
  countdownBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: 'rgba(255,255,255,0.04)',
    paddingVertical: 7,
    borderRadius: 10,
  },
  countdownText: {
    fontSize: 11.5,
    fontWeight: '700',
  },
  centralManageBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#00FF66',
    paddingVertical: 12,
    borderRadius: 14,
    marginTop: 4,
    shadowColor: '#00FF66',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 6,
  },
  centralManageBtnText: {
    color: '#000000',
    fontSize: 13.5,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  dashEmptyMatchCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderStyle: 'dashed',
  },
  dashEmptyText: {
    color: 'rgba(255, 255, 255, 0.45)',
    fontSize: 13,
    fontWeight: '600',
    marginTop: 6,
  },
});
