import { Platform } from 'react-native';
import { supabase } from '../supabaseClient';

export interface LoginLogPayload {
  organizationId: number;
  userEmail: string;
  userName?: string;
  userRole?: string;
}

export const logUserLogin = async (payload: LoginLogPayload) => {
  try {
    const deviceInfo = `${Platform.OS.toUpperCase()} (${Platform.Version})`;

    await supabase.from('user_login_logs').insert([
      {
        organization_id: payload.organizationId,
        user_email: payload.userEmail,
        user_name: payload.userName || 'Foydalanuvchi',
        user_role: payload.userRole || 'user',
        login_at: new Date().toISOString(),
        device_info: deviceInfo,
      },
    ]);
  } catch (err) {
    console.error('logUserLogin error:', err);
  }
};
