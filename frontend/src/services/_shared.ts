// Shared helper for mock service adapters. Simulates network latency so
// loading states are exercised honestly during development, and gives every
// mock adapter one place to later become a real fetch.
export function mockDelay<T>(data: T, ms = 220): Promise<T> {
  return new Promise(resolve => setTimeout(() => resolve(data), ms))
}
