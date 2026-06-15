export const DB_KEYS = {
  users: {
    legacyStore: 'users',
    prefix: 'user:',
    index: 'site:user-index',
    item: username => `user:${username}`
  },
  announcements: {
    list: 'site:announcements'
  },
  articles: {
    legacyList: 'site:articles',
    index: 'site:article-index:v2',
    prefix: 'site:article:',
    item: id => `site:article:${id}`
  },
  mail: {
    legacyInbox: username => `mail:inbox:${username}`,
    legacySent: username => `mail:sent:${username}`,
    box: username => `mail:box:${username}`
  },
  visitor: {
    count: 'site:visitor-count'
  },
  realtime: {
    version: 'site:realtime-version'
  }
};

export const CACHE_HEADERS = {
  noStore: {
    'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0'
  },
  shortJson: {
    'Cache-Control': 'private, max-age=2, stale-while-revalidate=5'
  }
};
