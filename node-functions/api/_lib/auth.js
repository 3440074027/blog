import { Redis } from '@upstash/redis';
import crypto from 'crypto';
import {
  USER_KEY_PREFIX,
  USER_INDEX_KEY,
  LEGACY_USER_STORE_KEY,
  userKey,
  VERSION_KEYS
} from './db-keys.js';

export const redis = Redis.fromEnv();
const AUTH_SECRET = process.env.AUTH_SECRET || 'change-this-auth-secret-please';
export const SITE_OWNER_USERNAME = 'An';

export {
  USER_KEY_PREFIX,
  USER_INDEX_KEY,
  LEGACY_USER_STORE_KEY,
  userKey,
  VERSION_KEYS
};

export const defaultUserProfile = {
  avatar: '',
  nickname: '',
  signature: '',
  intro: '',
  tags: [],
  texts: {},
  files: [],
  articles: []
};

/* ------------------ 通用工具 ------------------ */
export function json(data, status = 200, extraHeaders = {}){
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...extraHeaders
    }
  });
}

export async function readJsonBody(request){
  if(!request) return {};
  if(request.body && typeof request.body === 'object' && !('getReader' in request.body)){
    return request.body;
  }
  if(typeof request.json === 'function'){
    try{
      return await request.json();
    }catch(_){}
  }
  if(typeof request.text === 'function'){
    try{
      const text = await request.text();
      return text ? JSON.parse(text) : {};
    }catch(_){}
  }
  return {};
}

export function getRequestUrl(request){
  return new URL(request.url || 'https://edgeone.local/');
}

export function nowIso(){
  return new Date().toISOString();
}

/* ------------------ 进程内短期缓存 ------------------
 * 在同一个 Worker 实例内复用 Redis 查询结果，避免重复网络往返。
 * Edge / Serverless 实例会被回收，所以 TTL 都很短 —— 只是为同一次冷启动后的多次调用加速。
 */
const _cache = new Map();
function cacheGet(key){
  const entry = _cache.get(key);
  if(!entry) return undefined;
  if(entry.expire && entry.expire < Date.now()){
    _cache.delete(key);
    return undefined;
  }
  return entry.value;
}
function cacheSet(key, value, ttlMs = 5000){
  _cache.set(key, { value, expire:Date.now() + ttlMs });
}
function cacheInvalidate(prefix){
  for(const key of _cache.keys()){
    if(key.startsWith(prefix)) _cache.delete(key);
  }
}

/* ------------------ 用户字典遗留兼容 ------------------ */
async function getLegacyUsers(){
  const cached = cacheGet('legacy-users');
  if(cached !== undefined) return cached;
  const users = await redis.get(LEGACY_USER_STORE_KEY);
  const value = users && typeof users === 'object' && !Array.isArray(users) ? users : {};
  cacheSet('legacy-users', value, 8000);
  return value;
}

async function setLegacyUsers(users){
  cacheInvalidate('legacy-users');
  await redis.set(LEGACY_USER_STORE_KEY, users);
}

/* ------------------ 用户存在性 / 读写 ------------------ */

// 仅判断“用户名是否被注册”，不读完整资料 —— 让注册时的可用性检查更快。
export async function userExists(username){
  if(!username) return false;
  const cacheKey = `exists:${username}`;
  const cached = cacheGet(cacheKey);
  if(cached !== undefined) return cached;

  // 优先用 SISMEMBER 命中索引（最便宜：返回 0/1）
  try{
    const inIndex = await redis.sismember(USER_INDEX_KEY, username);
    if(inIndex){
      cacheSet(cacheKey, true, 4000);
      return true;
    }
  }catch(error){
    console.error('userExists sismember error:', error);
  }
  // EXISTS 命中独立 user:<username> 键
  try{
    const exists = await redis.exists(userKey(username));
    if(exists){
      // 顺手把索引补回去
      try{ await redis.sadd(USER_INDEX_KEY, username); }catch(_){ }
      cacheSet(cacheKey, true, 4000);
      return true;
    }
  }catch(error){
    console.error('userExists redis exists error:', error);
  }
  // 旧版 users 字典兜底
  const legacy = await getLegacyUsers();
  const found = !!legacy[username];
  cacheSet(cacheKey, found, found ? 4000 : 1500);
  return found;
}

export async function getUser(username){
  if(!username) return null;
  const cacheKey = `user:${username}`;
  const cached = cacheGet(cacheKey);
  if(cached !== undefined) return cached;

  const user = await redis.get(userKey(username));
  if(user){
    cacheSet(cacheKey, user, 3000);
    return user;
  }

  const legacyUsers = await getLegacyUsers();
  const legacyUser = legacyUsers[username];
  if(legacyUser){
    await setUser(legacyUser);
    return legacyUser;
  }
  cacheSet(cacheKey, null, 1500);
  return null;
}

