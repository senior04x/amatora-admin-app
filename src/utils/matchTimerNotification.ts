import { useEffect } from 'react';
import { AppState, NativeModules, PermissionsAndroid, Platform } from 'react-native';
import { getRemainingSeconds, isRunningTimerSnapshot, parseTimerStartMs, serverNowMs } from './matchTimer';
import type { MatchTimerSnapshot } from './matchTimer';

const androidTimer = Platform.OS === 'android' ? NativeModules.MatchTimerNotification : undefined;
const iosTimer = Platform.OS === 'ios' ? NativeModules.MatchTimerActivity : undefined;
const timer = androidTimer ?? iosTimer;
let requestedNotificationPermission = false;
const activePhases = new Set(['first_half', 'second_half', 'extra_time', 'live', 'in_progress', 'half_time', 'break']);

export function useMatchTimerNotification(
  match: MatchTimerSnapshot | null,
  halfSeconds: number,
  enabled: boolean,
  clockSynced: boolean,
) {
  const { id, status, timer_seconds, timer_started_at, is_timer_running } = match ?? {};
  useEffect(() => {
    if (!timer) return;
    if (!enabled || id == null || !status || !activePhases.has(status)) {
      timer.hide();
      return;
    }
    const snapshot = { id, status, timer_seconds, timer_started_at, is_timer_running };
    const publish = () => {
      const now = serverNowMs();
      const running = isRunningTimerSnapshot(snapshot);
      if (running && now == null) {
        timer.hide();
        return;
      }
      const remaining = getRemainingSeconds(snapshot, halfSeconds, now);
      const endTime = running && now != null
        ? Date.now() + Math.max(0, parseTimerStartMs(timer_started_at) + getRemainingSeconds(snapshot, halfSeconds, null) * 1000 - now)
        : 0;
      if (remaining <= 0 || (running && endTime <= Date.now())) {
        timer.hide();
        return;
      }
      if (iosTimer) iosTimer.show(String(id), remaining, endTime);
      else androidTimer.show(remaining, endTime);
    };
    let active = true;
    publish();
    if (Platform.OS === 'android' && Number(Platform.Version) >= 33 &&
      AppState.currentState === 'active' && !requestedNotificationPermission &&
      isRunningTimerSnapshot(snapshot)) {
      requestedNotificationPermission = true;
      void PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS)
        .then(result => {
          if (active && result === PermissionsAndroid.RESULTS.GRANTED) publish();
        })
        .catch(() => {});
    }
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') publish();
    });
    return () => {
      active = false;
      subscription.remove();
    };
  }, [id, status, timer_seconds, timer_started_at, is_timer_running, halfSeconds, enabled, clockSynced]);

  useEffect(() => () => timer?.hide(), []);
}
