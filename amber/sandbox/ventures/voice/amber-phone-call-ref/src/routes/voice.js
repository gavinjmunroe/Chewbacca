import express from "express";
import twilio from "twilio";
import { askAmber, endSession } from "../lib/brain.js";
import { synthesize } from "../lib/tts.js";
import { putAudio } from "../lib/audioCache.js";

const { twiml: Twiml, validateRequest } = twilio;

export const voiceRouter = express.Router();

function verifyTwilio(req, res, next) {
  if (process.env.SKIP_TWILIO_SIGNATURE === "true") return next();

  const signature = req.header("X-Twilio-Signature");
  const url = `${process.env.PUBLIC_URL}${req.originalUrl}`;
  const valid = validateRequest(
    process.env.TWILIO_AUTH_TOKEN,
    signature,
    url,
    req.body,
  );
  if (!valid) {
    console.warn("[voice] rejected: invalid Twilio signature");
    return res.status(403).send("Forbidden");
  }
  return next();
}

function baseUrl() {
  return process.env.PUBLIC_URL || "";
}

// Attach a Gather for speech input. Twilio transcribes what the
// caller says and POSTs it to /voice/respond.
function gatherSpeech(voice) {
  voice.gather({
    input: "speech",
    action: "/voice/respond",
    method: "POST",
    speechTimeout: "auto",
    speechModel: "phone_call",
    language: "en-US",
    actionOnEmptyResult: true,
  });
  return voice;
}

async function playReply(voice, text) {
  try {
    const { audio, contentType } = await synthesize(text);
    const id = putAudio(audio, contentType);
    voice.play(`${baseUrl()}/audio/${id}`);
  } catch (err) {
    console.error("[voice] tts failed, falling back to Say", err.message);
    voice.say({ voice: "Polly.Joanna" }, text);
  }
}

// Twilio hits this when a call comes in. Greet the caller in Amber's
// voice, then open a Gather loop.
voiceRouter.post("/incoming", verifyTwilio, async (req, res, next) => {
  try {
    const { From, CallSid } = req.body;
    console.log("[voice] incoming call", { CallSid, from: From });

    const voice = new Twiml.VoiceResponse();
    await playReply(voice, "Hey Caleb, it's Amber. What's up?");
    gatherSpeech(voice);
    // If gather never fires (silence), loop back to gather once more
    // before hanging up.
    voice.redirect({ method: "POST" }, "/voice/respond");

    res.type("text/xml").send(voice.toString());
  } catch (err) {
    next(err);
  }
});

// Twilio posts here with SpeechResult after the caller finishes talking.
// We ask Amber, TTS the reply, play it, and gather again.
voiceRouter.post("/respond", verifyTwilio, async (req, res, next) => {
  try {
    const { CallSid, From, SpeechResult, Confidence } = req.body;
    console.log("[voice] respond", {
      CallSid,
      confidence: Confidence,
      length: SpeechResult?.length || 0,
    });

    const voice = new Twiml.VoiceResponse();

    if (!SpeechResult || SpeechResult.trim().length === 0) {
      await playReply(voice, "Still there? I didn't catch that.");
      gatherSpeech(voice);
      voice.redirect({ method: "POST" }, "/voice/respond");
      return res.type("text/xml").send(voice.toString());
    }

    const reply = await askAmber({
      callSid: CallSid,
      caller: From,
      userText: SpeechResult.trim(),
    });

    await playReply(voice, reply);
    gatherSpeech(voice);
    voice.redirect({ method: "POST" }, "/voice/respond");

    res.type("text/xml").send(voice.toString());
  } catch (err) {
    // Never hang up on the caller. Apologize, then Gather again so they
    // can try another turn.
    console.error("[voice] respond error", err.message);
    const voice = new Twiml.VoiceResponse();
    try {
      await playReply(
        voice,
        "Hold on, I lost my train of thought. Say that again?",
      );
    } catch {
      voice.say(
        { voice: "Polly.Joanna" },
        "Hold on, I lost my train of thought. Say that again?",
      );
    }
    gatherSpeech(voice);
    voice.redirect({ method: "POST" }, "/voice/respond");
    res.type("text/xml").send(voice.toString());
  }
});

// Call lifecycle callback. Clear conversation memory when the call ends.
voiceRouter.post("/status", verifyTwilio, (req, res) => {
  const { CallSid, CallStatus, CallDuration } = req.body;
  console.log("[voice] status", { CallSid, CallStatus, CallDuration });
  if (["completed", "failed", "canceled", "no-answer"].includes(CallStatus)) {
    endSession(CallSid);
  }
  res.sendStatus(204);
});
