---
name: reference_voice_agent_e2e_test
description: How to prove a browser voice agent (ElevenLabs or any WebRTC mic app) works end to end with no human, by feeding a spoken WAV in as the mic in headless Chromium
metadata:
  type: reference
---

A voice agent in a web page can be tested end to end headlessly. Launch Chromium with `--use-fake-ui-for-media-stream --use-fake-device-for-media-stream --use-file-for-fake-audio-capture=<file>.wav%noloop`. Make the WAV with `say -o x.aiff "[[slnc 9000]] your line [[slnc 25000]]"`, then `afconvert -f WAVE -d LEI16@48000 -c 1`. The silences let the agent's opener finish first. Click start, poll the page's caption text every second, then read the server transcript (ElevenLabs: `GET /v1/convai/conversations/<id>`).

On 2026-10-10 this was the only test that proved askforthefire worked: token, WebRTC connect, the agent heard "I'm in my dorm room and the door is closed" and answered on its own. A bare fake device only sends a beep, so it proves connection and nothing else. The same run without a GPU caught a white-box WebGL failure that every screenshot with a GPU had missed.

It cannot prove that audio comes out of a phone speaker or that iOS Safari works. Say that plainly and leave one short human test. Related: [[feedback_prove_it_on_prod]], [[feedback_built_but_never_fires]].
