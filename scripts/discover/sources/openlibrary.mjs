// Open Library — API chính thức, không cần key. https://openlibrary.org/developers/api
import { fetchJson } from '../lib.mjs';

const BASE = 'https://openlibrary.org';

function toItem(w, i) {
  const key = w.key || (w.cover_edition_key ? `/books/${w.cover_edition_key}` : '');
  return {
    rank: i + 1,
    title: w.title,
    author: (w.author_name || []).slice(0, 2).join(', '),
    url: key ? `${BASE}${key}` : BASE,
    cover: w.cover_i ? `https://covers.openlibrary.org/b/id/${w.cover_i}-M.jpg` : undefined,
    year: w.first_publish_year,
    tags: (w.subject || []).slice(0, 3),
  };
}

async function trending(period, limit) {
  const data = await fetchJson(`${BASE}/trending/${period}.json?limit=${limit}`);
  const works = data.works || data.docs || [];
  if (!works.length) throw new Error(`trending/${period}: empty`);
  return works.slice(0, limit).map(toItem);
}

async function newest(limit) {
  const y = new Date().getUTCFullYear();
  const q = encodeURIComponent(`first_publish_year:[${y - 1} TO ${y}]`);
  const fields = 'key,title,author_name,cover_i,first_publish_year,subject';
  let data;
  try {
    data = await fetchJson(`${BASE}/search.json?q=${q}&sort=trending&limit=${limit}&fields=${fields}`);
  } catch {
    data = await fetchJson(`${BASE}/search.json?q=${q}&sort=new&limit=${limit}&fields=${fields}`);
  }
  return (data.docs || []).slice(0, limit).map(toItem);
}

export default {
  id: 'openlibrary',
  homepage: `${BASE}/trending/daily`,
  stability: 'stable',
  lang: 'en',
  async fetch() {
    const lists = [];
    lists.push({ id: 'hot', url: `${BASE}/trending/daily`, items: await trending('daily', 20) });
    try {
      lists.push({ id: 'new', url: `${BASE}/search?q=first_publish_year%3A%5B${new Date().getUTCFullYear() - 1}+TO+*%5D&sort=trending`, items: await newest(20) });
    } catch (e) {
      console.warn('[openlibrary] new:', e.message);
    }
    return lists;
  },
};
