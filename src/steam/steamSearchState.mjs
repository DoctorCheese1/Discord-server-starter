const state = new Map();

export function saveSearch(userId, results, page = 0, query = '') {
  state.set(String(userId), {
    results: Array.isArray(results) ? results : [],
    page: Number(page) || 0,
    query: String(query || ''),
    savedAt: Date.now()
  });
}

export function getSearch(userId) {
  return state.get(String(userId)) || null;
}

export function clearSearch(userId) {
  state.delete(String(userId));
}
