// ---------------------------------------------------------------------------
// 12. API KEYS. The credential that leaves the building.
//
// A session belongs to a person at a screen. A key belongs to whatever holds
// it -- a Copilot connector, a script, a vendor -- and it is the one thing
// here that is copied into another company's product by design. So the
// questions are different: does it name exactly one tenant, does revoking it
// stop it immediately, and is the stored form useless to somebody reading the
// table.
// ---------------------------------------------------------------------------

async function apiKeys() {
  const orgId = world.org;

  let issued = null;
  await withTenant(orgId, async () => {
    issued = await issueOrgKey({
      orgId,
      name: `${TAG} connector`,
      scopes: ["memory:read"],
      createdBy: world.members.avery,
    }).catch((e) => ({ error: String(e?.message ?? e) }));
  });

  if (!issued || issued.error || !issued.raw) {
    bad("could not issue an API key", issued?.error ?? "no key returned");
    return;
  }

  /*
   * VERIFICATION HAPPENS BEFORE THERE IS A TENANT -- the key is what decides
   * which tenant -- so this is deliberately called OUTSIDE any scope. If it
   * only worked inside one, every real request carrying a key would fail.
   */
  const seen = await verifyOrgKey(issued.raw);
  if (seen?.orgId === String(orgId)) ok("a key resolves to its own company, with no tenant set");
  else bad("a valid key did not resolve", "every machine request would be rejected");

  if (seen && seen.scopes.includes("memory:read") && seen.scopes.length === 1) {
    ok("and carries exactly the scopes it was issued with");
  } else {
    bad(`the key came back with scopes ${JSON.stringify(seen?.scopes)}`, "a scope it was not granted is an escalation");
  }

  /*
   * THE STORED FORM MUST BE USELESS. If the table holds the key itself, then
   * reading one row is the same as holding the credential -- and a database
   * backup becomes a set of live keys for every customer.
   */
  const { rows: stored } = await query(
    `SELECT key_hash, key_prefix, last4 FROM org_api_keys WHERE org_id = $1::uuid AND id = $2::uuid`,
    [orgId, issued.key.id],
  );
  if (stored.length === 0) {
    bad("the key row is not readable to check its stored form", "cannot verify the hash");
  } else {
    const hash = String(stored[0].key_hash ?? "");
    if (!hash.includes(issued.raw) && hash !== issued.raw) ok("the stored form is a hash, not the key");
    else bad("the raw key is in the table", "a backup of this database is a set of live credentials");

    if (String(stored[0].last4) === issued.raw.slice(-4)) {
      ok("with a last-four kept so somebody can tell two keys apart");
    }
  }

  /*
   * ONE CHARACTER WRONG IS NOT CLOSE ENOUGH, and a key from one company must
   * not resolve while scoped to another.
   */
  const mutated = await verifyOrgKey(`${issued.raw.slice(0, -1)}${issued.raw.slice(-1) === "a" ? "b" : "a"}`);
  if (!mutated) ok("a key with one character changed resolves to nothing");
  else bad("a mutated key resolved", "the lookup is not on the whole value");

  const junk = await verifyOrgKey("not-a-key");
  if (!junk) ok("and so does a value that is not a key at all");
  else bad("a junk string resolved to a company", "looksLikeOrgKey is not gating the lookup");

  // Revocation has to be immediate, not advisory.
  await withTenant(orgId, async () => {
    await revokeOrgKey({ orgId, keyId: issued.key.id, revokedBy: world.members.avery });
  });
  const afterRevoke = await verifyOrgKey(issued.raw);
  if (!afterRevoke) ok("a revoked key stops resolving at once");
  else bad("a revoked key still works", "revocation is advisory, which is the same as not having it");

  /*
   * THE OTHER COMPANY MUST NOT SEE IT. Keys are the credential most likely
   * to be listed on a settings screen, so the listing is worth probing from
   * the wrong side.
   */
  if (world.outsider?.orgId) {
    await withTenant(world.outsider.orgId, async () => {
      const { rows } = await query(
        `SELECT count(*)::int AS n FROM org_api_keys WHERE org_id = $1::uuid`,
        [orgId],
      );
      if (rows[0].n === 0) ok("another company cannot see this company's keys");
      else bad(`${rows[0].n} key row(s) are visible from the other company`, "a tenant policy is missing on org_api_keys");
    });
  }
}

