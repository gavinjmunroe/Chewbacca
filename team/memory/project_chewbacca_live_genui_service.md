---
name: project_chewbacca_live_genui_service
description: Chewbacca Live (apps/live) is Chewbacca's hosted genui "ask it, see it" service; BMA/Amber is a customer and Togari is only a data source
metadata:
  type: project
---

Chewbacca Live is a hosted web app in the Chewbacca repo (apps/live) where a client types a question and the answer streams back as typed genui blocks (KPI row, bar list, table, reply cards, timeline), in the same vocabulary as the Kyber HUD genui.

Ownership, stated by Caleb 2026-10-10 10:54: "make this a part of chewbs!!!!! We own it, and bma/amber is using our service." It started as a frontend inside togari-platform and was moved before it shipped. So Chewbacca owns the product and its deploy (Caleb's Railway, chewbacca-team project), and togari-platform only exposes read-only client data over an API key.

First customer: Jonah Graham (Zeutara, BMA's client). The layout starts from Maggie Chen's Serif "Campaign analytics, past week" PDF (10/10), which she asked to make "live through togari".

**Why:** Caleb and Gavin hold full ownership of Chewbacca after the 10/10 Karthik call, and Amber gets an advisor share. Anything built for BMA clients that isn't BMA-specific data belongs on the Chewbacca side.

**How to apply:** new client-facing UI or agent surfaces for BMA go in Chewbacca and call Togari as a data source. Don't build product UI inside togari-platform. Reply rates show Wilson 95% intervals and only get ranked when the intervals separate. Links: [[project_chewbacca_amber_positioning_2026_09_18]], [[project_togari_strategy]], [[feedback_client_cards_one_job]].

Model key: Chewbacca Live calls the model on BMA's Anthropic key, copied from togari-platform's Railway variables. Caleb, 2026-10-10 11:57: "BMA told me do whatever tf I want with the anthropic api key", so using it is authorized and not a blocker.
