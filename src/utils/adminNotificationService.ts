// Admin Push Notification Dispatcher
// Connects to live Railway backend to send targeted Expo push notifications

const BACKEND_URL = 'https://web-production-eaa31.up.railway.app';

export const adminNotificationService = {
  /**
   * 1. Notify both teams when a match is created or rescheduled
   */
  notifyMatchScheduled: async (payload: {
    homeTeamId: string;
    awayTeamId: string;
    homeTeamName: string;
    awayTeamName: string;
    matchDate?: string;
    matchTime?: string;
    stadium?: string;
    matchId?: string;
    organizationId?: number;
  }) => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/notifications/match-scheduled`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      console.log('⚽ Match scheduled notification response:', data);
      return data;
    } catch (error) {
      console.warn('⚠️ Match push notification error:', error);
      return { success: false };
    }
  },

  /**
   * 2. Notify users when news is published
   */
  notifyNewsPublished: async (payload: {
    title: string;
    summary?: string;
    newsId?: string | number;
    organizationId?: number;
  }) => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/notifications/news-published`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      console.log('📰 News published notification response:', data);
      return data;
    } catch (error) {
      console.warn('⚠️ News push notification error:', error);
      return { success: false };
    }
  },

  /**
   * 3. Notify player when profile update request is approved / rejected
   */
  notifyProfileUpdateStatus: async (payload: {
    playerId: string;
    phone?: string;
    playerName?: string;
    status: 'approved' | 'rejected' | string;
    reason?: string;
  }) => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/notifications/profile-update-status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      console.log('👤 Profile update status notification response:', data);
      return data;
    } catch (error) {
      console.warn('⚠️ Profile update push notification error:', error);
      return { success: false };
    }
  },

  /**
   * 4. Notify player and team captains when a transfer is approved / rejected
   */
  notifyTransferStatus: async (payload: {
    playerId: string;
    playerName?: string;
    oldTeamId?: string;
    newTeamId?: string;
    oldTeamName?: string;
    newTeamName?: string;
    status: 'approved' | 'rejected' | string;
    playerPhone?: string;
  }) => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/notifications/transfer-status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      console.log('🔄 Transfer status notification response:', data);
      return data;
    } catch (error) {
      console.warn('⚠️ Transfer push notification error:', error);
      return { success: false };
    }
  },

  /**
   * 5. Notify organization when a new collab request is received
   */
  notifyCollabRequest: async (payload: {
    receiverOrgId: number;
    senderOrgName: string;
    leagueName: string;
    leagueId?: number | string;
  }) => {
    try {
      const { supabase } = require('../supabaseClient');
      // 1. Fetch push token for receiver organization
      const { data: orgData } = await supabase
        .from('organizations')
        .select('push_token')
        .eq('id', payload.receiverOrgId)
        .maybeSingle();

      const pushToken = orgData?.push_token;

      // 2. Send Expo push notification if token exists
      if (pushToken && pushToken.startsWith('ExponentPushToken')) {
        await fetch('https://exp.host/--/api/v2/push/send', {
          method: 'POST',
          headers: {
            'Accept': 'application/json',
            'Accept-encoding': 'gzip, deflate',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            to: pushToken,
            sound: 'default',
            title: '🤝 Yangi sherikchilik taklifi!',
            body: `"${payload.senderOrgName}" tashkiloti "${payload.leagueName}" ligasi bo'yicha sherikchilik taklifi yubordi.`,
            data: {
              type: 'collab_request',
              leagueId: payload.leagueId,
            },
          }),
        }).catch((err) => console.warn('Direct Expo push error:', err));
      }

      // 3. Fallback / supplementary backend notification endpoint
      fetch(`${BACKEND_URL}/api/notifications/collab-request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).catch(() => {});

      return { success: true };
    } catch (error) {
      console.warn('⚠️ Collab request push notification error:', error);
      return { success: false };
    }
  },

  /**
   * 6. Notify organization when collab status changes (accepted, rejected, disconnected)
   */
  notifyCollabStatus: async (payload: {
    targetOrgId: number;
    title: string;
    message: string;
    type: 'collab_accepted' | 'collab_rejected' | 'collab_disconnected';
    leagueName?: string;
  }) => {
    try {
      const { supabase } = require('../supabaseClient');
      // 1. Fetch push token for target organization
      const { data: orgData } = await supabase
        .from('organizations')
        .select('push_token')
        .eq('id', payload.targetOrgId)
        .maybeSingle();

      const pushToken = orgData?.push_token;

      // 2. Send Expo push notification if token exists
      if (pushToken && pushToken.startsWith('ExponentPushToken')) {
        await fetch('https://exp.host/--/api/v2/push/send', {
          method: 'POST',
          headers: {
            'Accept': 'application/json',
            'Accept-encoding': 'gzip, deflate',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            to: pushToken,
            sound: 'default',
            title: payload.title,
            body: payload.message,
            data: {
              type: payload.type,
            },
          }),
        }).catch((err) => console.warn('Direct Expo push error:', err));
      }

      return { success: true };
    } catch (error) {
      console.warn('⚠️ Collab status push notification error:', error);
      return { success: false };
    }
  },

  /**
   * Broadcast general notification
   */
  broadcast: async (payload: {
    title: string;
    body: string;
    organizationId?: number;
    data?: any;
  }) => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/notifications/broadcast`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      return await res.json();
    } catch (error) {
      console.warn('⚠️ Broadcast push notification error:', error);
      return { success: false };
    }
  },
};