export function isSiteOwner(userOrUsername){
  const username = typeof userOrUsername === 'string' ? userOrUsername : userOrUsername?.username;
  return username === SITE_OWNER_USERNAME;
}

let _userListCache = null;
let _userListCacheAt = 0;
export async function listUsers({ ttlMs = 6000 } = {}){
  if(_userListCache && Date.now() - _userListCacheAt < ttlMs){
    return _userListCache;
  }
  const users = new Map();
  try{
    const indexedUsernames = await redis.smembers(USER_INDEX_KEY);
    if(Array.isArray(indexedUsernames) && indexedUsernames.length){
      // 用 mget 一次拉取，比逐个 get 快得多
      const keys = indexedUsernames.slice(0, 500).map(userKey);
      const values = keys.length ? await redis.mget(...keys) : [];
      values.forEach(user=>{
        if(user && user.username) users.set(user.username, user);
      });
    }
  }catch(error){
    console.error('list indexed users error:', error);
  }
  const legacyUsers = await getLegacyUsers();
  Object.values(legacyUsers).forEach(user=>{
    if(user && user.username && !users.has(user.username)) users.set(user.username, user);
  });
  _userListCache = Array.from(users.values());
  _userListCacheAt = Date.now();
  return _userListCache;
}

function invalidateListUsersCache(){
  _userListCache = null;
}

export async function setUser(user){
  // 一次 pipeline，避免多次往返
  try{
    await redis.multi()
      .set(userKey(user.username), user)
      .sadd(USER_INDEX_KEY, user.username)
      .exec();
  }catch(error){
    // 兜底：单独执行
    await redis.set(userKey(user.username), user);
    try{ await redis.sadd(USER_INDEX_KEY, user.username); }catch(_){ }
    console.error('setUser pipeline error:', error);
  }
  cacheInvalidate(`user:${user.username}`);
  cacheInvalidate(`exists:${user.username}`);
  invalidateListUsersCache();
  await bumpUserVersion(user.username);
}

export async function deleteUser(username){
  try{
    await redis.multi()
      .del(userKey(username))
      .srem(USER_INDEX_KEY, username)
      .exec();
  }catch(error){
    await redis.del(userKey(username));
    try{ await redis.srem(USER_INDEX_KEY, username); }catch(_){ }
    console.error('deleteUser pipeline error:', error);
  }
  const legacyUsers = await getLegacyUsers();
  if(legacyUsers[username]){
    delete legacyUsers[username];
    await setLegacyUsers(legacyUsers);
  }
  cacheInvalidate(`user:${username}`);
  cacheInvalidate(`exists:${username}`);
  invalidateListUsersCache();
  await bumpUserVersion(username);
}

export async function renameUser(user, nextUsername){
  const previousUsername = user.username;
  user.username = nextUsername;
  if(user.profile && (!user.profile.nickname || user.profile.nickname === previousUsername)){
    user.profile.nickname = nextUsername;
  }
  user.updatedAt = nowIso();
  await redis.set(userKey(nextUsername), user);
  try{ await redis.sadd(USER_INDEX_KEY, nextUsername); }catch(_){ }
  if(previousUsername !== nextUsername){
    try{
      await redis.multi()
        .del(userKey(previousUsername))
        .srem(USER_INDEX_KEY, previousUsername)
        .exec();
    }catch(_){
      await redis.del(userKey(previousUsername));
      try{ await redis.srem(USER_INDEX_KEY, previousUsername); }catch(_){ }
    }
    const legacyUsers = await getLegacyUsers();
    if(legacyUsers[previousUsername]){
      delete legacyUsers[previousUsername];
      await setLegacyUsers(legacyUsers);
    }
  }
  cacheInvalidate(`user:${previousUsername}`);
  cacheInvalidate(`user:${nextUsername}`);
  cacheInvalidate(`exists:${previousUsername}`);
  cacheInvalidate(`exists:${nextUsername}`);
  invalidateListUsersCache();
  await Promise.all([bumpUserVersion(previousUsername), bumpUserVersion(nextUsername)]);
  return user;
}

/* ------------------ 校验 / 加密 ------------------ */
export function isValidUsername(username){
  return /^[A-Za-z0-9]{2,20}$/.test(username);
}

