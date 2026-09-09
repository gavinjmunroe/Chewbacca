# The hundred
Grouped by what you are actually trying to do. The verdict column is the
honest state as of 2026-09-09, audited against a live store.

## Recall  <sub>13/16 working</sub>

**1. What is my friend into, musically?**  `works`  
`people show "Jeremy Karkafi"`  
quick_facts carries a music slot; distill fills it from their own messages.  

**2. Who is this person and how do I know them?**  `works`  
`people show <name>`  
how_we_met plus the first message exchanged.  

**3. What does this person do for work right now?**  `works`  
`people show <name>`  
works_on slot, refreshed by distill as their messages change.  

**4. What are they studying, and where?**  `works`  
`people show <name>`  

**5. Who is in their family?**  `works`  
`people show <name>`  
family slot; also relationships table for people both of us know.  

**6. What are they worried about at the moment?**  `partial`  
`people texts --who <name> --days 30`  
What is missing: distill deliberately skips distress; that is a policy, not a gap.  

**7. What did they ask me for that I never did?**  `works`  
`people tasks`  

**8. What advice have they given me?**  `works`  
`people show <name>`  
advice_they_gave slot.  

**9. What is their faith background?**  `works`  
`people show <name>`  

**10. Do they have any health thing I should be gentle about?**  `partial`  
`people show <name>`  
What is missing: only recorded when they volunteered it and it is not a crisis.  

**11. What food do they like or avoid?**  `works`  
`people show <name>`  

**12. What is their sport or their exercise?**  `works`  
`people show <name>`  

**13. Where did they grow up?**  `works`  
`people show <name>`  

**14. What is one thing they said that I should not forget?**  `works`  
`people show <name>`  
every fact carries the verbatim quote and its date.  

**15. Have they ever mentioned wanting to be introduced to someone?**  `partial`  
`people search "intro"`  
What is missing: a can_introduce slot exists; the inverse ask is not modelled.  

**16. What are they good at that I would not guess?**  `works`  
`people show <name>`  

## Before you see them  <sub>6/9 working</sub>

**17. I am getting coffee with someone in an hour. Brief me.**  `works`  
`people show <name>`  

**18. What did we talk about last time?**  `works`  
`people texts --who <name> --days 30`  

**19. What has changed in their life since we last spoke?**  `partial`  
`people history <name>`  
What is missing: history tracks score movement, not a change log of facts.  

**20. What should I ask them about?**  `works`  
`people show <name>`  
ask_about slot exists for exactly this.  

**21. What do we have in common?**  `build`  
What is missing: no overlap query across two people's facts.  

**22. Is there anything I promised them?**  `works`  
`people tasks <name>`  

**23. Do I owe them money, or they me?**  `works`  
`people loans`  

**24. What is the last thing they were excited about?**  `works`  
`people show <name>`  

**25. Am I about to meet someone they have a history with?**  `build`  
What is missing: relationships table is sparse and undirected.  

## Drift and reconnection  <sub>6/10 working</sub>

**26. Who am I losing touch with?**  `works`  
`people reconnect`  

**27. Who was I close to two years ago and never talk to now?**  `works`  
`people trend --days 730`  

**28. Who is warming up?**  `works`  
`people trend`  

**29. Who reached out to me and I never replied?**  `build`  
What is missing: needs last-inbound versus last-outbound per person.  

**30. Who have I been meaning to call?**  `works`  
`people tasks`  

**31. Which friendships are one-sided right now?**  `build`  
What is missing: inbound/outbound message ratio is computable but unimplemented.  

**32. Who did I meet this semester and never followed up with?**  `partial`  
`people list --since 2026-08-24`  
What is missing: created_at exists; the follow-up gate does not.  

**33. Give me five people to text today.**  `works`  
`people today`  

**34. Who should I see in person this week rather than text?**  `build`  
What is missing: no channel-preference model.  

**35. Which of my closest people am I overdue with?**  `works`  
`people reconnect`  

## Network  <sub>5/10 working</sub>

**36. Who do I know at a given company?**  `works`  
`people intro <company>`  

**37. Who could introduce me to someone at Anthropic?**  `works`  
`people intro Anthropic`  

**38. Who in my network works in health tech in LA?**  `works`  
`people search "health"`  
PeopleRank does this properly in Amber; here it is FTS plus fields.  

**39. Who are the most connected people I know?**  `partial`  
`people rank`  
What is missing: rank scores closeness to me, not their centrality.  

**40. Who did I meet through a given person?**  `build`  
What is missing: how_we_met is prose, not a foreign key.  

**41. Which YC founders do I know?**  `works`  
`people search "YC"`  

**42. Who do I know who has done what I am about to do?**  `partial`  
`people search "<thing>"`  

**43. Who should I ask about design?**  `works`  
`people search design`  
in Sept 2026 Caleb texted eleven designers the same question by hand.  

**44. Who have I asked for mentorship before?**  `partial`  
`people search mentor`  

**45. Which people do I know only through one group chat?**  `build`  
What is missing: circle membership exists; the exclusivity query does not.  

## Groups  <sub>3/6 working</sub>

**46. What is this group chat and who is in it?**  `works`  
`people circle show "<name>"`  

**47. Which group chats am I actually active in?**  `partial`  
`people circles`  
What is missing: no per-circle recency ranking.  

**48. Who is in my church community versus my startup community?**  `works`  
`people circles`  

**49. Which groups have gone quiet?**  `build`  
What is missing: circles have no activity scoring.  

