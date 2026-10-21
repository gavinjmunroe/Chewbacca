import { clayProfileContext } from '../lib/clay-profile-context.js';
import { requireAuth } from '../lib/auth-session.js';
import { resolveAmberIdByPhone } from '../db/store.js';
import { getClayJob, reserveClayJob, updateClayJob } from '../db/clay-jobs.js';
import { getContactById, getContactWebFields } from '../db/store.js';
import { applyClayFields } from '../db/clay-contact-fields.js';
import { query } from '../db/sql.js';
import { planClaySearch } from '../lib/clay-query.js';
import { clayPublic, clayPerson, enrichmentRequest, enrichmentResult, safeLinkedIn } from '../lib/clay-public.js';
const errors = {
  clay_not_configured: 'Clay search is not available yet.',
  clay_quota: 'Today’s Clay search or enrichment allowance has been reached. Try again later.',
  clay_unavailable: 'Clay could not complete this request. No automatic retry was made.',
  search_unavailable: 'Search is temporarily unavailable. Please try again later.',
  unsupported_query: 'Try a name, job title, company or city. This search cannot match all of those criteria yet.',
  missing_enrichment_inputs: 'Add company and company website for work email; LinkedIn is needed for personal email and mobile lookup.',
  profile_mismatch: 'Clay returned a different profile. No contact details were applied.',
  request_conflict: 'This request has already been used. Start a new search.',
};
async function owner(request) {
  const phone = request.privyUser?.phone;
  return phone ? resolveAmberIdByPhone(phone) : null;
}
function envelope(job) {
  const {context, ...output}=job.output || {};
  return { id:job.id, kind:job.kind, status:job.status, ...output };
}
async function personFor(ownerId, searchId, personId, contactId) {
  if (contactId) {
    const [card, web] = await Promise.all([getContactById(ownerId, contactId), getContactWebFields(ownerId, contactId)]);
    if (!card) return null;
    return { name:card.name, company:card.company, linkedin:web?.linkedin_url,
      ...(card.enrichment?.clayProfile || {}), ...(card.enrichment?.clayFields || {}) };
  }
  const search = await getClayJob(ownerId, searchId);
  const person = search?.kind === 'search' && search.status === 'complete' && (search.output?.people || search.output?.results)?.find(p => p.id === personId);
  if (!person) return null;
  const { rows } = await query("SELECT output FROM clay_jobs WHERE owner_id=$1 AND kind='enrich' AND status='complete' AND input->>'searchId'=$2 AND input->>'personId'=$3 ORDER BY created_at", [ownerId,searchId,personId]);
  return rows.reduce((p,r) => ({...p,...r.output?.profile,...Object.fromEntries(Object.entries(r.output?.fields || {}).filter(([,v]) => !!v))}),person);
}
async function startSearch(ownerId, job) {
  const plan = await planClaySearch(job.input.query);
  const session = await clayPublic('/search/query-mode', { query:plan.query });
  if (!session.search_id || session.source_type !== 'people') throw new Error('clay_unavailable');
  const data = await clayPublic(`/search/query-mode/${encodeURIComponent(session.search_id)}/run`, {limit:10});
  if (data.source_type !== 'people' || !Array.isArray(data.data)) throw new Error('clay_unavailable');
  return updateClayJob(ownerId,job.id,{status:'complete',output:{ description:plan.description, people:data.data.slice(0,10).map(clayPerson) }});
}
async function startEnrichment(ownerId, job) {
  const person = await personFor(ownerId,job.input.searchId,job.input.personId,job.input.contactId);
  if (!person) throw new Error('missing_enrichment_inputs');
  const context={...person, ...(job.input.companyDomain ? {companyDomain:job.input.companyDomain} : {}), ...(job.input.company ? {company:job.input.company} : {})};
  const needsProfile=(['email','work_email'].includes(job.input.action) && (!context.company || !context.companyDomain)) || (['phone','mobile_phone'].includes(job.input.action) && !context.company);
  const stage=needsProfile && safeLinkedIn(context.linkedin) ? 'profile' : 'lookup';
  const request=enrichmentRequest(context,stage==='profile'?'profile':job.input.action);
  const result=await clayPublic(`/routines/${encodeURIComponent(request.routine)}/run`,{items:[{id:job.id,inputs:request.inputs}]});
  if(!result.routine_run_id)throw Error('clay_unavailable');
  return updateClayJob(ownerId,job.id,{status:'processing',output:{runId:result.routine_run_id,stage,context}});
}
export async function pollEnrichment(ownerId, job, deps = {}) {
  const call = deps.call || clayPublic, run = deps.query || query;
  const update = deps.update || updateClayJob, get = deps.get || getClayJob;
  if (job.kind !== 'enrich' || job.status !== 'processing' || job.output.stage==='lookup_dispatching') return job;
  const result = await call(`/routines/run/${encodeURIComponent(job.output.runId)}/results`);
  if (['validation_failed','processing_failed','failed','cancelled'].includes(result.status))
    return update(ownerId,job.id,{status:'error',output:{error:'clay_unavailable',message:'Clay could not complete this lookup.'}});
  if (result.status !== 'complete') return job;
  const item = result.data?.find(i => i.id === job.id);
  if (item?.status !== 'complete') return update(ownerId,job.id,{status:'error',output:{error:'clay_unavailable',message:'Clay did not find a result for this contact.'}});
  if(job.output.stage==='profile') {
    let profile;
    try {profile=clayProfileContext(item.result,job.output.context.linkedin);}
    catch(error){return update(ownerId,job.id,{status:'error',output:{error:error.message,message:errors[error.message] || errors.clay_unavailable}});}
    // A GET may be polled by multiple clients. Claim the second dispatch once.
    const {rows}=await run(`UPDATE clay_jobs SET output=output || $3::jsonb,updated_at=now()
      WHERE owner_id=$1 AND id=$2 AND status='processing' AND output->>'stage'='profile' RETURNING *`,
      [ownerId,job.id,JSON.stringify({stage:'lookup_dispatching',profile})]);
    if(!rows[0])return get(ownerId,job.id);
    try {
      const request=enrichmentRequest({...job.output.context,...profile},job.input.action);
      const next=await call(`/routines/${encodeURIComponent(request.routine)}/run`,{items:[{id:job.id,inputs:request.inputs}]});
      if(!next.routine_run_id)throw Error('clay_unavailable');
      return update(ownerId,job.id,{status:'processing',output:{runId:next.routine_run_id,stage:'lookup',profile}});
    }catch{return update(ownerId,job.id,{status:'error',output:{error:'clay_unavailable',message:errors.clay_unavailable,profile}});}
  }
  return update(ownerId,job.id,{status:'complete',output:{fields:enrichmentResult(job.input.action,item.result),...(job.output.profile?{profile:job.output.profile}:{})}});
}
async function submit(request, reply, kind) {
  const ownerId = await owner(request);
  if (!ownerId) return reply.code(401).send({error:'no_session'});
  if (!process.env.CLAY_PUBLIC_API_KEY) return reply.code(503).send({error:'clay_not_configured',message:errors.clay_not_configured});
  const {requestId,...input} = request.body;
  try {
    const {created,job} = await reserveClayJob(ownerId,{id:requestId,kind,input});
    if (job.kind !== kind || JSON.stringify(job.input) !== JSON.stringify(input)) {
      // Postgres jsonb key order is canonical, so compare fields rather than serialized order.
      if (job.kind !== kind || Object.keys(input).some(k => input[k] !== job.input[k]) || Object.keys(input).length !== Object.keys(job.input).length) throw new Error('request_conflict');
    }
    if (!created) return reply.send(envelope(job));
    try { return reply.send(envelope(await (kind === 'search' ? startSearch(ownerId,job) : startEnrichment(ownerId,job)))); }
    catch (err) {
      const error = errors[err.message] ? err.message : 'clay_unavailable';
      return reply.send(envelope(await updateClayJob(ownerId,requestId,{status:'error',output:{error,message:errors[error]}})));
    }
  } catch (err) {
    const error = errors[err.message] ? err.message : 'clay_unavailable';
    return reply.code(error === 'clay_quota' ? 429 : 503).send({error,message:errors[error]});
  }
}
const uuid = {type:'string',format:'uuid'};
export function registerClaySearchRoutes(app) {
  const preHandler = [requireAuth];
  app.post('/v1/me/clay/search',{preHandler,schema:{body:{type:'object',additionalProperties:false,required:['requestId','query'],properties:{requestId:uuid,query:{type:'string',minLength:2,maxLength:500}}}}},(req,reply) => submit(req,reply,'search'));
  app.post('/v1/me/clay/enrich',{preHandler,schema:{body:{type:'object',additionalProperties:false,required:['requestId','action'],oneOf:[{required:['searchId','personId'],not:{required:['contactId']}},{required:['contactId'],not:{anyOf:[{required:['searchId']},{required:['personId']}]}}],properties:{requestId:uuid,searchId:uuid,contactId:uuid,company:{type:'string',maxLength:200},companyDomain:{type:'string',maxLength:253,pattern:'^[a-zA-Z0-9][a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$'},personId:{type:'string',maxLength:80},action:{type:'string',enum:['profile','email','phone','work_email','personal_email','mobile_phone','linkedin']}}}}},(req,reply) => submit(req,reply,'enrich'));
  app.post('/v1/me/clay/jobs/:id/apply',{preHandler,schema:{params:{type:'object',required:['id'],properties:{id:uuid}},body:{type:'object',additionalProperties:false,required:['contactId'],properties:{contactId:uuid}}}},async(request,reply)=>{
    const ownerId=await owner(request);
    if(!ownerId) return reply.code(401).send({error:'no_session'});
    const job=await getClayJob(ownerId,request.params.id);
    if(!job || job.kind!=='enrich' || job.status!=='complete') return reply.code(404).send({error:'not_found'});
    try { return await applyClayFields(ownerId,request.body.contactId,job); }
    catch { return reply.code(409).send({error:'contact_conflict',message:'The contact changed or this result belongs to a different person. Reopen the card.'}); }
  });
  app.get('/v1/me/clay/jobs/:id',{preHandler,schema:{params:{type:'object',required:['id'],properties:{id:uuid}}}},async (request,reply) => {
    const ownerId = await owner(request);
    if (!ownerId) return reply.code(401).send({error:'no_session'});
    const job = await getClayJob(ownerId,request.params.id);
    if (!job) return reply.code(404).send({error:'not_found'});
    try { return reply.send(envelope(await pollEnrichment(ownerId,job))); }
    catch { return reply.code(503).send({error:'clay_unavailable',message:'Enrichment is still pending. Check again shortly.'}); }
  });
}
