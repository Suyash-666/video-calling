import { supabase } from '@/lib/supabase';
const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
async function req<T>(path:string, init:RequestInit={}):Promise<T>{
  const {data,error}=await supabase.auth.getSession();
  if(error||!data.session?.access_token) throw new Error('Please sign in first.');
  const res=await fetch(`${API}${path}`,{...init,headers:{'Content-Type':'application/json',Authorization:`Bearer ${data.session.access_token}`,...init.headers}});
  const body=await res.json().catch(()=>({}));
  if(!res.ok) throw new Error(body.message||'Request failed');
  return body as T;
}
export type MeetingReport={meeting:{id:string;title:string;room_code:string;starts_at:string;duration_minutes:number};attendance:Array<{id:string;user_id:string;display_name:string;joined_at:string;left_at:string|null}>;recordings:Array<{id:string;file_name:string;storage_path:string;duration_seconds:number;created_at:string}>;summary:{attendanceSessions:number;uniqueParticipants:number;activeParticipants:number;messageCount:number;totalParticipantMinutes:number}};
export const getReport=(id:string)=>req<MeetingReport>(`/workspace/meetings/${encodeURIComponent(id)}/report`);
export const getReminders=()=>req<any[]>('/workspace/reminders');
export const addReminder=(meetingId:string,remindAt:string)=>req('/workspace/reminders',{method:'POST',body:JSON.stringify({meetingId,remindAt})});
export const removeReminder=(id:string)=>req(`/workspace/reminders/${encodeURIComponent(id)}`,{method:'DELETE'});
