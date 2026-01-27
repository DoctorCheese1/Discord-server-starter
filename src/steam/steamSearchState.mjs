const searches = new Map();
/*
  userId -> {
    results: [{ appid, name }],
    page: number,
    ts: number
  }
*/

export function saveSearch(userId, results, page = 0) {
  searches.set(userId, {
    results,
    page,
    ts: Date.now()
  });
}

export function getSearch(userId) {
  return searches.get(userId);
}

export function clearSearch(userId) {
  searches.delete(userId);
}
