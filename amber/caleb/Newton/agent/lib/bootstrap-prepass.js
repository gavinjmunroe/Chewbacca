/**
 * bootstrap-prepass.js — group handshake + opt-in/out + alias parse.
 *
 * flaw #97 — Extracted out of Newton/agent/agent.js's handleWebhookMessage
 * (which was 2000+ lines). This module owns the trip-planning v2
 * handshake / opt-in pre-pass for group inbound messages.
 *
 * Behavior is intentionally identical to the inline block it replaced.
 * Three exit paths:
 *
 *   1. Handshake mode is "first_touch" or "retroactive"
 *        -> post handshake, stash the user's pending ask, mark sent,
 *           mirror to BigQuery, and return { handled: true }.
 *           Caller short-circuits the rest of the turn.
 *
 *   2. We were awaiting an alias (because first_touch asked
 *      "what should i call this chat?")
 *        -> if this inbound parses as an alias, save + confirm + return
 *           { handled: true }. Otherwise clear the flag and fall through.
 *
 *   3. Opt-in / opt-out signal detected
 *        -> record it, but DO NOT return — return { handled: false,
 *           text: <maybe-replayed-text> } so the caller continues the
 *           normal AI loop. If the user had a pending ask before they
 *           opted in we replay it (mutate text).
 *
 * Bootstrap errors never bubble — caller's normal flow proceeds.
 */

