import { phoneKey } from '../lib/contact-identity.js';
import { withTransaction } from "./sql.js";
import { safeLinkedIn } from "../lib/clay-public.js";

const list = value => String(value || "").split(",").map(x => x.trim()).filter(Boolean);
export function mergeClayFields(row, fields) {
  const unique=(values,key)=>{const seen=new Set();return values.filter(Boolean).filter(v=>{const k=key(v);if(seen.has(k))return false;seen.add(k);return true;});};
  const emails = unique([...list(row.emails),fields.workEmail,fields.personalEmail],v=>v.trim().toLowerCase());
  const phones = unique([...list(row.phones_all),row.phone_primary,fields.phone],v=>phoneKey(v) || v);
  if (fields.linkedin && row.linkedin_url && safeLinkedIn(row.linkedin_url)?.replace("www.", "").replace(/\/$/, "").toLowerCase() !== fields.linkedin.replace("www.", "").replace(/\/$/, "").toLowerCase()) throw Error("contact_conflict");
  return { emails:emails.join(", "), phones:phones.join(", "), phone:row.phone_primary || fields.phone || null,
    linkedin:row.linkedin_url || fields.linkedin || null,
    enrichment:{...row.enrichment,clayFields:{...row.enrichment?.clayFields,...fields}} };
}

/** Explicit confirmation only; additive, owner-scoped and serialized with edits. */
export async function applyClayFields(ownerId, contactId, job, transact = withTransaction) {
  if(job.input.contactId && job.input.contactId !== contactId) throw Error("contact_conflict");
  if(!job.output?.fields || job.kind !== "enrich" || job.status !== "complete") throw Error("contact_conflict");
  return transact(async db => {
    const {rows} = await db.query("SELECT * FROM contacts WHERE owner_id=$1 AND id=$2 AND deleted_at IS NULL FOR UPDATE",[ownerId,contactId]);
    const row=rows[0];
    if(!row) throw Error("contact_conflict");
    if(!job.input.contactId) {
      const result = await db.query("SELECT output FROM clay_jobs WHERE owner_id=$1 AND id=$2 AND kind='search' AND status='complete'",[ownerId,job.input.searchId]);
      const person=(result.rows[0]?.output?.people || result.rows[0]?.output?.results || []).find(p=>p.id===job.input.personId);
      if(!person?.linkedin || safeLinkedIn(row.linkedin_url)?.replace("www.", "").replace(/\/$/, "").toLowerCase()!==safeLinkedIn(person.linkedin)?.replace("www.", "").replace(/\/$/, "").toLowerCase()) throw Error("contact_conflict");
    }
    const fields=Object.fromEntries(Object.entries(job.output.fields).filter(([k,v])=>['workEmail','personalEmail','phone','linkedin'].includes(k) && typeof v==='string' && v));
    const merged=mergeClayFields(row,fields);
    const profile=job.output.profile || {};
    if(profile.linkedin && safeLinkedIn(row.linkedin_url)?.replace('www.','').replace(/\/$/,'').toLowerCase() !== safeLinkedIn(profile.linkedin)?.replace('www.','').replace(/\/$/,'').toLowerCase()) throw Error('contact_conflict');
    if(profile.linkedin) merged.enrichment.clayProfile=profile;
    await db.query(`UPDATE contacts SET emails=$3, phones_all=$4, phone_primary=$5,
      phone_primary_normalized=COALESCE(phone_primary_normalized,$6), linkedin_url=$7,
      enrichment=$8::jsonb, company=COALESCE(NULLIF(company,''),$9), title=COALESCE(NULLIF(title,''),$10), updated_at=now() WHERE owner_id=$1 AND id=$2`,
      [ownerId,contactId,merged.emails,merged.phones,merged.phone,merged.phone?.replace(/\D/g,''),merged.linkedin,JSON.stringify(merged.enrichment),profile.company || null,profile.title || null]);
    await db.query(`INSERT INTO contact_sources(owner_id,contact_id,source,external_id,raw_full_name,raw_emails,raw_phones,raw)
      VALUES($1,$2,'clay',$3,$4,$5,$6,$7::jsonb)
      ON CONFLICT(owner_id,source,external_id) WHERE deleted_at IS NULL DO NOTHING`,
      [ownerId,contactId,job.id,row.full_name,[fields.workEmail,fields.personalEmail].filter(Boolean).join(', '),fields.phone || null,JSON.stringify({action:job.input.action,fields,profile})]);
    return {ok:true,contactId,fields};
  });
}
