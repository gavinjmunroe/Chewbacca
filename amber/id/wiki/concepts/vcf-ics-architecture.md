# VCF/ICS Architecture

Core insight from Caleb Newton (April 8, 2026).

## The Two Primitives
- **VCF (vCards)** = the Person Object. Static identity. Who someone IS.
  - Name, phone, email, birthday, company, relationships
  - The permanent record. Changes rarely.
- **ICS (Calendar events)** = the Time Object. Dynamic interactions.
  - When you see someone, meetings, events
  - The temporal layer. Changes constantly.

## The Bridge: Dynamic to Static
When a dynamic pattern (ICS) becomes permanent enough, it crystallizes into the static record (VCF).
- Meet someone at 3 events? That relationship graduates from calendar noise to a real contact.
- Voice note about someone? Parsed and routed into their VCF profile.
- Photo with someone? Face detected, tagged to their VCF.

## Multimodal Input Routing
Any input (voice, image, text, file) gets objectively parsed and routed into the appropriate Person Object (VCF).
- Voice: transcribe, extract facts, route to person
- Image: vision parse, extract context, route to person
- Text: NLP extract, tag with dimensions, route to person

## Privacy
- Each person's VCF is a decentralized instance of memory
- PII is protected and secured
- People can opt in to share selectively with each Amber enterprise instance
- Enterprise data (BMA, Rytual) is separate from personal data
