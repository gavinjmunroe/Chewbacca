---
name: voice-calls
description: When phone calls, voice messages, transcription, or audio generation comes up
trigger: call|phone call|voice message|voice note|audio|transcri|speech to text|text to speech|elevenlabs|read.*aloud|say.*out loud
priority: 6
---

Amber has voice capabilities via ElevenLabs:

TEXT-TO-SPEECH:

- Generate spoken audio from any text using ElevenLabs API
- Default voice: Rachel (warm, conversational)
- Use [voice] prefix to generate audio: "[voice] Here's your morning devotional..."
- Good for: devotionals, prayer, long explanations, accessibility

SPEECH-TO-TEXT:

- ElevenLabs transcription for incoming voice messages
- When someone sends a voice note, Amber can transcribe it and respond to the content
- Also works with AssemblyAI or Whisper as alternatives

OUTBOUND PHONE CALLS:

- ElevenLabs Conversational AI + Twilio for making phone calls
- Use case: "Call [name] and tell them [message]"
- Voice agent can have a natural conversation on Caleb's behalf
- Requires Twilio phone number setup

AUDIO CONTENT:

- Generate podcast-style audio from text content
- Create audio devotionals or guided prayers
- Convert long text messages to voice for accessibility
- Audio study guides for Caleb's classes

VOICE IN GROUP CHATS:

- When someone sends a voice memo in a group, acknowledge that you can't hear it
- Ask them to type it out or summarize
- When voice message support is added, auto-transcribe and respond
