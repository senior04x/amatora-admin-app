import React, {useEffect,useRef,useState} from 'react';
import {View,Text,TouchableOpacity,Switch,ActivityIndicator,ScrollView,StyleSheet,Platform} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import {useTheme} from '../context/ThemeContext';
import {supabase} from '../supabaseClient';

type Team = {id:string;name:string;league:string|null;allowed:boolean};
export const TeamTransferAccess:React.FC<{orgId:number|null;windowOpen:boolean;windowBusy:boolean}> = ({orgId,windowOpen,windowBusy}) => {
 const {colors}=useTheme();
 const [open,setOpen]=useState(false),[league,setLeague]=useState(''),[cursor,setCursor]=useState<string|null>(null);
 const [teams,setTeams]=useState<Team[]>([]),[leagues,setLeagues]=useState<string[]>([]);
 const [loading,setLoading]=useState(false),[more,setMore]=useState(false),[error,setError]=useState('');
 const [busy,setBusy]=useState<Set<string>>(new Set()),[retry,setRetry]=useState(0);
 const version=useRef(0),operations=useRef(new Set<string>());
 useEffect(()=>{
  const current=++version.current;
  if(!open)return;
  setLoading(true);setError('');
  const load=async()=>{
   try{
    if(!orgId || !Number.isSafeInteger(orgId))throw new Error('INVALID_ORGANIZATION');
    const {data,error:rpcError}=await supabase.rpc('admin_team_transfer_access_page',{p_org:orgId,p_league:league||null,p_after:cursor});
    if(rpcError?.code==='PGRST202'||rpcError?.code==='42883')throw new Error('NOT_INSTALLED');
    if(rpcError || !Array.isArray(data?.items))throw new Error('LOAD_FAILED');
    if(current!==version.current)return;
    setTeams(data.items.slice(0,30));setMore(data.items.length>30);
    if(Array.isArray(data.leagues))setLeagues(data.leagues);
   }catch(error){
    if(current===version.current){setTeams([]);setMore(false);setError(error instanceof Error&&error.message==='NOT_INSTALLED'?'Jamoaviy transfer ruxsatlari serverda hali o‘rnatilmagan. Server yangilanishi kerak.':'Jamoalar yuklanmadi. Qayta urinib ko‘ring.');}
   }finally{if(current===version.current)setLoading(false);}
  };
  void load();return()=>{version.current++;};
 },[open,orgId,league,cursor,retry,windowOpen,windowBusy]);
 const setLeagueAccess=async(allowed:boolean)=>{
  if(!league||!windowOpen||windowBusy||operations.current.size)return;
  const current=version.current;operations.current.add('league');setBusy(new Set(operations.current));setError('');
  try{
   const {data,error:rpcError}=await supabase.rpc('admin_set_league_transfer_access',{p_org:orgId,p_league:league,p_allowed:allowed});
   if(rpcError||!Number.isInteger(data))throw new Error('SAVE_FAILED');
   if(current===version.current){setCursor(null);setRetry(value=>value+1);}
  }catch{if(current===version.current)setError('Liga ruxsati saqlanmadi. Qayta urinib ko‘ring.');}
  finally{operations.current.delete('league');setBusy(new Set(operations.current));}
 };
 const toggle=async(team:Team)=>{
  if(!windowOpen||windowBusy||operations.current.has('league')||operations.current.has(team.id))return;
  const current=version.current,allowed=!team.allowed;
  operations.current.add(team.id);setBusy(new Set(operations.current));setError('');
  setTeams(rows=>rows.map(row=>row.id===team.id?{...row,allowed}:row));
  try{
   const {data,error:rpcError}=await supabase.rpc('admin_set_team_transfer_access',{p_org:orgId,p_team:team.id,p_allowed:allowed});
   if(rpcError || data!==allowed)throw new Error('SAVE_FAILED');
  }catch{
   if(current===version.current){setTeams(rows=>rows.map(row=>row.id===team.id?{...row,allowed:team.allowed}:row));setError('Ruxsat saqlanmadi. Oldingi holat qaytarildi.');}
  }finally{operations.current.delete(team.id);setBusy(new Set(operations.current));}
 };
 const button=(label:string,action:()=>void,blocked=false)=><TouchableOpacity accessibilityRole="button" disabled={blocked||loading||windowBusy||busy.size>0} onPress={action} style={[styles.action,{opacity:blocked?0.45:1}]}><Text style={{color:colors.accentGreen}}>{label}</Text></TouchableOpacity>;
 return <View style={[styles.card,{backgroundColor:colors.bgCard,borderColor:colors.border}]}>
  <TouchableOpacity accessibilityRole="button" accessibilityState={{expanded:open}} onPress={()=>{setBusy(new Set(operations.current));setOpen(value=>!value);}} style={styles.heading}>
   <Text style={[styles.title,{color:colors.textPrimary}]}>Jamoalarga alohida ruxsat</Text>
   <Ionicons name={open?'chevron-up':'chevron-down'} size={18} color={colors.textSecondary}/>
  </TouchableOpacity>
  {open&&<View style={styles.body}>
   <Text style={[styles.hint,{color:colors.textSecondary}]}>Umumiy oyna ochilganda barcha jamoalar ochiladi, yopilganda hammasi yopiladi. Keyin liga yoki jamoa ruxsatini alohida o‘zgartiring.</Text>
   {!windowOpen&&<Text style={[styles.hint,{color:colors.textSecondary}]}>Ruxsat berish uchun avval umumiy transfer oynasini oching.</Text>}
   <Text style={[styles.hint,{color:colors.textPrimary}]}>Liga</Text>
   <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
    {['',...leagues].map(name=><TouchableOpacity key={name} accessibilityRole="button" accessibilityState={{selected:league===name}} disabled={busy.size>0} onPress={()=>{setLeague(name);setCursor(null);}}
     style={[styles.chip,{borderColor:league===name?colors.accentGreen:colors.border,backgroundColor:colors.bgCardElevated}]}>
     <Text style={{color:league===name?colors.accentGreen:colors.textSecondary}}>{name||'Barcha ligalar'}</Text>
    </TouchableOpacity>)}
   </ScrollView>
   {!!league&&<View style={styles.pages}>{button('Ligani ochish',()=>void setLeagueAccess(true),!windowOpen)}{button('Ligani yopish',()=>void setLeagueAccess(false),!windowOpen)}</View>}
   {!!error&&<View><Text accessibilityRole="alert" style={{color:colors.accentRed}}>{error}</Text>{button('Qayta urinish',()=>setRetry(value=>value+1))}</View>}
   {loading?<ActivityIndicator style={styles.loading} color={colors.accentGreen}/>:teams.length===0&&!error?<Text style={{color:colors.textSecondary}}>Jamoalar topilmadi.</Text>:teams.map(team=><View key={team.id} style={[styles.row,{borderBottomColor:colors.border}]}>
    <View style={styles.person}><Text style={{color:colors.textPrimary,fontWeight:'600'}}>{team.name}</Text><Text style={[styles.hint,{color:colors.textMuted}]}>{team.league||'Liga ko‘rsatilmagan'}</Text></View>
    <Switch accessibilityLabel={`${team.name}: o‘yinchi olishga ruxsat`} value={windowOpen&&team.allowed} disabled={!windowOpen||windowBusy||busy.has('league')||busy.has(team.id)} onValueChange={()=>void toggle(team)}
     trackColor={{false:colors.textMuted,true:colors.accentGreen}} thumbColor="#FFFFFF"/>
   </View>)}
   <View style={styles.pages}>{cursor&&button('Boshiga',()=>setCursor(null))}{more&&!loading&&button('Keyingi jamoalar',()=>setCursor(teams.at(-1)?.id??null))}</View>
  </View>}
 </View>;
};
const styles=StyleSheet.create({
 card:{borderWidth:1,borderRadius:Platform.OS==='android'?12:16,marginBottom:16,overflow:'hidden'},
 heading:{padding:16,flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:12},
 title:{fontSize:15,fontWeight:'600',flex:1},body:{paddingHorizontal:16,paddingBottom:12},hint:{fontSize:12,marginVertical:4},
 filters:{gap:8,paddingVertical:10},chip:{borderWidth:1,borderRadius:8,paddingHorizontal:12,paddingVertical:10},
 row:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',paddingVertical:10,borderBottomWidth:1,gap:12},
 person:{flex:1},pages:{flexDirection:'row',gap:16},action:{paddingVertical:12,minHeight:44},loading:{padding:16},
});
