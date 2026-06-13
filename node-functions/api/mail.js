import crypto from 'crypto';
import {
  json,
  readJsonBody,
  requireUser,
  getUser,
  redis,
  nowIso
} from './_lib/auth.js';

const inboxKey = username => `mail:inbox:${username}`;
const sentKey = username => `mail:sent:${username}`;

function sanitizeMail(mail){
  return {
    id: typeof mail.id === 'string' ? mail.id : crypto.randomUUID(),
    from: String(mail.from || '').trim().slice(0, 20),
    to: String(mail.to || '').trim().slice(0, 20),
    subject: String(mail.subject || '').trim().slice(0, 80),
    body: String(mail.body || '').trim().slice(0, 1200),
    createdAt: typeof mail.createdAt === 'string' ? mail.createdAt : nowIso(),
    read: Boolean(mail.read)
  };
}

async function readMailbox(key){
  const items = await redis.get(key);
  return Array.isArray(items) ? items.map(sanitizeMail) : [];
}

async function prependMailboxItem(key, item){
  const items = await readMailbox(key);
  items.unshift(item);
  await redis.set(key, items.slice(0, 100));
}

export async function onRequestGet(context){
  const auth = await requireUser(context.request);
  if(auth.error){
    return json({ error:auth.error }, auth.status);
  }
  try{
    const [inbox, sent] = await Promise.all([
      readMailbox(inboxKey(auth.user.username)),
      readMailbox(sentKey(auth.user.username))
    ]);
    return json({ ok:true, inbox, sent });
  }catch(error){
    console.error('mail get error:', error);
    return json({ error:'读取邮件失败。' }, 500);
  }
}

export async function onRequestPost(context){
  const auth = await requireUser(context.request);
  if(auth.error){
    return json({ error:auth.error }, auth.status);
  }
  try{
    const body = await readJsonBody(context.request);
    const to = String(body.to || '').trim();
    const target = await getUser(to);
    if(!target){
      return json({ error:'收件用户不存在，请检查用户名。' }, 404);
    }
    if(to === auth.user.username){
      return json({ error:'不能给自己发送站内邮件。' }, 400);
    }
    const mail = sanitizeMail({
      id: crypto.randomUUID(),
      from: auth.user.username,
      to: target.username,
      subject: body.subject || '来自博客站内信',
      body: body.body || '',
      createdAt: nowIso(),
      read: false
    });
    if(!mail.body){
      return json({ error:'邮件内容不能为空。' }, 400);
    }
    await Promise.all([
      prependMailboxItem(inboxKey(target.username), mail),
      prependMailboxItem(sentKey(auth.user.username), { ...mail, read:true })
    ]);
    return json({ ok:true, mail });
  }catch(error){
    console.error('mail send error:', error);
    return json({ error:'发送邮件失败。' }, 500);
  }
}

export function onRequest(){
  return json({ error:'只支持 GET 或 POST 请求。' }, 405);
}
