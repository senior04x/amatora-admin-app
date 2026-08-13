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
