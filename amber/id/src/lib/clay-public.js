export async function clayPublic(path, body, fetchImpl = fetch) {
  if (!process.env.CLAY_PUBLIC_API_KEY) throw new Error("clay_not_configured");
  // No retries: search/run is a forward iterator and routine/run can spend credits.
  const res = await fetchImpl(`https://api.clay.com/public/v0${path}`, {
    method: body === undefined ? "GET" : "POST",
    signal: AbortSignal.timeout(20000),
    headers: {
      Authorization: `Bearer ${process.env.CLAY_PUBLIC_API_KEY}`,
      "content-type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!res.ok)
    throw new Error(res.status === 429 ? "clay_quota" : "clay_unavailable");
  return res.json();
}
export function safeLinkedIn(raw) {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && !u.username && !u.password &&
      /(^|\.)linkedin\.com$/.test(u.hostname) &&
      /^\/in\/[^/]+\/?$/.test(u.pathname)
      ? u.href
      : null;
  } catch {
    return null;
  }
}
export function clayPerson(p) {
  const role =
    p.matched_experiences?.find((e) => !e.end_date) ||
    p.matched_experiences?.[0];
  return {
    id: String(p.clay_profile_id),
    name:
      p.name ||
      [p.first_name, p.last_name].filter(Boolean).join(" ") ||
      "Name unavailable",
    title: role?.title || "",
    company: role?.company || "",
    location: p.location?.name || p.location?.city || "",
    linkedin: safeLinkedIn(p.linkedin_url),
  };
}
export function enrichmentRequest(person, action) {
  if (!person.name)
    throw new Error("missing_enrichment_inputs");
  if (action === "linkedin") {
    if (!person.company && !person.workEmail && !person.personalEmail)
      throw new Error("missing_enrichment_inputs");
    return { routine: "function:t_0tl2n4yiHPcosryKuAq", inputs: {
      "Full name": person.name, "Company name": person.company || "",
      "Company domain": person.companyDomain || "", "Work email": person.workEmail || "",
      "Personal email": person.personalEmail || "",
    } };
  }
  if (action === "personal_email") {
    if (!safeLinkedIn(person.linkedin)) throw new Error("missing_enrichment_inputs");
    return { routine: "function:t_0tlfoahhRxMjvy3sg6a", inputs: { "Social Profile URL": person.linkedin } };
  }
  if (action === "profile")
    return {
      routine: "function:t_0tivcd78WMyJCABTHus",
      inputs: { "Professional Profile URL": person.linkedin },
    };
  if (!person.company) throw new Error("missing_enrichment_inputs");
  if ((action === "phone" || action === "mobile_phone") && safeLinkedIn(person.linkedin))
    return {
      routine: "function:t_0tivcd9nsdpVHPknrm8",
      inputs: {
        "Social Profile URL": person.linkedin,
        "Full Name": person.name,
        "Company Name": person.company,
      },
    };
  if ((action === "email" || action === "work_email") && person.companyDomain)
    return {
      routine: "function:t_0tivcdkDid9RmFBpp7k",
      inputs: {
        "Social Profile URL": person.linkedin,
        "Full Name": person.name,
        "Company Name": person.company,
        "Company Domain": person.companyDomain,
      },
    };
  throw new Error("missing_enrichment_inputs");
}
export function enrichmentResult(action, result) {
  const str = v => typeof v === "string" ? v.trim().slice(0,3000) : "";
  const email = v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str(v)) ? str(v) : "";
  if (action === "email" || action === "work_email") return {workEmail:email(result?.["Work Email"])};
  if (action === "personal_email") return {personalEmail:email(result?.["Personal Email"])};
  if (action === "phone" || action === "mobile_phone") {
    const raw=str(result?.["Mobile Phone"]);
    const phone=raw.replace(/[\s().-]/g, "");
    return {phone:/^\+[1-9]\d{6,14}$/.test(phone) ? phone : ""};
  }
  if (action === "linkedin") return {linkedin:safeLinkedIn(result?.["LinkedIn URL"]) || ""};
  if (action !== "profile") throw Error("unsupported_enrichment_action");
  const p=result?.["Enrich person"];
  return {name:str(p?.name || [p?.first_name,p?.last_name].filter(Boolean).join(" ")),
    company:str(p?.latest_experience?.company_name || p?.latest_experience?.company),
    summary:str(p?.summary || p?.headline),companyDomain:str(p?.latest_experience?.company_domain),linkedin:safeLinkedIn(p?.url)};
}
