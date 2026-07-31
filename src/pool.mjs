export async function runPool(items, concurrency, worker, shouldStop = () => false) {
  const results = new Array(items.length);
  const limit = Math.min(items.length, Math.max(1, Math.floor(Number(concurrency) || 1)));
  let cursor = 0;

  async function run() {
    while (!shouldStop()) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: limit }, run));
  return results;
}
