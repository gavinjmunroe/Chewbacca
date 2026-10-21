import {safeLinkedIn} from './clay-public.js';
const key=v=>safeLinkedIn(v)?.replace('www.','').replace(/\/$/,'').toLowerCase();
const str=v=>typeof v==='string'?v.trim().slice(0,300):'';
export function clayProfileContext(result, expected) {
 const p=result?.['Enrich person'];
 if(!p || !key(p.url) || key(p.url)!==key(expected)) throw Error('profile_mismatch');
 const roles=(Array.isArray(p.experience)?p.experience:[]).filter(r=>r.is_current===true);
 if(p.latest_experience?.is_current===true)roles.push(p.latest_experience);
 const unique=[...new Map(roles.filter(r=>r.company && r.company_domain).map(r=>[String(r.company_domain).toLowerCase(),r])).values()];
 if(unique.length!==1)throw Error('missing_enrichment_inputs');
 const role=unique[0],domain=str(role.company_domain).toLowerCase();
 if(!/^[a-z0-9][a-z0-9.-]+\.[a-z]{2,}$/.test(domain))throw Error('missing_enrichment_inputs');
 return {name:str(p.name),firstName:str(p.first_name),lastName:str(p.last_name),company:str(role.company),
 companyDomain:domain,title:str(role.title),location:str(p.location_name),linkedin:safeLinkedIn(p.url)};
}
