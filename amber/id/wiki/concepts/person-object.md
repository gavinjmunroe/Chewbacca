# Person Object Model

Every person in Amber's world is represented by a rich, multi-source object.

## Fields
- **Identity**: name, phone, email, LinkedIn, Apple Contact data
- **Health Profile**: 6 dimensions with history and trends
- **Personality**: MBTI, enneagram, communication style, horoscope
- **Relationship**: trust score, frequency, shared groups, how Caleb texts them
- **Context Notes**: confidence-scored, dimension-tagged facts
- **Enrichment**: company, title, vertical (from Togari/Clay)
- **Sources**: which systems have data (iMessage, iOS, Togari, Apple Contacts)

## Data Sources
| Source | What It Provides |
|---|---|
| iMessage agent (Supabase) | Conversation history, health inference, notes |
| iOS app (PostgreSQL) | Apple contacts, Apple Health, onboarding data |
| TogariMCP (BigQuery) | LinkedIn, company, scoring, enrichment |
| Apple Contacts (local) | Phone, email, birthday, relationship labels |
| Voice notes | Transcribed context routed to person |
| Images | Vision-parsed context routed to person |
