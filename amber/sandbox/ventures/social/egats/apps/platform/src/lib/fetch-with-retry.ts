export async function fetchWithRetry(
  url: string,
  options: RequestInit = {},
  maxRetries = 3,
  delay = 1000
): Promise<Response> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const res = await fetch(url, options);
      if (res.ok || res.status < 500) return res; // Don't retry client errors
      if (attempt < maxRetries - 1) await new Promise(r => setTimeout(r, delay * 2 ** attempt));
    } catch (err) {
      if (attempt === maxRetries - 1) throw err;
      await new Promise(r => setTimeout(r, delay * 2 ** attempt));
    }
  }
  throw new Error("Max retries exceeded");
}
