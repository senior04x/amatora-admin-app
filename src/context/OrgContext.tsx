import React, { createContext, useContext, useState, useEffect } from 'react';
import { AppState } from 'react-native';
import { supabase, supabaseAdmin } from '../supabaseClient';

interface OrgContextType {
  orgId: number;
  currentOrg: any;
  loading: boolean;
  transferWindowOpen: boolean;
  setTransferWindowOpen: (val: boolean) => void;
  toggleTransferWindow: (val: boolean) => Promise<void>;
  isRegistrationOpen: boolean;
  setIsRegistrationOpen: (val: boolean) => void;
  toggleRegistrationStatus: (val: boolean) => Promise<void>;
  refreshOrg: () => Promise<void>;
  collabLeagueIds: number[];
  collabLeagueNames: string[];
}

const OrgContext = createContext<OrgContextType | null>(null);

export const useOrg = () => {
  const ctx = useContext(OrgContext);
  if (!ctx) throw new Error('useOrg must be used within OrgProvider');
  return ctx;
};

export const OrgProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [orgId, setOrgId] = useState<number>(1);
  const [currentOrg, setCurrentOrg] = useState<any>({ name: 'Havas Futbol Ligasi', id: 1 });
  const [loading, setLoading] = useState(true);
  const [transferWindowOpen, setTransferWindowOpen] = useState<boolean>(false);
  const [isRegistrationOpen, setIsRegistrationOpen] = useState<boolean>(true);
  const [collabLeagueIds, setCollabLeagueIds] = useState<number[]>([]);
  const [collabLeagueNames, setCollabLeagueNames] = useState<string[]>([]);

  const fetchOrg = async () => {
    try {
      const dbClient = supabaseAdmin || supabase;
      let targetOrgId = orgId || 1;

      // 0. Get user session to find their true organization
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user?.email) {
        const { data: userOrg } = await dbClient
          .from('organizations')
          .select('id')
          .eq('admin_email', session.user.email)
          .single();
        
        if (userOrg?.id) {
          targetOrgId = userOrg.id;
          if (targetOrgId !== orgId) {
            setOrgId(targetOrgId);
          }
        }
      }

      // 1. Fetch organization record
      const { data } = await dbClient
        .from('organizations')
        .select('*')
        .eq('id', targetOrgId)
        .maybeSingle();

      if (data) {
        // Merge data
        const mergedOrg = {
          ...data,
          email: data.admin_email || data.email || '',
          phone: data.contact_phone || data.phone || '',
        };

        setCurrentOrg(mergedOrg);
        if (data.transfer_window_open !== null && data.transfer_window_open !== undefined) {
          setTransferWindowOpen(!!data.transfer_window_open);
        }
      }

      // 3. Fetch registration status from sponsors KV table (web admin primary storage key)
      const { data: spReg } = await dbClient
        .from('sponsors')
        .select('logo_url')
        .in('name', [`REGISTRATION_OPEN_${targetOrgId}`, 'REGISTRATION_OPEN_1', 'REGISTRATION_OPEN'])
        .order('id', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (spReg && spReg.logo_url !== null && spReg.logo_url !== undefined) {
        setIsRegistrationOpen(spReg.logo_url === 'true');
      } else if (data && data.is_registration_open !== null && data.is_registration_open !== undefined) {
        setIsRegistrationOpen(!!data.is_registration_open);
      }

      // 4. Fetch Collab Leagues
      try {
        const { data: myCollabs } = await dbClient
          .from('league_collabs')
          .select('league_id, leagues(name)')
          .eq('status', 'accepted')
          .or(`sender_org_id.eq.${targetOrgId},receiver_org_id.eq.${targetOrgId}`);

        if (myCollabs && myCollabs.length > 0) {
          const ids = myCollabs.map((c: any) => c.league_id).filter(Boolean);
          const names = myCollabs.map((c: any) => c.leagues?.name).filter(Boolean);
          setCollabLeagueIds(ids);
          setCollabLeagueNames(names);
        } else {
          setCollabLeagueIds([]);
          setCollabLeagueNames([]);
        }
      } catch (err) {
        console.error('Collab leagues error:', err);
      }
    } catch (err) {
      console.error('Org load error:', err);
    } finally {
      setLoading(false);
    }
  };

  const toggleTransferWindow = async (val: boolean) => {
    setTransferWindowOpen(val);
    try {
      const dbClient = supabaseAdmin || supabase;
      await dbClient.from('organizations').update({ transfer_window_open: val }).eq('id', orgId || 1);
    } catch (err) {
      console.error('Toggle transfer error:', err);
    }
  };

  const toggleRegistrationStatus = async (val: boolean) => {
    setIsRegistrationOpen(val);
    try {
      const dbClient = supabaseAdmin || supabase;

      // 1. Update organizations table
      await dbClient.from('organizations').update({ is_registration_open: val }).eq('id', orgId || 1);

      // 2. Update sponsors table KV keys used by web admin
      const keysToUpdate = [`REGISTRATION_OPEN_${orgId || 1}`, `REGISTRATION_OPEN_1`, `REGISTRATION_OPEN`];
      for (const key of keysToUpdate) {
        const { data: ex } = await dbClient.from('sponsors').select('id').eq('name', key).maybeSingle();
        if (ex) {
          await dbClient.from('sponsors').update({ logo_url: val ? 'true' : 'false' }).eq('id', ex.id);
        } else {
          await dbClient.from('sponsors').insert({ name: key, logo_url: val ? 'true' : 'false' });
        }
      }
    } catch (err) {
      console.error('Toggle reg status error:', err);
    }
  };

  useEffect(() => {
    fetchOrg();

    // Single fluent chain for Realtime listeners
    const targetOrgId = orgId || 1;
    const channel = supabase
      .channel(`app_rt_status_${targetOrgId}_${Date.now()}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'organizations' },
        (payload: any) => {
          if (payload.new) {
            if (payload.new.is_registration_open !== null && payload.new.is_registration_open !== undefined) {
              setIsRegistrationOpen(!!payload.new.is_registration_open);
            }
            if (payload.new.transfer_window_open !== null && payload.new.transfer_window_open !== undefined) {
              setTransferWindowOpen(!!payload.new.transfer_window_open);
            }
          }
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'sponsors' },
        (payload: any) => {
          if (payload.new && payload.new.name && payload.new.name.startsWith('REGISTRATION_OPEN')) {
            setIsRegistrationOpen(payload.new.logo_url === 'true');
          }
        }
      );

    channel.subscribe();

    let appStateSub: any = null;
    if (typeof AppState !== 'undefined' && AppState && AppState.addEventListener) {
      try {
        appStateSub = AppState.addEventListener('change', (nextAppState) => {
          if (nextAppState === 'active') {
            fetchOrg();
          }
        });
      } catch (e) {}
    }

    return () => {
      try {
        supabase.removeChannel(channel);
      } catch (e) {}
      if (appStateSub && appStateSub.remove) {
        try {
          appStateSub.remove();
        } catch (e) {}
      }
    };
  }, [orgId]);

  return (
    <OrgContext.Provider
      value={{
        orgId,
        currentOrg,
        loading,
        transferWindowOpen,
        setTransferWindowOpen,
        toggleTransferWindow,
        isRegistrationOpen,
        setIsRegistrationOpen,
        toggleRegistrationStatus,
        refreshOrg: fetchOrg,
        collabLeagueIds,
        collabLeagueNames,
      }}
    >
      {children}
    </OrgContext.Provider>
  );
};