export function isValidPassword(password){
  return (
    typeof password === 'string' &&
    password.length >= 6 &&
    password.length <= 64 &&
    /^[A-Za-z0-9!@#$%^&*_\-+=.?]+$/.test(password)
  );
}

export function sanitizeAvatar(avatar){
  if(typeof avatar !== 'string' || !avatar.trim()) return '';
  const value = avatar.trim();
  if(!/^data:image\/(png|jpe?g|gif|webp);base64,/i.test(value)) return '';
  if(Buffer.byteLength(value, 'utf8') > 500_000) return '';
  return value;
}

export function sanitizeUserProfile(input = {}, username = ''){
  const tags = Array.isArray(input.tags)
    ? input.tags.map(tag=>String(tag).trim()).filter(Boolean).slice(0, 12).map(tag=>tag.slice(0, 24))
    : [];
  const texts = input.texts && typeof input.texts === 'object' && !Array.isArray(input.texts)
    ? Object.fromEntries(
        Object.entries(input.texts)
          .filter(([key, value]) => typeof key === 'string' && typeof value === 'string')
          .slice(0, 50)
          .map(([key, value]) => [key.slice(0, 50), value.slice(0, 1000)])
      )
    : {};
  const files = Array.isArray(input.files)
    ? input.files
        .filter(file => file && typeof file === 'object' && !Array.isArray(file))
        .slice(0, 50)
        .map(file => ({
          id: typeof file.id === 'string' ? file.id.slice(0, 80) : crypto.randomUUID(),
          name: typeof file.name === 'string' ? file.name.trim().slice(0, 120) : '',
          type: typeof file.type === 'string' ? file.type.trim().slice(0, 80) : '',
          size: Number.isFinite(Number(file.size)) ? Math.max(0, Number(file.size)) : 0,
          url: typeof file.url === 'string' ? file.url.trim().slice(0, 1000) : '',
          createdAt: typeof file.createdAt === 'string' ? file.createdAt.slice(0, 40) : nowIso()
        }))
        .filter(file => file.name || file.url)
    : [];
  return {
    avatar: sanitizeAvatar(input.avatar),
    nickname: typeof input.nickname === 'string' ? input.nickname.trim().slice(0, 40) : username,
    signature: typeof input.signature === 'string' ? input.signature.trim().slice(0, 120) : '',
    intro: typeof input.intro === 'string' ? input.intro.trim().slice(0, 500) : '',
    tags,
    texts,
    files,
    articles: []
  };
}

export function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')){
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}

export function verifyPassword(password, passwordData){
  if(!passwordData || !passwordData.salt || !passwordData.hash) return false;
  const current = hashPassword(password, passwordData.salt).hash;
  return crypto.timingSafeEqual(Buffer.from(current, 'hex'), Buffer.from(passwordData.hash, 'hex'));
}

export function publicUser(user){
  const profile = {
    ...defaultUserProfile,
    nickname: user.username,
    ...(user.profile || {}),
    articles: []
  };
  return {
    id: user.id,
    username: user.username,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    profile
  };
}

function base64Url(input){
  return Buffer.from(input).toString('base64url');
}

export function createToken(username){
  const payload = base64Url(JSON.stringify({ username, iat:Date.now() }));
  const signature = crypto.createHmac('sha256', AUTH_SECRET).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

export function verifyToken(token){
  if(typeof token !== 'string' || !token.includes('.')) return '';
  const [payload, signature] = token.split('.');
  const expected = crypto.createHmac('sha256', AUTH_SECRET).update(payload).digest('base64url');
  if(Buffer.byteLength(signature) !== Buffer.byteLength(expected)) return '';
  if(!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return '';
  try{
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return typeof data.username === 'string' ? data.username : '';
  }catch(_){
    return '';
  }
}

export async function requireUser(request){
  const authorization = request.headers.get('authorization') || '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  const username = verifyToken(token);
  if(!username) return { error:'请先登录。', status:401 };
  const user = await getUser(username);
  if(!user) return { error:'账号不存在，请重新登录。', status:401 };
  return { user };
}

/* ------------------ 版本号 / 实时同步 ------------------ */
export async function bumpVersion(key){
  try{
    return await redis.incr(key);
  }catch(error){
    console.error('bumpVersion error:', key, error);
    return 0;
  }
}

export async function bumpAnnouncementsVersion(){
  return bumpVersion(VERSION_KEYS.announcements);
}

export async function bumpArticlesVersion(){
  return bumpVersion(VERSION_KEYS.articles);
}

export async function bumpUserVersion(username){
  if(!username) return 0;
  return bumpVersion(VERSION_KEYS.user(username));
}

export async function bumpMailVersion(username){
  if(!username) return 0;
  return bumpVersion(VERSION_KEYS.mail(username));
}

export async function readVersion(key){
  try{
    const value = await redis.get(key);
    const num = Number(value);
    return Number.isFinite(num) ? num : 0;
  }catch(error){
    console.error('readVersion error:', key, error);
    return 0;
  }
}

export async function readVersions(keys){
  if(!keys || !keys.length) return [];
  try{
    const values = await redis.mget(...keys);
    return values.map(value=>{
      const num = Number(value);
      return Number.isFinite(num) ? num : 0;
    });
  }catch(error){
    console.error('readVersions error:', error);
    return keys.map(()=>0);
  }
}
