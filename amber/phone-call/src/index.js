import "dotenv/config";
import express from "express";
import { voiceRouter } from "./routes/voice.js";
import { audioRouter } from "./routes/audio.js";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.urlencoded({ extended: false }));
app.use(express.json());

app.get("/", (_req, res) => {
  res.json({
    service: "amber-phone-call",
    status: "ok",
    routes: [
      "/voice/incoming",
      "/voice/respond",
      "/voice/status",
      "/audio/:id",
    ],
  });
});

app.get("/health", (_req, res) => res.json({ ok: true }));

app.use("/voice", voiceRouter);
app.use("/audio", audioRouter);

app.use((err, _req, res, _next) => {
  console.error("[error]", err);
  res.status(500).json({ error: "internal_error" });
});

app.listen(PORT, () => {
  console.log(`amber-phone-call listening on :${PORT}`);
});
