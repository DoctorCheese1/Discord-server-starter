const state = new Map();

const MAX_SEARCH_STATES = 200;
const SEARCH_TTL_MS = 30 * 60 * 1000;

function pruneState(now = Date.now()) {
  for (const [userId, entry] of state.entries()) {
    if (!entry?.savedAt || now - entry.savedAt > SEARCH_TTL_MS) {
      state.delete(userId);
    }
  }

  while (state.size > MAX_SEARCH_STATES) {
    const oldestKey = state.keys().next().value;
    if (!oldestKey) break;
    state.delete(oldestKey);
  }
}

export function saveSearch(userId, results, page = 0) {
  const now = Date.now();
  pruneState(now);

  state.set(String(userId), {
    results: Array.isArray(results) ? results : [],
    page: Number(page) || 0,
    savedAt: now
  });
}

export function getSearch(userId) {
  const now = Date.now();
  pruneState(now);

  const entry = state.get(String(userId));
  if (!entry) return null;

  if (!entry.savedAt || now - entry.savedAt > SEARCH_TTL_MS) {
    state.delete(String(userId));
    return null;
  }

  return entry;
}

export function clearSearch(userId) {
  state.delete(String(userId));
}
