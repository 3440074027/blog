/*
 * 数据库键 / 数据结构总览（Upstash Redis）
 * --------------------------------------------------
 * 所有数据库的键名、用途、值类型集中在此处，方便查看和修改。
 * 修改键名时请同步更新 auth.js / mail.js / articles.js / announcements.js / visitor-count.js 等使用方。
 *
 *  ┌─────────────── 用户 ───────────────┐
 *  user:<username>            string(JSON)  单个用户的资料 + 密码哈希 + profile
 *  site:user-index            set           所有注册用户名的集合（用于快速枚举与是否注册检查）
 *  users                      string(JSON)  历史遗留：旧版用户字典；新代码只读，按需迁移
 *
 *  ┌─────────────── 公告 ───────────────┐
 *  site:announcements         string(JSON)  公告数组（站主可编辑）
 *
 *  ┌─────────────── 文章 ───────────────┐
 *  site:article-index:v2      string(JSON)  文章元数据数组（用于列表）
 *  site:article:<id>          string(JSON)  单篇文章正文 + 完整数据
 *  site:articles              string(JSON)  历史遗留：旧版完整文章数组，仅在迁移时读取
 *
 *  ┌─────────────── 站内邮件 ───────────────┐
 *  mail:box:<username>        string(JSON)  用户的邮箱：{ inbox:[], sent:[], updatedAt }
 *  mail:inbox:<username>      string(JSON)  历史遗留：仅在 mail:box:* 不存在时读取一次以迁移
 *  mail:sent:<username>       string(JSON)  历史遗留：同上
 *
 *  ┌─────────────── 访问量 ───────────────┐
 *  site:visitor-count         string(int)   访问量计数器
 *
 *  ┌─────────────── 内容版本（用于跨用户实时同步） ───────────────┐
 *  site:version:announcements string(int)   公告每次写入 +1
 *  site:version:articles      string(int)   文章每次写入/删除 +1
 *  site:version:user:<username> string(int) 该用户资料每次更新 +1
 *  site:version:mail:<username> string(int) 该用户邮箱每次变化 +1
 */

// 用户
export const USER_KEY_PREFIX = 'user:';
export const USER_INDEX_KEY = 'site:user-index';
export const LEGACY_USER_STORE_KEY = 'users';
export const userKey = username => `${USER_KEY_PREFIX}${username}`;

// 公告
export const ANNOUNCEMENTS_KEY = 'site:announcements';

// 文章
export const ARTICLE_INDEX_KEY = 'site:article-index:v2';
export const ARTICLE_KEY_PREFIX = 'site:article:';
export const LEGACY_ARTICLES_KEY = 'site:articles';
export const articleKey = id => `${ARTICLE_KEY_PREFIX}${id}`;

// 邮件
export const MAILBOX_KEY_PREFIX = 'mail:box:';
export const LEGACY_INBOX_KEY_PREFIX = 'mail:inbox:';
export const LEGACY_SENT_KEY_PREFIX = 'mail:sent:';
export const mailboxKey = username => `${MAILBOX_KEY_PREFIX}${username}`;
export const legacyInboxKey = username => `${LEGACY_INBOX_KEY_PREFIX}${username}`;
export const legacySentKey = username => `${LEGACY_SENT_KEY_PREFIX}${username}`;

// 访问量
export const VISITOR_COUNT_KEY = 'site:visitor-count';

// 版本号（实时同步轮询使用）
export const VERSION_PREFIX = 'site:version:';
export const VERSION_KEYS = {
  announcements: `${VERSION_PREFIX}announcements`,
  articles: `${VERSION_PREFIX}articles`,
  user: username => `${VERSION_PREFIX}user:${username}`,
  mail: username => `${VERSION_PREFIX}mail:${username}`
};