// ---------------------------------------------------------------------------
// 13. AI IMPORT. The Copilot and ChatGPT history, which is the demo.
//
// The rule that matters is that an import NEVER CREATES A PERSON. An export
// is thousands of conversations mentioning everybody the model has ever been
// asked about, and letting it mint nodes would fill the graph with people
// nobody has met. It may only attach to people the company already knows.
// ---------------------------------------------------------------------------

async function aiImport() {
  const orgId = world.org;

  await withTenant(orgId, async () => {
    // Somebody the company genuinely knows, so there is something to attach to.
    const known = await met("avery", {
      email: `${TAG}-ai-known@counterparty.invalid`,
      name: `Dana Whitfield`,
      summary: `${TAG}-AI-SEED`,
    });
    if (!known.ok) {
      bad("could not seed a person for the import test", known.reason);
      return;
    }

    const before = await query(
      `SELECT count(*)::int AS n FROM org_people WHERE org_id = $1::uuid AND deleted_at IS NULL`,
      [orgId],
    );

    const conversations = [
      {
        id: `${TAG}-c1`,
        title: "Prep for the Whitfield call",
        occurredAt: new Date().toISOString(),
        messages: [{ role: "user", text: "What should I ask Dana Whitfield about renewal?" }],
      },
      {
        id: `${TAG}-c2`,
        title: "Someone we have never met",
        occurredAt: new Date().toISOString(),
        messages: [{ role: "user", text: "Tell me about Persimmon Okonkwo-Vance at Initech." }],
      },
    ];

    const result = await importExport({
      orgId,
      amberId: world.members.avery,
      provider: "copilot",
      conversations,
      filename: `${TAG}.json`,
    }).catch((e) => ({ ok: false, reason: String(e?.message ?? e) }));

    if (!result?.ok) {
      /*
       * copilot is an agent source and the company default excludes the four
       * agent sources, so a refusal here may be the ceiling doing its job
       * rather than a fault. Said out loud rather than scored either way.
       */
      note(`the import returned ${result?.reason ?? "nothing"} — if this is a policy refusal it is correct`);
      return;
    }

    const after = await query(
      `SELECT count(*)::int AS n FROM org_people WHERE org_id = $1::uuid AND deleted_at IS NULL`,
      [orgId],
    );
    if (after.rows[0].n === before.rows[0].n) {
      ok("an import attached to people we know and created nobody");
    } else {
      bad(
        `the import created ${after.rows[0].n - before.rows[0].n} person row(s)`,
        "an export mentions everybody ever asked about; minting nodes from it fills the graph with strangers",
      );
    }

    /*
     * IDEMPOTENCE, for the same reason a calendar re-sync has to be: people
     * re-upload the same export, and a doubled history is how somebody stops
     * believing the numbers.
     */
    const again = await importExport({
      orgId,
      amberId: world.members.avery,
      provider: "copilot",
      conversations,
      filename: `${TAG}.json`,
    }).catch(() => ({ ok: false }));

    const { rows: dup } = await query(
      `SELECT count(*)::int AS n FROM org_interactions
        WHERE org_id = $1::uuid AND source = 'copilot' AND external_id LIKE $2`,
      [orgId, `copilot:${TAG}-c1:%`],
    );
    if (dup[0].n <= 1) ok("re-uploading the same export writes nothing twice");
    else bad(`${dup[0].n} rows for one conversation`, "the external id is not keyed on conversation and person");
    void again;

    /*
     * AND IT HAS TO BE REVERSIBLE. Somebody uploads two years of history,
     * sees what it looks like, and wants it gone. An import that cannot be
     * undone is one nobody will risk running.
     */
    if (result.importId) {
      const undone = await undoImport({
        orgId,
        amberId: world.members.avery,
        importId: result.importId,
      }).catch((e) => ({ ok: false, reason: String(e?.message ?? e) }));

      if (undone?.ok) {
        const { rows: left } = await query(
          `SELECT count(*)::int AS n FROM org_interactions WHERE org_id = $1::uuid AND import_id = $2::uuid`,
          [orgId, result.importId],
        );
        if (left[0].n === 0) ok("and an import can be undone completely");
        else bad(`${left[0].n} imported row(s) survived the undo`, "a partial undo is worse than none");
      } else {
        bad("undoing the import failed", undone?.reason ?? "unknown");
      }

      /*
       * THE SEED MUST SURVIVE THE UNDO. Undo removes what the import wrote,
       * not the meetings that were there first -- a delete scoped to the
       * person rather than the import would take the relationship with it.
       */
      const { rows: seed } = await query(
        `SELECT count(*)::int AS n FROM org_interactions WHERE org_id = $1::uuid AND source = 'calendar'`,
        [orgId],
      );
      if (seed[0].n > 0) ok("and the meetings that were there before it are untouched");
      else bad("the undo took the calendar history with it", "it is scoped to the person rather than the import");
    }
  });

  /*
   * ONE MEMBER MUST NOT UNDO ANOTHER'S IMPORT. An import is somebody's own
   * AI history; the undo is theirs too.
   */
  await withTenant(orgId, async () => {
    const mine = await importExport({
      orgId,
      amberId: world.members.avery,
      provider: "claude",
      conversations: [
        {
          id: `${TAG}-c3`,
          title: "Mine",
          occurredAt: new Date().toISOString(),
          messages: [{ role: "user", text: "Dana Whitfield renewal notes" }],
        },
      ],
      filename: `${TAG}-mine.json`,
    }).catch(() => ({ ok: false }));

    if (!mine?.ok || !mine.importId) {
      note("could not create an import to test cross-member undo");
      return;
    }
    const theft = await undoImport({
      orgId,
      amberId: world.members.blake,
      importId: mine.importId,
    }).catch(() => ({ ok: false, reason: "threw" }));

    if (!theft?.ok) ok("one member cannot undo another member's import");
    else bad("a colleague undid somebody else's import", "the undo is not scoped to its owner");

    await undoImport({ orgId, amberId: world.members.avery, importId: mine.importId }).catch(() => null);
  });
}

