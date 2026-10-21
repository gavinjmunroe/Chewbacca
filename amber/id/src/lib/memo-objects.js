const text = (v, max = 200) =>
  typeof v === "string" ? v.trim().slice(0, max) : "";
/** Persist only bounded data. Model output never becomes executable IDs or writes. */
export function memoObjects(raw, contacts = []) {
  const ids = new Set(contacts.map((c) => c.id));
  const places = [
    ...new Set(
      (Array.isArray(raw?.places) ? raw.places : [])
        .map((p) => text(typeof p === "string" ? p : p?.name))
        .filter(Boolean),
    ),
  ].slice(0, 12);
  const tags = (p) => [
    ...new Set(
      (Array.isArray(p?.places) ? p.places : [])
        .map((v) => text(v))
        .filter((v) => places.includes(v)),
    ),
  ];
  const people = (Array.isArray(raw?.people) ? raw.people : [])
    .flatMap((p) =>
      p && text(p.name)
        ? [
            {
              name: text(p.name),
              contactId: ids.has(p.contactId) ? p.contactId : "",
              detail: text(p.detail, 1000),
              places: tags(p),
            },
          ]
        : [],
    )
    .slice(0, 12);
  const plans = (Array.isArray(raw?.plans) ? raw.plans : [])
    .flatMap((p) =>
      p && text(p.title)
        ? [
            {
              title: text(p.title),
              detail: text(p.detail, 1000),
              places: tags(p),
            },
          ]
        : [],
    )
    .slice(0, 12);
  return { people, places, plans };
}

/** Reuse an extracted association only when its person ID or plan title matches. */
export function attachMemoPlaces(actions, objects) {
  return actions.slice(0, 12).map((action) => {
    if (!action || typeof action !== "object") return action;
    const object =
      action.kind === "contact"
        ? objects.people.find(
            (p) =>
              (action.contactId && p.contactId === action.contactId) ||
              (action.personName && p.name === action.personName),
          )
        : action.kind === "calendar"
          ? objects.plans.find((p) => p.title === action.title)
          : null;
    if (!object) return action;
    return {
      ...action,
      place: text(action.place || object.places.join(" · ")),
      ...(action.kind === "contact"
        ? { personName: text(action.personName || object.name) }
        : {}),
    };
  });
}
