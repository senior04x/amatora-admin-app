/**
 * YouTube OAuth Service for Amatora Admin App
 * 
 * Handles YouTube account linking with persistent token storage.
 * Tokens are stored in:
 *   1. AsyncStorage (local cache for quick access)
 *   2. Supabase organizations.yt_tokens (primary persistent storage)
 *   3. Supabase sponsors table (fallback cross-device storage)
 * 
 * This ensures tokens survive:
 *   - App logout/login
 *   - App uninstall/reinstall
 *   - Device changes
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
// 🔒 SECURITY FIX: supabase olib tashlandi, faqat supabase (anon + RLS) ishlatiladi
import { supabase } from '../supabaseClient';

// Google OAuth credentials — mobile uses PKCE OAuth flow without client secret
const GOOGLE_CLIENT_ID = '869594621568-f43saav9qgm76srbi5jfhonb92q7ubsl.apps.googleusercontent.com';
const GOOGLE_CLIENT_SECRET = '';

// YouTube API scopes
export const YT_SCOPES = [
  'https://www.googleapis.com/auth/youtube',
  'https://www.googleapis.com/auth/youtube.force-ssl',
  'https://www.googleapis.com/auth/youtube.upload',
];

export interface YtTokens {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
  expires_at?: number;
  scope?: string;
  token_type?: string;
  channel_info?: {
    title: string;
    thumbnail: string;
  } | null;
}

export interface YtChannelInfo {
  title: string;
  thumbnail: string;
}

// ─── AsyncStorage key helpers ────────────────────────────────────────
const getAsyncStorageKey = (orgId: number) => `@amatora_yt_tokens_${orgId}`;

// ─── Save Tokens ─────────────────────────────────────────────────────
export const saveYtTokens = async (
  orgId: number,
  tokens: any,
  channelInfo?: YtChannelInfo | null
): Promise<void> => {
  try {
    const expiresAt = tokens.expires_at || (Date.now() + (tokens.expires_in || 3600) * 1000);
    const dataToSave: YtTokens = {
      ...tokens,
      expires_at: expiresAt,
      channel_info: channelInfo || tokens.channel_info || null,
    };

    const payloadStr = JSON.stringify(dataToSave);

    // 1. Save to AsyncStorage for quick local access
    await AsyncStorage.setItem(getAsyncStorageKey(orgId), payloadStr);

    // 2. Persist to Supabase Storage (player-photos/configs/yt_tokens_${orgId}.json)
    try {
      const filePath = `configs/yt_tokens_${orgId}.json`;
      const { error } = await supabase.storage
        .from('player-photos')
        .upload(filePath, payloadStr, {
          contentType: 'application/json',
          upsert: true,
        });

      if (error) {
        console.warn('YT tokens: Supabase storage upload warning:', error);
      }
    } catch (e) {
      console.warn('YT tokens: Supabase storage upload failed:', e);
    }
  } catch (e) {
    console.error('Error saving YT tokens:', e);
  }
};

// ─── Get Tokens ──────────────────────────────────────────────────────
export const getYtTokens = async (orgId: number): Promise<YtTokens | null> => {
  // 1. Check AsyncStorage (local cache)
  try {
    const raw = await AsyncStorage.getItem(getAsyncStorageKey(orgId));
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.access_token || parsed?.refresh_token) {
        return parsed;
      }
    }
  } catch (e) {}

  // 2. Check Supabase Storage (player-photos/configs/yt_tokens_${orgId}.json)
  try {
    const filePath = `configs/yt_tokens_${orgId}.json`;
    const { data, error } = await supabase.storage
      .from('player-photos')
      .download(filePath);

    if (data && !error) {
      const text = await data.text();
      const parsed = JSON.parse(text);
      if (parsed) {
        // Cache locally for faster subsequent loads
        await AsyncStorage.setItem(getAsyncStorageKey(orgId), JSON.stringify(parsed));
        return parsed;
      }
    }
  } catch (err) {
    console.warn('YT tokens: Supabase storage download error:', err);
  }

  return null;
};

// ─── Exchange Authorization Code for Tokens ──────────────────────────
export const exchangeCodeForTokens = async (
  code: string,
  redirectUri: string,
  orgId: number
): Promise<YtTokens | null> => {
  try {
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }).toString(),
    });

    const data = await response.json();

    if (data.access_token) {
      // Fetch channel info immediately
      const channelInfo = await fetchYtChannelInfo(data.access_token);
      await saveYtTokens(orgId, data, channelInfo);
      return {
        ...data,
        expires_at: Date.now() + (data.expires_in || 3600) * 1000,
        channel_info: channelInfo,
      };
    } else {
      console.error('YouTube token exchange error:', data);
      return null;
    }
  } catch (err) {
    console.error('Error exchanging code for tokens:', err);
    return null;
  }
};

// ─── Get Valid Access Token (auto-refresh if expired) ────────────────
export const getValidAccessToken = async (orgId: number): Promise<string | null> => {
  const tokens = await getYtTokens(orgId);
  if (!tokens || !tokens.refresh_token) return null;

  // Check if current token is still valid (60 second buffer)
  if (tokens.access_token && tokens.expires_at && Date.now() < tokens.expires_at - 60000) {
    return tokens.access_token;
  }

  // Token expired — refresh it
  try {
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        refresh_token: tokens.refresh_token,
        grant_type: 'refresh_token',
      }).toString(),
    });

    const data = await response.json();

    if (data.access_token) {
      const updated: YtTokens = {
        ...tokens,
        access_token: data.access_token,
        expires_at: Date.now() + (data.expires_in || 3600) * 1000,
      };
      await saveYtTokens(orgId, updated, tokens.channel_info);
      return data.access_token;
    }
  } catch (err) {
    console.error('Error refreshing YT access token:', err);
  }

  return tokens?.access_token || null;
};

// ─── Fetch YouTube Channel Info ──────────────────────────────────────
export const fetchYtChannelInfo = async (accessToken: string): Promise<YtChannelInfo | null> => {
  try {
    const res = await fetch(
      'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true',
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    if (res.status === 401) {
      return null;
    }

    const data = await res.json();

    if (data.items && data.items.length > 0) {
      const ch = data.items[0].snippet;
      return {
        title: ch.title,
        thumbnail: ch.thumbnails?.default?.url || '',
      };
    }

    return null;
  } catch (e) {
    console.error('Error fetching YT channel info:', e);
    return null;
  }
};

// ─── Disconnect YouTube Account ──────────────────────────────────────
export const disconnectYouTube = async (orgId: number): Promise<void> => {
  // 1. Clear AsyncStorage
  try {
    await AsyncStorage.removeItem(getAsyncStorageKey(orgId));
  } catch (e) {}

  // 2. Remove from Supabase Storage (player-photos/configs/yt_tokens_${orgId}.json)
  try {
    const filePath = `configs/yt_tokens_${orgId}.json`;
    await supabase.storage
      .from('player-photos')
      .remove([filePath]);
  } catch (e) {
    console.warn('YT tokens: Supabase storage remove failed:', e);
  }
};

// ─── Load Channel Info for Current Org ───────────────────────────────
export const loadYtChannelForOrg = async (orgId: number): Promise<YtChannelInfo | null> => {
  const tokens = await getYtTokens(orgId);
  if (!tokens) return null;

  // Try cached channel_info first
  if (tokens.channel_info?.title) {
    return tokens.channel_info;
  }

  // Otherwise fetch from API
  const accessToken = await getValidAccessToken(orgId);
  if (!accessToken) return null;

  const channelInfo = await fetchYtChannelInfo(accessToken);

  // Save channel info to tokens
  if (channelInfo) {
    await saveYtTokens(orgId, tokens, channelInfo);
  }

  return channelInfo;
};
