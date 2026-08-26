// localStore.js — client-side conversation store backed by localStorage. Replaces
// the server's in-memory store (server/store.js) when direct mode is on, so the
// app needs no Node backend to create, list, open, or persist conversations.
// Shapes mirror the server store 1:1 so App.jsx is unchanged.

const KEY = 'oda-conversations-v1';

function readAll() {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeAll(map) {
  try {
    localStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    /* quota / private mode — persistence is best-effort */
  }
}

function uuid() {
  return crypto.randomUUID?.() || `c-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Create a new conversation. Same shape as server store.createConversation. */
export function createConversation({ feature = 'chat' } = {}) {
  const now = new Date().toISOString();
  const conv = {
    id: uuid(),
    title: 'New chat',
    feature,
    createdAt: now,
    updatedAt: now,
    odSessionId: null,
    messages: [],
    wizard: null,
  };
  const map = readAll();
  map[conv.id] = conv;
  writeAll(map);
  return conv;
}

/** Full conversation (with messages), or null. */
export function getConversation(id) {
  return readAll()[id] || null;
}

/** Sidebar list: newest first, summary fields only (parity with server). */
export function listConversations() {
  return Object.values(readAll())
    .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
    .map(({ id, title, feature, createdAt, updatedAt }) => ({ id, title, feature, createdAt, updatedAt }));
}

/** Remove a conversation. */
export function deleteConversation(id) {
  const map = readAll();
  if (map[id]) {
    delete map[id];
    writeAll(map);
  }
}

/**
 * Persist the full message list for a conversation and derive its title from the
 * first user message (parity with the server's /api/chat title logic). Strips the
 * transient `live` flag before saving.
 */
export function saveConversation(id, messages, extra = {}) {
  const map = readAll();
  const conv = map[id];
  if (!conv) return;
  conv.messages = (messages || []).map(({ live, ...rest }) => rest);
  if (conv.title === 'New chat' || !conv.title) {
    const firstUser = (messages || []).find((m) => m.role === 'user' && (m.text || '').trim());
    if (firstUser) {
      const t = firstUser.text.trim();
      conv.title = t.slice(0, 48) + (t.length > 48 ? '…' : '');
    }
  }
  Object.assign(conv, extra);
  conv.updatedAt = new Date().toISOString();
  map[id] = conv;
  writeAll(map);
}
