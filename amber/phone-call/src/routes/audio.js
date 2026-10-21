import express from "express";
import { getAudio } from "../lib/audioCache.js";

export const audioRouter = express.Router();

audioRouter.get("/:id", (req, res) => {
  const entry = getAudio(req.params.id);
  if (!entry) return res.status(404).send("Not found");
  res.set("Content-Type", entry.contentType);
  res.set("Cache-Control", "no-store");
  res.set("Content-Length", String(entry.buffer.length));
  res.send(entry.buffer);
});
