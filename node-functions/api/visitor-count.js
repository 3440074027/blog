import { json, redis } from './_lib/auth.js';
import { DB_KEYS } from './_lib/db.js';

export async function onRequestGet(){
  try{
    const value = Number(await redis.get(DB_KEYS.visitor.count) || 0);
    return json({ ok:true, value });
  }catch(error){
    console.error('visitor-count get error:', error);
    return json({ error:'访问量统计失败。' }, 500);
  }
}

export async function onRequestPost(){
  try{
    const value = await redis.incr(DB_KEYS.visitor.count);
    return json({ ok:true, value });
  }catch(error){
    console.error('visitor-count post error:', error);
    return json({ error:'访问量统计失败。' }, 500);
  }
}

export function onRequest(){
  return json({ error:'只支持 GET 或 POST 请求。' }, 405);
}
