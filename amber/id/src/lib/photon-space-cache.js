// Reuse a confirmed DM space: dedicated-line space.create makes a remote
// chats.create call even for an existing conversation. Cache only routing data,
// never message content, and discard it when the Spectrum connection changes.
export function createPhotonSpaceCache({ maxSize = 1000 } = {}) {
  const spaces = new Map();
  return {
    clear() { spaces.clear(); },
    async get(key, create) {
      if (spaces.has(key)) return spaces.get(key);
      if (spaces.size >= maxSize) spaces.delete(spaces.keys().next().value);
      const pending = Promise.resolve().then(create);
      spaces.set(key, pending);
      try {
        return await pending;
      } catch (error) {
        if (spaces.get(key) === pending) spaces.delete(key);
        throw error;
      }
    },
  };
}
