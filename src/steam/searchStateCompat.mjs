const fallbackStore = new Map();

function fallbackGetSearch(userId) {
  return fallbackStore.get(userId) ?? null;
}

function fallbackSaveSearch(userId, results = [], page = 0) {
  fallbackStore.set(userId, {
    results: Array.isArray(results) ? results : [],
    page: Number.isFinite(Number(page)) ? Number(page) : 0,
    ts: Date.now()
  });
}

function fallbackClearSearch(userId) {
  fallbackStore.delete(userId);
}

let impl;

try {
  impl = await import('./steamSearchState.mjs');
} catch {
  impl = {
    getSearch: fallbackGetSearch,
    saveSearch: fallbackSaveSearch,
    clearSearch: fallbackClearSearch
  };
}

export function getSearch(userId) {
  return impl.getSearch(userId);
}

export function saveSearch(userId, results, page) {
  return impl.saveSearch(userId, results, page);
}

export function clearSearch(userId) {
  return impl.clearSearch(userId);
}