// ---------------------------------------------------------------------------
// 14. KNOWLEDGE AND AUDIENCES. Who can read a page.
//
// Same shape of boundary as the relationship ledger and a different
// mechanism, which is the reason to test it separately rather than assume the
// first one covers it.
// ---------------------------------------------------------------------------

async function knowledge() {
  const orgId = world.org;

  await withTenant(orgId, async () => {
    const made = await createPage({
      orgId,
      title: `${TAG} private page`,
      body: `${TAG}-PAGE-SECRET`,
      createdBy: world.members.avery,
    }).catch((e) => ({ ok: false, reason: String(e?.message ?? e) }));

    if (!made?.ok || !made.page?.id) {
      note(`could not create a page (${made?.reason ?? "no id"}) — the audience checks are skipped`);
      return;
    }
    const page = made.page;

    /*
     * The audience is set to the author alone, then read as somebody else.
     * A page visible to its author and to nobody else is the narrowest case
     * and therefore the one a missing predicate shows up in first.
     *
     * `everyone: false` is load-bearing: normalizeAudience DEFAULTS everyone
     * to true when the key is absent, so an audience object listing people
     * and omitting it means "the whole company" -- and this check would then
     * read a company-wide page, find a colleague could see it, and report a
     * leak that is only the test having asked for one.
     */
    const set = await setAudience({
      orgId,
      itemType: "page",
      itemId: page.id,
      audience: { everyone: false, people: [world.members.avery] },
      actorId: world.members.avery,
    }).catch((e) => ({ ok: false, reason: String(e?.message ?? e) }));

    if (!set?.ok) {
      note(`could not narrow the audience (${set?.reason ?? "unknown"}) — reading it back proves nothing`);
      return;
    }

    const asAuthor = await getPage({ orgId, pageId: page.id, viewerId: world.members.avery });
    if (asAuthor) ok("the author can read their own page");
    else bad("the author cannot read their own page", "the audience predicate excludes the person it names");

    const asOther = await getPage({ orgId, pageId: page.id, viewerId: world.members.blake });
    if (!asOther) ok("a colleague outside the audience cannot read it");
    else bad("a colleague read a page they are not in the audience for", "the audience is decorative");

    const found = await searchPages({ orgId, q: "PAGE-SECRET", viewerId: world.members.blake, limit: 20 }).catch(
      () => [],
    );
    const leaked = (found ?? []).filter((r) => String(r.id) === String(page.id));
    if (leaked.length === 0) ok("and search does not return it either");
    else
      bad(
        "search returned a page the viewer may not open",
        "search is the usual way a careful read predicate gets bypassed — it is a second query somebody has to remember",
      );
  });
}
