const state = new Map();

export function saveSearch(userId, results, page = 0) {
  state.set(String(userId), {
    results: Array.isArray(results) ? results : [],
    page: Number(page) || 0,
    savedAt: Date.now()
  });
}

export function getSearch(userId) {
  return state.get(String(userId)) || null;
}

export function clearSearch(userId) {
  state.delete(String(userId));
}
