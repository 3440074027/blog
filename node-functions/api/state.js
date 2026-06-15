import { json, redis, publicUser, getUser, verifyToken, nowIso } from './_lib/auth.js';
import { DB_KEYS, CACHE_HEADERS } from './_lib/db.js';

const MAIL_TTL_MS = 24 * 60 * 60 * 1000;

const DEFAULT_ANNOUNCEMENTS = [
  { id:'welcome', kicker:'✨ 星尘公告', title:'欢迎来到你的灵感档案馆', body:'这里会收纳文章、文件、灵感和成长记录。每一次登录，都是和未来的自己重逢。', updatedAt:'2026-06-13', image:'' },
  { id:'writing', kicker:'🌙 创作提醒', title:'把今天的想法留下来', body:'一段文字、一张配图、一次复盘，都可以成为下一篇博客的起点。', updatedAt:'2026-06-13', image:'' },
  { id:'roadmap', kicker:'💫 系统计划', title:'文章系统正在扩展', body:'后续会加入文章编辑、文件收纳、分类检索和独立文章详情页。', updatedAt:'2026-06-13', image:'' },
  { id:'profile', kicker:'🫧 温柔提示', title:'资料已和账号绑定', body:'头像、签名、简介和标签都可以同步保存，换设备登录也能继续显示。', updatedAt:'2026-06-13', image:'' },
  { id:'owner', kicker:'💌 站主小纸条', title:'如果迷路了，可以联系站主 An', body:'站主资料卡里会同步 QQ 和邮箱，点击联系站主就能快速查看。', updatedAt:'2026-06-13', image:'' },
  { id:'search', kicker:'🔎 搜索上线', title:'顶部搜索可以查找用户和文章', body:'输入用户名、标签或文章关键词，就能打开公开资料或定位内容。', updatedAt:'2026-06-13', image:'' }
];

function sanitizeAnnouncements(input){
  const items = (Array.isArray(input) ? input : [])
    .filter(item => item && typeof item === 'object')
    .slice(0, 12)
    .map((item, index)=>({
      id:String(item.id || `notice-${index + 1}`).slice(0, 80),
      kicker:String(item.kicker || '').slice(0, 60),
      title:String(item.title || '').slice(0, 80),
      body:String(item.body || '').slice(0, 500),
      updatedAt:String(item.updatedAt || nowIso().slice(0, 10)).slice(0, 40),
      image:String(item.image || '').startsWith('data:image/') ? String(item.image || '').slice(0, 700000) : ''
    }))
    .filter(item=>item.kicker || item.title || item.body);
  return items.length ? items : DEFAULT_ANNOUNCEMENTS;
}

function toArticleMeta(article){
  return {
    id:article.id,
    title:article.title,
    category:article.category,
    tags:Array.isArray(article.tags) ? article.tags : [],
    summary:article.summary,
    thumb:article.thumb,
    gallery:Array.isArray(article.gallery) ? article.gallery.slice(0, 5) : [],
    fontFamily:article.fontFamily || '',
    author:article.author,
    createdAt:article.createdAt,
    updatedAt:article.updatedAt
  };
}

async function readArticleIndex(){
  const index = await redis.get(DB_KEYS.articles.index);
  return Array.isArray(index)
    ? index.map(toArticleMeta).filter(item=>item.id && item.author).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)))
    : [];
}

function isExpired(mail){
  const created = Date.parse(mail.createdAt || '');
  return Number.isFinite(created) && Date.now() - created > MAIL_TTL_MS;
}

async function readMailbox(username){
  if(!username) return { inbox:[], sent:[] };
  const box = await redis.get(DB_KEYS.mail.box(username));
  let inbox = Array.isArray(box?.inbox) ? box.inbox.filter(item=>!isExpired(item)) : [];
  let sent = Array.isArray(box?.sent) ? box.sent.filter(item=>!isExpired(item)) : [];
  if(!box){
    const [legacyInbox, legacySent] = await Promise.all([
      redis.get(DB_KEYS.mail.legacyInbox(username)).catch(()=>[]),
      redis.get(DB_KEYS.mail.legacySent(username)).catch(()=>[])
    ]);
    inbox = Array.isArray(legacyInbox) ? legacyInbox.filter(item=>!isExpired(item)) : [];
    sent = Array.isArray(legacySent) ? legacySent.filter(item=>!isExpired(item)) : [];
  }
  return { inbox, sent };
}

async function readOptionalUser(request){
  const authorization = request.headers.get('authorization') || '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  const username = token ? verifyToken(token) : '';
  if(!username) return null;
  const user = await getUser(username);
  return user || null;
}

export async function onRequestGet(context){
  try{
    const user = await readOptionalUser(context.request);
    const [announcements, articles, mailbox] = await Promise.all([
      redis.get(DB_KEYS.announcements.list).then(value=>sanitizeAnnouncements(value || DEFAULT_ANNOUNCEMENTS)).catch(()=>DEFAULT_ANNOUNCEMENTS),
      readArticleIndex().catch(()=>[]),
      user ? readMailbox(user.username).catch(()=>({ inbox:[], sent:[] })) : Promise.resolve({ inbox:[], sent:[] })
    ]);
    return json({
      ok:true,
      updatedAt:nowIso(),
      user:user ? publicUser(user) : null,
      announcements,
      articles,
      mail:mailbox
    }, 200, CACHE_HEADERS.noStore);
  }catch(error){
    console.error('state get error:', error);
    return json({ error:'读取页面状态失败。' }, 500);
  }
}

export function onRequest(){
  return json({ error:'只支持 GET 请求。' }, 405);
}
