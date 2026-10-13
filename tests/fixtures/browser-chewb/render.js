// Shared by the fake chat pages: turns a model's markdown into the code-block
// shape each site renders, so the extension sees what it sees on the real page.
window.__render = function (md, labelClass) {
  const out = document.createElement("div");
  const parts = md.split(/```(\w*)\n([\s\S]*?)```/);
  for (let i = 0; i < parts.length; i++) {
    if (i % 3 === 0) {
      if (parts[i].trim()) { const p = document.createElement("p"); p.textContent = parts[i]; out.append(p); }
    } else if (i % 3 === 1) {
      const pre = document.createElement("pre");
      const label = document.createElement("div");
      label.className = labelClass; label.textContent = parts[i] || "text";
      const code = document.createElement("code");
      code.className = "language-" + (parts[i] || "text");
      code.textContent = parts[i + 1];
      pre.append(label, code); out.append(pre); i++;
    }
  }
  return out;
};
