export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function isValidUrl(url: string): boolean {
  try { new URL(url); return true; } catch { return false; }
}

export function isValidLinkedInUrl(url: string): boolean {
  return /^https:\/\/(www\.)?linkedin\.com\/in\/[\w-]+\/?$/.test(url);
}
