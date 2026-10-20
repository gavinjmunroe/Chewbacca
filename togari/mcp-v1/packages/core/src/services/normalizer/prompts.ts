/**
 * Prompt templates for normalization operations
 */

/**
 * Template for normalizing company data
 */
export const NORMALIZE_COMPANY_PROMPT = `You are a data normalization expert. Normalize the following raw company data into a structured format.

Raw Data:
{{rawData}}

Target Schema:
{{schemaDescription}}

Instructions:
1. Extract and normalize all relevant company information
2. Standardize formats (e.g., domain without protocol/www, consistent casing)
3. Fill in any fields that can be inferred from the data
4. Report any issues or ambiguities encountered

Respond with a JSON object containing:
- "data": the normalized company object
- "confidence": a number between 0 and 1 indicating confidence in the normalization
- "issues": an array of strings describing any problems encountered`;

/**
 * Template for normalizing contact data
 */
export const NORMALIZE_CONTACT_PROMPT = `You are a data normalization expert. Normalize the following raw contact data into a structured format.

Raw Data:
{{rawData}}

Target Schema:
{{schemaDescription}}

Instructions:
1. Extract and normalize all relevant contact information
2. Standardize formats (e.g., lowercase email, consistent phone format)
3. Split full names into first/last if possible
4. Report any issues or ambiguities encountered

Respond with a JSON object containing:
- "data": the normalized contact object
- "confidence": a number between 0 and 1 indicating confidence in the normalization
- "issues": an array of strings describing any problems encountered`;

/**
 * Template for batch normalization of multiple records
 */
export const NORMALIZE_BATCH_PROMPT = `You are a data normalization expert. Normalize the following batch of raw {{entityType}} records into structured format.

Raw Records (JSON array):
{{rawRecords}}

Target Schema:
{{schemaDescription}}

Instructions:
1. Process each record in the array independently
2. Normalize each record according to the target schema
3. Maintain the same order as the input array
4. For each record, provide confidence and any issues encountered

Respond with a JSON array where each element contains:
- "data": the normalized {{entityType}} object
- "confidence": a number between 0 and 1 indicating confidence in the normalization
- "issues": an array of strings describing any problems with that specific record

Example response format:
[
  {"data": {...}, "confidence": 0.95, "issues": []},
  {"data": {...}, "confidence": 0.8, "issues": ["Missing email"]},
  ...
]`;

/**
 * Description of Company schema fields for prompts
 */
export const COMPANY_SCHEMA_DESCRIPTION = `{
  name: string (required) - Company name
  domain: string (optional) - Company domain without protocol or www
  industry: string (optional) - Industry or sector
  employeeCount: number (optional) - Exact employee count
  employeeRange: "1-10" | "11-50" | "51-200" | "201-500" | "501-1000" | "1000+" (optional)
  location: { city, state, country } (optional) - Company headquarters
  description: string (optional) - Brief company description (max 2000 chars)
  linkedinUrl: string (optional) - LinkedIn company page URL
  twitterHandle: string (optional) - Twitter handle without @
  fundingStage: string (optional) - e.g., "Seed", "Series A", "Series B"
  foundedYear: number (optional) - Year company was founded
  technologies: string[] (optional) - Technologies used
  website: string (optional) - Full website URL
}`;

/**
 * Description of Contact schema fields for prompts
 */
export const CONTACT_SCHEMA_DESCRIPTION = `{
  fullName: string (required) - Full name of the contact
  firstName: string (optional) - First name
  lastName: string (optional) - Last name
  email: string (optional) - Email address (lowercase)
  phone: string (optional) - Phone number
  title: string (optional) - Job title
  companyName: string (optional) - Company name
  companyDomain: string (optional) - Company domain
  linkedinUrl: string (optional) - LinkedIn profile URL
  location: { city, state, country } (optional) - Contact location
}`;

/**
 * Fill template placeholders with values
 * @param template - Template string with {{placeholder}} syntax
 * @param values - Object containing placeholder values
 * @returns Filled template string
 */
export function fillTemplate(
  template: string,
  values: Record<string, string>
): string {
  let result = template;
  for (const [key, value] of Object.entries(values)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
  }
  return result;
}
