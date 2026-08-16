import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export type ViewState = 'loading' | 'success' | 'empty' | 'error' | 'offline' | 'forbidden';

interface StateViewProps {
  state: ViewState;
  children: React.ReactNode;
  emptyTitle?: string;
  emptySubtitle?: string;
  emptyIcon?: keyof typeof Ionicons.glyphMap;
  errorMessage?: string;
  onRetry?: () => void;
  onEmptyAction?: () => void;
  emptyActionLabel?: string;
}

export const StateView: React.FC<StateViewProps> = ({
  state,
  children,
  emptyTitle = "Ma'lumotlar topilmadi",
  emptySubtitle = "Hozircha ushbu bo'limda hech qanday ma'lumot mavjud emas.",
  emptyIcon = 'file-tray-outline',
  errorMessage = "Ma'lumotlarni yuklashda xatolik yuz berdi.",
  onRetry,
  onEmptyAction,
  emptyActionLabel,
}) => {
  if (state === 'success') {
    return <>{children}</>;
  }

  if (state === 'loading') {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#10B981" />
        <Text style={styles.loadingText}>Yuklanmoqda...</Text>
      </View>
    );
  }

  if (state === 'offline') {
    return (
      <View style={styles.centerContainer}>
        <View style={[styles.iconCircle, { backgroundColor: 'rgba(239, 68, 68, 0.12)' }]}>
          <Ionicons name="cloud-offline-outline" size={42} color="#EF4444" />
        </View>
        <Text style={styles.titleText}>Internet Aloqasi Yo'q</Text>
        <Text style={styles.subtitleText}>
          Iltimos, internet ulanishini tekshiring va qayta urinib ko'ring.
        </Text>
        {onRetry && (
          <TouchableOpacity style={styles.retryButton} onPress={onRetry} activeOpacity={0.8}>
            <Ionicons name="refresh-outline" size={18} color="#FFFFFF" style={{ marginRight: 6 }} />
            <Text style={styles.retryButtonText}>Qayta tekshirish</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  if (state === 'forbidden') {
    return (
      <View style={styles.centerContainer}>
        <View style={[styles.iconCircle, { backgroundColor: 'rgba(245, 158, 11, 0.12)' }]}>
          <Ionicons name="lock-closed-outline" size={42} color="#F59E0B" />
        </View>
        <Text style={styles.titleText}>Ruxsat Cheklangan</Text>
        <Text style={styles.subtitleText}>
          Sizda ushbu ma'lumotlarni ko'rish yoki boshqarish uchun administratorlik huquqi yo'q.
        </Text>
      </View>
    );
  }

  if (state === 'error') {
    return (
      <View style={styles.centerContainer}>
        <View style={[styles.iconCircle, { backgroundColor: 'rgba(239, 68, 68, 0.12)' }]}>
          <Ionicons name="alert-circle-outline" size={42} color="#EF4444" />
        </View>
        <Text style={styles.titleText}>Xatolik Yuz Berdi</Text>
        <Text style={styles.subtitleText}>{errorMessage}</Text>
        {onRetry && (
          <TouchableOpacity style={styles.retryButton} onPress={onRetry} activeOpacity={0.8}>
            <Ionicons name="refresh-outline" size={18} color="#FFFFFF" style={{ marginRight: 6 }} />
            <Text style={styles.retryButtonText}>Qayta urinish</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  // state === 'empty'
  return (
    <View style={styles.centerContainer}>
      <View style={[styles.iconCircle, { backgroundColor: 'rgba(255, 255, 255, 0.05)' }]}>
        <Ionicons name={emptyIcon} size={42} color="#94A3B8" />
      </View>
      <Text style={styles.titleText}>{emptyTitle}</Text>
      <Text style={styles.subtitleText}>{emptySubtitle}</Text>
      {onEmptyAction && emptyActionLabel && (
        <TouchableOpacity style={styles.actionButton} onPress={onEmptyAction} activeOpacity={0.8}>
          <Text style={styles.actionButtonText}>{emptyActionLabel}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  centerContainer: {
    paddingVertical: 50,
    paddingHorizontal: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  titleText: {
    fontSize: 17,
    fontWeight: '700',
    color: '#F8FAFC',
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitleText: {
    fontSize: 13,
    color: '#94A3B8',
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 20,
    maxWidth: 280,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: '#94A3B8',
  },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#10B981',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 12,
  },
  retryButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  actionButton: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    borderWidth: 1,
    borderColor: '#10B981',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 12,
  },
  actionButtonText: {
    color: '#10B981',
    fontSize: 14,
    fontWeight: '600',
  },
});
