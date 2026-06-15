import {
  json,
  readJsonBody,
  requireUser,
  sanitizeUserProfile,
  setUser,
  publicUser,
  nowIso
} from '../_lib/auth.js';
import { touchRealtime } from '../_lib/realtime.js';

export async function onRequestPut(context){
  const auth = await requireUser(context.request);
  if(auth.error){
    return json({ error:auth.error }, auth.status);
  }
  try{
    const body = await readJsonBody(context.request);
    const nextProfile = sanitizeUserProfile(body.profile || {}, auth.user.username);
    auth.user.profile = nextProfile;
    auth.user.updatedAt = nowIso();
    await setUser(auth.user);
    await touchRealtime('profile');
    return json({ ok:true, user:publicUser(auth.user) });
  }catch(error){
    console.error('me-profile error:', error);
    return json({ error:'保存个人资料失败。' }, 500);
  }
}

export function onRequest(){
  return json({ error:'只支持 PUT 请求。' }, 405);
}