**50. Who is in a group with me but I have never texted one to one?**  `build`  
What is missing: computable from circle_members minus direct threads.  

**51. Name everyone from a trip or an event.**  `works`  
`people circle show "<name>"`  

## Occasions  <sub>6/8 working</sub>

**52. Whose birthday is coming up?**  `works`  
`people birthdays`  

**53. What should I get them?**  `partial`  
`people show <name>`  
interests and food slots make this answerable by an agent.  

**54. What happened on this day in previous years?**  `works`  
`people today`  

**55. When did we meet?**  `works`  
`people show <name>`  

**56. What anniversaries or hard dates should I remember for someone?**  `works`  
`people dates`  

**57. Who did I spend the most time with last month?**  `partial`  
`people rank --limit 20`  
What is missing: rank is weighted, not a raw time tally.  

**58. What did I do last Saturday and who with?**  `works`  
`people events scan --days 7`  

**59. Remind me to check on someone in two weeks.**  `works`  
`people task add <name> "check in" --due <date>`  

## Integrity  <sub>5/8 working</sub>

**60. Is anyone in here duplicated?**  `works`  
`people dedupe`  

**61. Are all my messages attributed to the right person?**  `works`  
`people check`  
a bug found on 2026-09-09 had 23% of messages attributed to nobody.  

**62. Which senders does the store not recognise?**  `works`  
`people alias`  

**63. Work out who an unknown number is from context.**  `works`  
`people identify`  

**64. Is my data self-consistent?**  `works`  
`people check --fix`  

**65. What is in here that I never confirmed?**  `partial`  
`people search inferred`  
What is missing: source is recorded per observation but not summarised.  

**66. Delete everything about one person.**  `partial`  
`people update <name> --delete`  
What is missing: soft delete only; message rows survive.  

**67. Which facts are stale?**  `build`  
What is missing: observations decay in scoring but facts have no freshness surface.  

## About me  <sub>6/8 working</sub>

**68. What do I actually know about myself in here?**  `works`  
`people me`  

**69. What story do I tell about a given thing?**  `works`  
`people me --search <topic>`  

**70. What are my own verified numbers?**  `works`  
`people me --search caution`  
four resume metrics are flagged as invented on purpose.  

**71. What have I said I want to do with my life?**  `works`  
`people me --search mission`  

**72. What did I try that failed?**  `works`  
`people me --search failed`  

**73. What is my writing voice?**  `partial`  
`people me --search how_he_works`  
What is missing: second-brain core/voice.md is the real home for this.  

**74. Which of my claims cannot be sourced?**  `works`  
`people me --search caution`  

**75. What did I believe a year ago that I no longer believe?**  `build`  
What is missing: self-facts are dated but never diffed.  

## Writing  <sub>2/4 working</sub>

**76. Draft a text to this person that sounds like me.**  `partial`  
`people show <name>`  
What is missing: voice lives in second-brain, not the store; an agent must read both.  

**77. Write a birthday message that references something real.**  `works`  
`people show <name>`  

**78. Who did I send the same copy-pasted message to?**  `partial`  
`people texts search "<phrase>"`  
in March 2026 one message went to hundreds of people.  

**79. Thank someone specifically rather than generically.**  `works`  
`people show <name>`  

## Retrieval  <sub>7/7 working</sub>

**80. Find the conversation where we talked about a thing.**  `works`  
`people texts search "<phrase>"`  

**81. What did this person say about a topic, ever?**  `works`  
`people texts search "<topic>" --who <name>`  

**82. Search everything I know for a keyword.**  `works`  
`people search "<term>"`  

**83. Ask a question in plain English.**  `works`  
`people ask "<question>"`  

**84. Export what I know as markdown I can read.**  `works`  
`people export`  

**85. Show me a dashboard of my whole network.**  `works`  
`people dashboard`  

**86. Pull the full history with one person as a file.**  `works`  
`people texts --who <name> --days 99999`  

## Keeping it alive  <sub>9/9 working</sub>

**87. Turn this week's new messages into facts automatically.**  `works`  
`people distill`  
runs nightly at 21:30 via launchd.  

**88. Notice a life event in the messages without me logging it.**  `works`  
`people events scan`  

**89. Keep scores current as conversations happen.**  `works`  
`people score`  
the nightly job handles it.  

**90. Back up the store somewhere private.**  `works`  
`people sync push`  

**91. Tell me when the store has drifted from reality.**  `works`  
`people check`  

**92. Import a new contact source without creating duplicates.**  `works`  
`people import --mac`  
dedupe catches exact name and email collisions only.  

**93. Learn a person's second phone number or email.**  `works`  
`people alias <name> <handle>`  

**94. Never re-read a message I have already extracted from.**  `works`  
`people distill`  
watermark in sync_state.  

**95. Run the whole maintenance pass unattended.**  `works`  
`launchctl kickstart gui/$UID/com.calebnewton.people-sync`  

## Care  <sub>1/5 working</sub>

**96. Who is going through something hard right now?**  `blocked`  
What is missing: deliberately not extracted. Facts about other people's crises are not the store's business.  

**97. Who showed up for me this year?**  `partial`  
`people events scan`  
events capture meals, hangouts and calls.  

**98. Who did I let down, and did I make it right?**  `build`  
What is missing: apologies are in the messages but nothing indexes them.  

**99. Who is new in my life and worth investing in?**  `works`  
`people list --recent`  

**100. Am I giving more attention to people who need it or people who are easy?**  `build`  
What is missing: the most interesting question here and the least tractable.  
