/** Publish independent sources immediately. Failed refreshes never erase cached sections. */
export async function progressiveDay<T extends Record<string, unknown>>(options: {
  initial: T;
  sources: { [K in keyof T]: () => Promise<T[K]> };
  active: () => boolean;
  publish: (data: T) => void;
  failed: (key: keyof T) => void;
  settled?: (key: keyof T) => void;
}): Promise<{ data: T; ok: boolean }> {
  let data = { ...options.initial };
  let ok = true;
  await Promise.all(
    (Object.keys(options.sources) as (keyof T)[]).map(async (key) => {
      try {
        const value = await options.sources[key]();
        if (!options.active()) return;
        data = { ...data, [key]: value };
        options.publish(data);
      } catch {
        ok = false;
        if (options.active()) options.failed(key);
      } finally {
        if (options.active()) options.settled?.(key);
      }
    }),
  );
  return { data, ok };
}
