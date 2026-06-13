import crypto from 'crypto';
import { json, readJsonBody, requireUser, redis, nowIso } from './_lib/auth.js';

const articleKey = username => `articles:${username}`;
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

function sanitizeArticle(input = {}, username = ''){
  const content = String(input.content || '').trim().slice(0, 900000);
  const imageMatches = content.match(/data:image\/[^"')\s>]+/g) || [];
  for(const image of imageMatches){
    if(Buffer.byteLength(image, 'utf8') > MAX_IMAGE_BYTES * 1.38){
      const error = new Error('文章图片不能超过 3MB。');
      error.status = 400;
      throw error;
    }
  }
  const firstImage = imageMatches[0] || '';
  const plain = content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return {
    id: typeof input.id === 'string' && input.id ? input.id.slice(0, 80) : crypto.randomUUID(),
    owner: username,
    title: String(input.title || '未命名文章').trim().slice(0, 100),
    category: String(input.category || 'USER POST').trim().slice(0, 40),
    summary: String(input.summary || plain || '这是一篇新的用户文章。').trim().slice(0, 160),
    content,
    thumb: firstImage || String(input.thumb || 'linear-gradient(135deg,#7c5cff,#ff8fc7)').trim().slice(0, 1200),
    createdAt: typeof input.createdAt === 'string' ? input.createdAt : nowIso(),
    updatedAt: nowIso()
  };
}

async function readArticles(username){
  const items = await redis.get(articleKey(username));
  return Array.isArray(items) ? items : [];
}

export async function onRequestGet(context){
  const auth = await requireUser(context.request);
  if(auth.error) return json({ error:auth.error }, auth.status);
  try{
    const articles = await readArticles(auth.user.username);
    return json({ ok:true, articles });
  }catch(error){
    console.error('articles get error:', error);
    return json({ error:'读取文章失败。' }, 500);
  }
}

export async function onRequestPost(context){
  const auth = await requireUser(context.request);
  if(auth.error) return json({ error:auth.error }, auth.status);
  try{
    const body = await readJsonBody(context.request);
    const nextArticle = sanitizeArticle(body.article || body, auth.user.username);
    const articles = await readArticles(auth.user.username);
    articles.unshift(nextArticle);
    await redis.set(articleKey(auth.user.username), articles.slice(0, 80));
    return json({ ok:true, article:nextArticle, articles:articles.slice(0, 80) });
  }catch(error){
    console.error('articles post error:', error);
    return json({ error:error.message || '发布文章失败。' }, error.status || 500);
  }
}

export async function onRequestDelete(context){
  const auth = await requireUser(context.request);
  if(auth.error) return json({ error:auth.error }, auth.status);
  try{
    const body = await readJsonBody(context.request);
    const id = String(body.id || '').trim();
    if(!id) return json({ error:'缺少文章 ID。' }, 400);
    const articles = await readArticles(auth.user.username);
    const nextArticles = articles.filter(article => article.id !== id);
    await redis.set(articleKey(auth.user.username), nextArticles);
    return json({ ok:true, articles:nextArticles });
  }catch(error){
    console.error('articles delete error:', error);
    return json({ error:'删除文章失败。' }, 500);
  }
}

export function onRequest(){
  return json({ error:'只支持 GET、POST 或 DELETE 请求。' }, 405);
}
