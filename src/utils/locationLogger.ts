import * as Location from 'expo-location';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, supabaseAdmin } from '../supabaseClient';

export interface LocationLogPayload {
  organizationId: number;
  userEmail: string;
  userName?: string;
  userRole?: string;
}

export const logUserLoginWithLocation = async (payload: LocationLogPayload) => {
  try {
    const dbClient = supabaseAdmin || supabase;
    let latitude: number | null = null;
    let longitude: number | null = null;
    let locationAddress: string = "Joylashuv aniqlanmadi";

    // 1. Request location permissions
    const { status } = await Location.requestForegroundPermissionsAsync();
    
    if (status === 'granted') {
      try {
        const location = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });

        latitude = location.coords.latitude;
        longitude = location.coords.longitude;

        // Reverse geocode to get city / street
        try {
          const geocode = await Location.reverseGeocodeAsync({ latitude, longitude });
          if (geocode && geocode.length > 0) {
            const place = geocode[0];
            const addressParts = [
              place.city || place.subregion || place.region,
              place.street || place.name,
              place.country,
            ].filter(Boolean);

            locationAddress = addressParts.length > 0 ? addressParts.join(', ') : `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
          } else {
            locationAddress = `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
          }
        } catch (geoErr) {
          locationAddress = `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
        }
      } catch (posErr) {
        console.warn('Get position note:', posErr);
        locationAddress = "Joylashuv ruxsati bor, lekin GPS aniqlanmadi";
      }
    } else {
      locationAddress = "Joylashuv ruxsati rad etildi";
    }

    const deviceInfo = `${Platform.OS.toUpperCase()} (${Platform.Version})`;

    // 2. Insert into user_login_logs table
    await dbClient.from('user_login_logs').insert([
      {
        organization_id: payload.organizationId,
        user_email: payload.userEmail,
        user_name: payload.userName || 'Foydalanuvchi',
        user_role: payload.userRole || 'user',
        login_at: new Date().toISOString(),
        latitude,
        longitude,
        location_address: locationAddress,
        device_info: deviceInfo,
      },
    ]);
  } catch (err) {
    console.error('logUserLoginWithLocation error:', err);
  }
};