export async function runBootstrapPrePass({
  groupId,
  normFrom,
  tenant,
  text,
  sendMessage,
  sendOpts,
  messageId = null,
}) {
  try {
    const {
      loadGroupMemory,
      saveGroupMemory,
      ensureFirstMessageAt,
      acquireHandshakeLock,
      releaseHandshakeLock,
      markHandshakeSent,
    } = await import("./group-memory.js");
    const {
      handshakeMessage,
      retroactiveHandshakeMessage,
      shouldRunHandshake,
      detectOptIn,
      detectOptOut,
      recordOptIn,
      recordOptOut,
      recordPendingAsk,
      popPendingAsk,
      parseGroupAlias,
    } = await import("./bootstrapping.js");
    const { upsertGroup, upsertPerson } = await import("./events.js");

    const groupMem = await loadGroupMemory(groupId, tenant);

    // flaw #3 — stamp firstMessageAt on the first inbound we see so
    // shouldRunHandshake can disambiguate truly-new vs cold-cache.
    ensureFirstMessageAt(groupMem);

    const handshakeMode = shouldRunHandshake(groupMem, {
      isFirstMessageInGroup: !(groupMem.messageCount > 0),
    });
    if (handshakeMode !== "skip") {
      // flaw #4 — mutex on concurrent handshake fires. Two near-
      // simultaneous inbounds must not BOTH post the handshake.
      if (!acquireHandshakeLock(groupId)) {
        console.log(
          `[bootstrapping] handshake already in-flight for ${groupId}, skipping duplicate`,
        );
      } else {
        try {
          // flaw #10 — cross-replica race. The in-process lock above
          // only protects against same-replica double-fires. Railway can
          // run multiple replicas; if two near-simultaneous inbounds
          // land on different replicas, each one's loadGroupMemory cache
          // is independently cold and shouldRunHandshake fires for both.
          // Before posting, re-read Firestore through the data layer
          // (bypassing our in-process cache) and abort if any replica
          // already wrote handshakeAt for this group. The cost is one
          // extra read per handshake — rare enough that latency is fine.
          const { sbGet } = await import("./data.js");
          const fresh = await sbGet(
            "group_memories",
            `group_id=eq.${encodeURIComponent(groupId)}`,
            tenant,
          );
          if (fresh?.memory?.handshakeAt) {
            console.log(
              `[bootstrapping] handshake already persisted for ${groupId} (fresh read won the race), skipping duplicate post`,
            );
            // Sync our in-memory copy so the rest of this request
            // doesn't fire retroactive logic on stale state.
            Object.assign(groupMem, fresh.memory);
            await saveGroupMemory(groupId, groupMem, tenant);
            return; // exit the prepass — no handshake post, no pendingAsk
          }

          // flaw #1 — stash the user's original ask so we can replay
          // it after they opt in. Done BEFORE the handshake post so
          // even if the send fails we still have the question.
          recordPendingAsk(groupMem, {
            text,
            normFrom,
            groupId,
            messageId: messageId || null,
          });
          // flaw #6 — per-tenant handshake content via tenant arg.
          // flaw #7+#8 baked into the function body.
          const body =
            handshakeMode === "retroactive"
              ? retroactiveHandshakeMessage(tenant)
              : handshakeMessage(tenant);
          await sendMessage(normFrom, body, sendOpts);
          markHandshakeSent(groupMem);
          // flaw #5 — first-touch handshake asks "what should i call
          // this chat?" so the next inbound is likely an alias.
          if (handshakeMode === "first_touch") {
            groupMem.awaitingAlias = true;
          }
          await saveGroupMemory(groupId, groupMem, tenant);
          // Mirror to BigQuery — best-effort.
          upsertGroup({
            groupId,
            alias: groupMem.name || null,
            participants: (groupMem.participants || []).map((p) =>
              typeof p === "string"
                ? {
                    handle: p,
                    name: null,
                    opt_in: groupMem.optInStatus?.[p] || "pending",
                  }
                : {
                    handle: p.handle,
                    name: p.name || null,
                    opt_in: groupMem.optInStatus?.[p.handle] || "pending",
                  },
            ),
            handshakeAt: groupMem.handshakeAt,
          }).catch(() => {});
        } finally {
          releaseHandshakeLock(groupId);
        }
      }
      return { handled: true, text };
    }

    // flaw #5 — if we asked "what should i call this chat?" the next
    // inbound is almost always the answer. Try to parse one; if it
    // looks like an alias, save it and confirm in-group. Always clear
    // the flag — either we got an answer or the user moved on.
    if (groupMem.awaitingAlias) {
      const alias = parseGroupAlias(text);
      groupMem.awaitingAlias = false;
      if (alias && !groupMem.name) {
        groupMem.name = alias;
        await saveGroupMemory(groupId, groupMem, tenant);
        await sendMessage(normFrom, `got it, calling this ${alias}.`, sendOpts);
        return { handled: true, text };
      }
      // No clean alias — persist the cleared flag and fall through.
      await saveGroupMemory(groupId, groupMem, tenant);
    }

    // Handshake already happened — check if this message is an opt-in
    // signal. Don't return; just record and continue to the normal flow.
    let outText = text;
    if (detectOptIn({ text })) {
      recordOptIn(groupMem, normFrom);
      await saveGroupMemory(groupId, groupMem, tenant);
      upsertPerson({ handle: normFrom }).catch(() => {});
      console.log(`[opt-in] ${normFrom} opted in to group ${groupId}`);
      // flaw #1 — if this user had a pending ask before they opted in,
      // mutate the inbound text so the AI loop replays it in the SAME
      // turn. The user shouldn't have to re-text the question.
      const pending = popPendingAsk(groupMem, normFrom);
      if (pending && pending.text && pending.text !== text) {
        await saveGroupMemory(groupId, groupMem, tenant);
        console.log(
          `[bootstrapping] replaying pending ask for ${normFrom}: "${pending.text.slice(0, 60)}"`,
        );
        outText = pending.text;
      }
    } else if (detectOptOut({ text })) {
      recordOptOut(groupMem, normFrom);
      await saveGroupMemory(groupId, groupMem, tenant);
      console.log(`[opt-out] ${normFrom} opted out of group ${groupId}`);
    }
    return { handled: false, text: outText };
  } catch (err) {
    console.warn(`[bootstrapping] failed for ${groupId}: ${err.message}`);
    // Don't block the normal flow on bootstrap errors.
    return { handled: false, text };
  }
}
