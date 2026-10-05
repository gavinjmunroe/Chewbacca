// Loaded into the agent engine with `node --import`, before its server starts.
//
// The engine's WebSocket on 127.0.0.1 accepts any Origin, so a web page open
// in the person's browser could connect to it and drive sessions, which run
// commands (security review, 2026-10-05). Browsers always send an Origin
// header on a WebSocket upgrade; Chewbacca's own client (bin/lib/realm_client.py)
// never does. So any upgrade that carries an Origin is refused before the
// server sees it. This patches the `ws` class the server imports, and leaves
// the upstream repo untouched.
import { createRequire } from "node:module";

const serverMain = process.env.CHEWBACCA_REALM_MAIN;
const require = createRequire(serverMain || import.meta.url);
const { WebSocketServer } = require("ws");

const handleUpgrade = WebSocketServer.prototype.handleUpgrade;
WebSocketServer.prototype.handleUpgrade = function guarded(
  req,
  socket,
  head,
  cb,
) {
  if (req.headers.origin !== undefined) {
    socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }
  return handleUpgrade.call(this, req, socket, head, cb);
};
