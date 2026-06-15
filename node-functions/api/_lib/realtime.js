import { redis, nowIso } from './auth.js';
import { DB_KEYS } from './db.js';

export async function touchRealtime(reason = 'update'){
  const value = `${Date.now()}:${reason}`;
  await redis.set(DB_KEYS.realtime.version, value);
  return value;
}

export async function getRealtimeVersion(){
  return String(await redis.get(DB_KEYS.realtime.version) || `0:${nowIso()}`);
}
