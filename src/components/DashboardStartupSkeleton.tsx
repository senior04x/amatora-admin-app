import React from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../context/ThemeContext';

export function DashboardStartupSkeleton() {
  const { colors } = useTheme();

  return (
    <SafeAreaView
      edges={['top']}
      style={[styles.screen, { backgroundColor: colors.bgPrimary }]}
      accessible
      accessibilityLabel="Bosh sahifa yuklanmoqda"
      accessibilityState={{ busy: true }}
    >
      <View style={styles.header}>
        <View style={[styles.icon, { backgroundColor: colors.bgCardElevated }]} />
        <View style={[styles.heading, { backgroundColor: colors.bgCardElevated }]} />
      </View>
      <View style={[styles.heading, styles.section, { backgroundColor: colors.bgCardElevated }]} />
      {[0, 1, 2, 3].map(index => (
        <View key={index} style={[styles.card, { borderColor: colors.border, backgroundColor: colors.bgCard }]}>
          <View style={[styles.icon, { backgroundColor: colors.bgCardElevated }]} />
          <View style={[styles.heading, { backgroundColor: colors.bgCardElevated }]} />
        </View>
      ))}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: 18 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 16 },
  icon: { width: 38, height: 38, borderRadius: 10 },
  heading: { width: 128, height: 18, borderRadius: 6 },
  section: { marginTop: 18, marginBottom: 14 },
  card: {
    minHeight: 66,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderRadius: 18,
  },
});
