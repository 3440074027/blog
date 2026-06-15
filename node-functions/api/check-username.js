import { json, isValidUsername, userExistsFast, getRequestUrl } from './_lib/auth.js';
import { CACHE_HEADERS } from './_lib/db.js';

export async function onRequestGet(context){
  try{
    const url = getRequestUrl(context.request);
    const username = String(url.searchParams.get('username') || '').trim();

    if(!isValidUsername(username)){
      return json({
        ok:false,
        available:false,
        error:'用户名只能由字母和数字组成，长度 2 到 20 位。'
      }, 400);
    }

    const exists = await userExistsFast(username);
    return json({
      ok:true,
      available:!exists
    }, 200, CACHE_HEADERS.noStore);
  }catch(error){
    console.error('check-username error:', error);
    return json({ error:'用户名检查失败，请稍后再试。' }, 500);
  }
}

export function onRequest(){
  return json({ error:'只支持 GET 请求。' }, 405);
}
