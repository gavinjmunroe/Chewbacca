function extractChewbaccaBlock(text) {
  const m = text.match(/```chewbacca\s*([\s\S]*?)```/m);
  if (!m) return null;

  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}

window.extractChewbaccaBlock = extractChewbaccaBlock;
