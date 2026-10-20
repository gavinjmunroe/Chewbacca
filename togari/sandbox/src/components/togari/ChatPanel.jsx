// src/components/togari/ChatPanel.jsx
import { useRef, useState } from "react";
import { apiFetch } from "../../lib/api.js";

export default function ChatPanel() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const nextId = useRef(0);

  function appendMessage(message) {
    const id = nextId.current++;
    setMessages((m) => [...m, { id, ...message }]);
  }

  async function send(e) {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    appendMessage({ role: "user", text });
    setBusy(true);
    try {
      const { answer } = await apiFetch("/api/togari/chat", {
        method: "POST",
        body: JSON.stringify({ message: text }),
      });
      appendMessage({ role: "togari", text: answer });
    } catch (err) {
      appendMessage({ role: "error", text: err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="dash-chat">
      <h2>Talk to Togari</h2>
      <div className="dash-chat__log">
        {messages.length === 0 && (
          <p className="dash-chat__hint">
            Ask about your data or tell Togari to update it. Example: "move Acme
            to proposal stage" or "who did we meet last week?"
          </p>
        )}
        {messages.map((m) => (
          <div
            key={m.id}
            className={`dash-chat__msg dash-chat__msg--${m.role}`}
          >
            {m.text}
          </div>
        ))}
        {busy && (
          <div className="dash-chat__msg dash-chat__msg--togari">
            Thinking...
          </div>
        )}
      </div>
      <form className="dash-chat__form" onSubmit={send}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Message Togari..."
          aria-label="Message Togari"
          disabled={busy}
        />
        <button type="submit" disabled={busy || !input.trim()}>
          Send
        </button>
      </form>
    </aside>
  );
}
