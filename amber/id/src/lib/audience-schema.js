/**
 * The wire shape of an audience, as one schema both route files use.
 *
 * Two copies of this would be two copies that drift, and the one that drifts
 * is always the one on the endpoint nobody tested.
 *
 *   { everyone: true }                          the whole company
 *   { everyone: true,  groups: [id] }           the whole company, filed under a group
 *   { everyone: false, groups: [id], people: [id] }   only those
 *
 * `everyone` defaults to true when absent, which is the behavior every client
 * written before audiences existed already has.
 *
 * The caps are low on purpose. Picking forty individual people is not an
 * audience, it is a group somebody has not made yet, and letting the share
 * sheet accept it means the company's permissions live in a list nobody can
 * maintain.
 */
export const AUDIENCE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    everyone: { type: "boolean" },
    groups: { type: "array", maxItems: 20, items: { type: "string", maxLength: 64 } },
    people: { type: "array", maxItems: 30, items: { type: "string", maxLength: 64 } },
  },
};
