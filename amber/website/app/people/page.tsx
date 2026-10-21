"use client";

/**
 * FILLING AN ADDRESS BOOK WITHOUT A PHONE.
 *
 * Amber's premise is that it already knows everyone you know, and on iOS that
 * is true the moment somebody grants contacts access. A browser cannot do that
 * and never will, so an account created here starts empty — and an empty Amber
 * is not a worse Amber, it is not Amber at all.
 *
 * Two doors, and between them they cover everybody:
 *
 *   UPLOAD AN EXPORT. A .vcf out of Apple Contacts, a .csv out of LinkedIn,
 *   Google Contacts or Outlook. The file is read in the browser and posted as
 *   text; the server sniffs the format from the bytes rather than trusting the
 *   extension, and runs it through the same resolver a phone sync uses — so
 *   uploading the same export twice updates cards instead of doubling them.
 *
 *   ADD ONE PERSON. For the customer somebody just met, which is most of what
 *   actually gets typed into a CRM.
 *
 * WHAT IS NOT HERE: delete, merge, enrich. A browser token lives in the most
 * stealable place a credential can live, so the destructive and the billable
 * stay on the phone. That is a decision in lib/token-scope.js on the server,
 * not a gap in this page.
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AmberError,
  createContact,
  importContactFile,
  readSession,
} from "@/lib/amber";
import { Button, Field, Notice, Panel, Row } from "@/components/OrgUi";

type ImportResult = { created: number; merged: number; updated: number; deduped: number; failed: number };

export default function PeoplePage() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    const s = readSession();
    if (!s) router.replace("/login");
    else setToken(s.token);
  }, [router]);

  if (!token) {
    return <main className="px-6 py-16" style={{ color: "var(--muted)" }}>Loading…</main>;
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <header className="mb-8 flex items-baseline justify-between gap-4">
        <div>
          <h1 className="text-3xl" style={{ color: "var(--ink)" }}>Add people</h1>
          <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
            A browser cannot read an address book, so bring one in.
          </p>
        </div>
        <Button variant="quiet" onClick={() => router.push("/network")}>Network</Button>
      </header>

      <UploadPanel token={token} />
      <ManualPanel token={token} />

      <p className="text-xs" style={{ color: "var(--muted)" }}>
        Contacts, calendar and mail sync keep working in the iOS app and feed the same book.
        Nothing here replaces that — it just means you do not need a phone to start.
      </p>
    </main>
  );
}

function UploadPanel({ token }: { token: string }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<(ImportResult & { filename: string }) | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onFile(file: File) {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      // Read in the browser and post the text. A contact export is text and
      // usually well under a megabyte; multipart would mean a streaming parser
      // in front of the one surface where somebody uploads their whole graph.
      const content = await file.text();
      const r = await importContactFile(token, content, file.name, "upload");
      setResult({ ...r, filename: file.name });
    } catch (err) {
      setError(
        err instanceof AmberError
          ? err.message
          : "Could not read that file. A .vcf or .csv export works best.",
      );
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <Panel
      title="Upload an export"
      note="A .vcf from Apple or Android, a .csv from LinkedIn, Google Contacts or Outlook. Uploading the same file twice updates cards rather than doubling them."
    >
      <Notice kind="error">{error}</Notice>
      <input
        ref={fileRef}
        type="file"
        accept=".vcf,.csv,.txt,text/csv,text/vcard,text/directory"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
        }}
      />
      <Button onClick={() => fileRef.current?.click()} disabled={busy} className="w-full">
        {busy ? "Reading…" : "Choose a file"}
      </Button>

      {result ? (
        <div className="mt-4">
          <Row>
            <span style={{ color: "var(--ink)" }}>{result.filename}</span>
            <span className="text-sm" style={{ color: "var(--muted)" }}>
              {result.created} new · {result.merged + result.updated} updated
              {result.deduped ? ` · ${result.deduped} already there` : ""}
              {result.failed ? ` · ${result.failed} failed` : ""}
            </span>
          </Row>
        </div>
      ) : null}
    </Panel>
  );
}

function ManualPanel({ token }: { token: string }) {
  const [form, setForm] = useState({ name: "", email: "", company: "", title: "", city: "" });
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await createContact(token, {
        name: form.name.trim(),
        email: form.email.trim() || undefined,
        company: form.company.trim() || undefined,
        title: form.title.trim() || undefined,
        city: form.city.trim() || undefined,
      });
      setAdded([form.name.trim(), ...added]);
      setForm({ name: "", email: "", company: "", title: "", city: "" });
    } catch (err) {
      setError(err instanceof AmberError ? err.message : "Could not add that person.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="Add one person" note="For the customer you just met.">
      <Notice kind="error">{error}</Notice>
      <form onSubmit={submit}>
        <Field required value={form.name} onChange={set("name")} placeholder="Name" className="mb-3 w-full" />
        <div className="mb-3 grid gap-3 sm:grid-cols-2">
          <Field type="email" value={form.email} onChange={set("email")} placeholder="Email" />
          <Field value={form.company} onChange={set("company")} placeholder="Company" />
          <Field value={form.title} onChange={set("title")} placeholder="Title" />
          <Field value={form.city} onChange={set("city")} placeholder="City" />
        </div>
        <Button type="submit" disabled={busy || !form.name.trim()} className="w-full">
          {busy ? "…" : "Add"}
        </Button>
      </form>
      {added.length ? (
        <p className="mt-4 text-sm" style={{ color: "var(--muted)" }}>
          Added: {added.join(", ")}
        </p>
      ) : null}
    </Panel>
  );
}
