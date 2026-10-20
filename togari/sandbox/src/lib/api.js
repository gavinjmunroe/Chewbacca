export async function apiFetch(path, options = {}) {
  const cred = localStorage.getItem("bma_google_cred");
  const res = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(cred ? { Authorization: `Bearer ${cred}` } : {}),
      ...(options.headers || {}),
    },
  });
  let body;
  try {
    body = await res.json();
  } catch {
    throw new Error(`Request failed (${res.status})`);
  }
  if (!res.ok || body.success === false) {
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  return body.data;
}
