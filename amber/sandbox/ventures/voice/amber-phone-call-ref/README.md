# amber-phone-call

Voice adapter for Amber. A caller dials the Twilio number, this server orchestrates the conversation with the real Amber brain (hosted by `amber-agent`: Claude, Perplexity embeddings for relational memory, Perplexity search for deep research, plus every other Amber tool), and ElevenLabs synthesizes Amber's voice back to the caller.

This repo is intentionally thin. It is not a brain. It is a microphone and a speaker wired to Amber.

## Flow

```
caller dials Twilio number
        │
        ▼
  Twilio POST /voice/incoming
        │
        ▼
  amber-phone-call
    - greet the caller with ElevenLabs TTS
    - <Gather input="speech"> for the caller's turn
        │
        ▼
  Twilio POST /voice/respond (with SpeechResult transcript)
        │
        ▼
  amber-phone-call
    - POST transcript to amber-agent /api/voice-turn
      (Claude + Perplexity embeddings + Perplexity search
       + Todoist + Calendar + health + Clay + GitHub)
    - ElevenLabs TTS on the reply text
    - cache audio in memory, serve via /audio/:id
    - <Play> the audio URL, then <Gather> again
        │
        └── loop until caller hangs up
        │
        ▼
  Twilio POST /voice/status (completed)
        │
        ▼
  amber-phone-call POSTs /api/voice-turn/end so the brain can
  flush conversation state and embed the transcript.
```

## Routes

| Route             | Method | Purpose                                         |
| ----------------- | ------ | ----------------------------------------------- |
| `/`               | GET    | Service info                                    |
| `/health`         | GET    | Railway liveness                                |
| `/voice/incoming` | POST   | Twilio entrypoint. Greets and opens Gather.     |
| `/voice/respond`  | POST   | Receives SpeechResult, asks Amber, plays reply. |
| `/voice/status`   | POST   | Call lifecycle. Ends brain session on hangup.   |
| `/audio/:id`      | GET    | Serves generated ElevenLabs audio to Twilio.    |

## Contract with amber-agent

`amber-phone-call` expects two endpoints on the backend:

```
POST /api/voice-turn
  body: { callSid, caller, userText, channel: "phone" }
  headers: Authorization: Bearer ${AMBER_AGENT_SECRET}
  returns: { reply: string }

POST /api/voice-turn/end
  body: { callSid }
  headers: Authorization: Bearer ${AMBER_AGENT_SECRET}
  returns: any 2xx
```

Until those land on the backend, set `AMBER_AGENT_URL` empty and the adapter will respond with a placeholder so the line stays alive for testing.

## Setup

1. Clone, install, copy `.env`

```
npm install
cp .env.example .env
```

2. Fill env vars. At minimum: `TWILIO_AUTH_TOKEN`, `ELEVENLABS_API_KEY`, `PUBLIC_URL`.

3. Deploy (Railway, Fly, anywhere with HTTPS).

4. In Twilio console, on your phone number:
   - A call comes in: Webhook POST `https://YOUR-DOMAIN/voice/incoming`
   - Call status changes: `https://YOUR-DOMAIN/voice/status`

5. Dial the number. Amber picks up.

## Local dev

```
npm run dev
```

Expose port 3000 with ngrok, set `PUBLIC_URL` to the ngrok URL, set `SKIP_TWILIO_SIGNATURE=true`, and point Twilio at the ngrok `/voice/incoming`.

All glory to God! ✝️❤️
