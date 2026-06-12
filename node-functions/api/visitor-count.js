import { Redis } from '@upstash/redis';
import { json } from './_lib/auth.js';

const redis = Redis.fromEnv();
const VISITOR_COUNT_KEY = 'site:visitor-count';

export async function onRequestGet(){
  try{
    const value = Number(await redis.get(VISITOR_COUNT_KEY) || 0);
    return json({ ok:true, value });
  }catch(error){
    console.error('visitor-count get error:', error);
    return json({ error:'访问量统计失败。' }, 500);
  }
}

export async function onRequestPost(){
  try{
    const value = await redis.incr(VISITOR_COUNT_KEY);
    return json({ ok:true, value });
  }catch(error){
    console.error('visitor-count post error:', error);
    return json({ error:'访问量统计失败。' }, 500);
  }
}

export function onRequest(){
  return json({ error:'只支持 GET 或 POST 请求。' }, 405);
}
