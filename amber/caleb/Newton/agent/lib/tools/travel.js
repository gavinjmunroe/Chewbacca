/**
 * travel.js — Native trip planning, fully in-process.
 *
 * Replaces the former TREK MCP HTTP proxy with a Composio-free native
 * implementation backed by JSON files in the tenant's context repo
 * (same pattern as lib/tools/beads.js). No external deployment required.
 *
 * Why native:
 *   - Amber only ever called 9 MCP methods; TREK's PWA/map/collab UI was
 *     unused. Running a whole full-stack deployment for a JSON CRUD API
 *     was architectural overkill.
 *   - Single-process persistence aligns with the rest of the amber stack
 *     (context repo, beads).
 *   - Removes the TREK Railway service (and its DB) from the critical path.
 *
 * Storage:
 *   /trips/index.json          — { trips: Trip[], nextId: number }
 *   /trips/<id>/trip.json      — full nested trip record (itinerary,
 *                                reservations, expenses, packing)
 *
 * Trip record shape:
 *   {
 *     id: "trip-NNN",
 *     title, destination, startDate, endDate, currency, notes,
 *     createdBy: string,          // the `from` that created it
 *     groupId: string | null,     // if created in a group chat
 *     itinerary:    [{ day, place, time, notes, healthDimension }],
 *     reservations: [{ type, title, confirmationNumber, startTime,
 *                      location, cost, assignedTo, notes }],
 *     expenses:     [{ category, description, amount, paidBy, currency }],
 *     packing:      [{ item, category, assignedTo, packed }],
 *     created, updated  (ISO8601)
 *   }
 *
 * All handlers return { error: "…" } on failure, never throw.
 */

import { registerCapability } from "../capabilities.js";
import { readWikiFile, writeWikiFile } from "../context-repo.js";

registerCapability(
  "_tools_Travel",
  "Plan trips, manage itineraries, track budgets and packing (native, JSON-backed)",
);

const INDEX_PATH = "trips/index.json";
const DEFAULT_CURRENCY = "USD";

// ── Tool definitions for Claude (unchanged surface) ─────────────────────────
export const TRAVEL_TOOLS = [
  {
    name: "create_trip",
    description:
      "Create a new trip plan. Use when someone says 'plan a trip to X' or 'let's go to X'. " +
      "Captures destination, dates, and participants from conversation context.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Trip title, e.g. 'Tokyo Spring 2027'" },
        destination: { type: "string", description: "Where the trip is going" },
        startDate: { type: "string", description: "Start date (YYYY-MM-DD)" },
        endDate: { type: "string", description: "End date (YYYY-MM-DD)" },
        currency: { type: "string", description: "Budget currency (default USD)" },
        notes: { type: "string" },
      },
      required: ["title", "destination", "startDate", "endDate"],
    },
  },
  {
    name: "get_trip",
    description:
      "Get full details of a trip including itinerary, reservations, budget, and packing list.",
    input_schema: {
      type: "object",
      properties: { tripId: { type: "string" } },
      required: ["tripId"],
    },
  },
  {
    name: "list_trips",
    description: "List all trips. Use when someone asks 'what trips do we have'.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "add_to_itinerary",
    description: "Add a place or activity to a day in the trip itinerary.",
    input_schema: {
      type: "object",
      properties: {
        tripId: { type: "string" },
        day: { type: "integer", description: "Day number (1-based)" },
        place: { type: "string", description: "Place or activity name" },
        time: { type: "string", description: "Time, e.g. '9:00 AM'" },
        notes: { type: "string" },
        healthDimension: {
          type: "string",
          description: "Which health dimension this serves (social, physical, spiritual, etc.)",
        },
      },
      required: ["tripId", "day", "place"],
    },
  },
  {
    name: "add_reservation",
    description: "Add a reservation (flight, hotel, restaurant, activity) to a trip.",
    input_schema: {
      type: "object",
      properties: {
        tripId: { type: "string" },
        type: {
          type: "string",
          enum: ["flight", "hotel", "restaurant", "activity", "car", "train", "other"],
        },
        title: { type: "string" },
        confirmationNumber: { type: "string" },
        startTime: { type: "string", description: "ISO datetime or time string" },
        location: { type: "string" },
        cost: { type: "number" },
        assignedTo: { type: "string", description: "Who this is for" },
        notes: { type: "string" },
      },
      required: ["tripId", "type", "title"],
    },
  },
  {
    name: "add_expense",
    description: "Add an expense to the trip budget. Use when someone says 'I paid $X for Y'.",
    input_schema: {
      type: "object",
      properties: {
        tripId: { type: "string" },
        category: {
          type: "string",
          enum: ["food", "transport", "accommodation", "activity", "shopping", "other"],
        },
        description: { type: "string" },
        amount: { type: "number" },
        paidBy: { type: "string", description: "Who paid" },
        currency: { type: "string", description: "Currency (default USD)" },
      },
      required: ["tripId", "description", "amount"],
    },
  },
  {
    name: "get_budget_summary",
    description: "Get the budget summary for a trip including total spent and breakdown.",
    input_schema: {
      type: "object",
      properties: { tripId: { type: "string" } },
      required: ["tripId"],
    },
  },
  {
    name: "add_packing_item",
    description: "Add an item to the packing list. Can assign to specific person.",
    input_schema: {
      type: "object",
      properties: {
        tripId: { type: "string" },
        item: { type: "string" },
        category: {
          type: "string",
          enum: ["clothes", "toiletries", "electronics", "documents", "medicine", "other"],
        },
        assignedTo: { type: "string", description: "Who needs to bring this" },
      },
      required: ["tripId", "item"],
    },
  },
  {
    name: "get_packing_list",
    description: "Get the packing list for a trip, optionally filtered by person.",
    input_schema: {
      type: "object",
      properties: {
        tripId: { type: "string" },
        handle: { type: "string", description: "Filter by person (optional)" },
      },
      required: ["tripId"],
    },
  },
];

// ── Storage helpers ──────────────────────────────────────────────────────────

function tripPath(tripId) {
  return `trips/${tripId}/trip.json`;
}

async function loadIndex(tenant) {
  const res = await readWikiFile(tenant, INDEX_PATH);
  if (!res.success) {
    if (res.status === 404) {
      return { trips: [], nextId: 1, sha: null };
    }
    return { error: res.error || "could not read trips/index.json" };
  }
  try {
    const parsed = JSON.parse(res.content);
    return {
      trips: Array.isArray(parsed.trips) ? parsed.trips : [],
      nextId: typeof parsed.nextId === "number" ? parsed.nextId : 1,
      sha: res.sha,
    };
  } catch {
    return { error: "trips/index.json is not valid JSON" };
  }
}

async function saveIndex(tenant, index, message) {
  const body = JSON.stringify(
    { trips: index.trips, nextId: index.nextId },
    null,
    2,
  );
  const res = await writeWikiFile(
    tenant,
    INDEX_PATH,
    body,
    message || "update trips index",
    index.sha || null,
  );
  if (!res.success) return { error: res.error || "failed to write index" };
  return { sha: res.sha };
}

async function loadTrip(tenant, tripId) {
  const res = await readWikiFile(tenant, tripPath(tripId));
  if (!res.success) {
    if (res.status === 404) return { error: `trip not found: ${tripId}` };
    return { error: res.error || "could not read trip" };
  }
  try {
    return { trip: JSON.parse(res.content), sha: res.sha };
  } catch {
    return { error: "trip file is not valid JSON" };
  }
}

async function saveTrip(tenant, trip, prevSha, message) {
  trip.updated = new Date().toISOString();
  const body = JSON.stringify(trip, null, 2);
  const res = await writeWikiFile(
    tenant,
    tripPath(trip.id),
    body,
    message || `update ${trip.id}`,
    prevSha || null,
  );
  if (!res.success) return { error: res.error || "failed to write trip" };
  return { sha: res.sha };
}

function makeTripId(n) {
  return `trip-${String(n).padStart(3, "0")}`;
}

// ── Tool handlers ────────────────────────────────────────────────────────────

async function createTrip(input, ctx) {
  const idx = await loadIndex(ctx.tenant);
  if (idx.error) return { error: idx.error };

  const id = makeTripId(idx.nextId);
  const now = new Date().toISOString();
  const trip = {
    id,
    title: input.title,
    destination: input.destination,
    startDate: input.startDate,
    endDate: input.endDate,
    currency: input.currency || DEFAULT_CURRENCY,
    notes: input.notes || null,
    createdBy: ctx.from || null,
    groupId: ctx.groupId || null,
    itinerary: [],
    reservations: [],
    expenses: [],
    packing: [],
    created: now,
    updated: now,
  };

  const saved = await saveTrip(ctx.tenant, trip, null, `create ${id}`);
  if (saved.error) return { error: saved.error };

  idx.trips.push({
    id,
    title: trip.title,
    destination: trip.destination,
    startDate: trip.startDate,
    endDate: trip.endDate,
    createdBy: trip.createdBy,
    groupId: trip.groupId,
  });
  idx.nextId += 1;
  const idxSave = await saveIndex(ctx.tenant, idx, `register ${id}`);
  if (idxSave.error) return { error: idxSave.error };

  return { trip, id };
}

async function getTrip(input, ctx) {
  const { tripId } = input || {};
  if (!tripId) return { error: "tripId is required" };
  const loaded = await loadTrip(ctx.tenant, tripId);
  if (loaded.error) return loaded;
  return { trip: loaded.trip };
}

async function listTrips(_input, ctx) {
  const idx = await loadIndex(ctx.tenant);
  if (idx.error) return { error: idx.error };
  return { trips: idx.trips, count: idx.trips.length };
}

async function addToItinerary(input, ctx) {
  const { tripId, day, place, time, notes, healthDimension } = input || {};
  if (!tripId || !day || !place) {
    return { error: "tripId, day, and place are required" };
  }
  const loaded = await loadTrip(ctx.tenant, tripId);
  if (loaded.error) return loaded;

  const entry = {
    day,
    place,
    time: time || null,
    notes: notes || null,
    healthDimension: healthDimension || null,
    added: new Date().toISOString(),
  };
  loaded.trip.itinerary = loaded.trip.itinerary || [];
  loaded.trip.itinerary.push(entry);

  const saved = await saveTrip(
    ctx.tenant,
    loaded.trip,
    loaded.sha,
    `+ itinerary day ${day}: ${place}`,
  );
  if (saved.error) return { error: saved.error };
  return { entry, itinerary_count: loaded.trip.itinerary.length };
}

async function addReservation(input, ctx) {
  const { tripId, type, title } = input || {};
  if (!tripId || !type || !title) {
    return { error: "tripId, type, and title are required" };
  }
  const loaded = await loadTrip(ctx.tenant, tripId);
  if (loaded.error) return loaded;

  const reservation = {
    type,
    title,
    confirmationNumber: input.confirmationNumber || null,
    startTime: input.startTime || null,
    location: input.location || null,
    cost: typeof input.cost === "number" ? input.cost : null,
    assignedTo: input.assignedTo || null,
    notes: input.notes || null,
    added: new Date().toISOString(),
  };
  loaded.trip.reservations = loaded.trip.reservations || [];
  loaded.trip.reservations.push(reservation);

  const saved = await saveTrip(
    ctx.tenant,
    loaded.trip,
    loaded.sha,
    `+ ${type}: ${title}`,
  );
  if (saved.error) return { error: saved.error };
  return { reservation, reservations_count: loaded.trip.reservations.length };
}

async function addExpense(input, ctx) {
  const { tripId, description, amount } = input || {};
  if (!tripId || !description || typeof amount !== "number") {
    return { error: "tripId, description, and amount (number) are required" };
  }
  const loaded = await loadTrip(ctx.tenant, tripId);
  if (loaded.error) return loaded;

  const expense = {
    category: input.category || "other",
    description,
    amount,
    paidBy: input.paidBy || null,
    currency: input.currency || loaded.trip.currency || DEFAULT_CURRENCY,
    added: new Date().toISOString(),
  };
  loaded.trip.expenses = loaded.trip.expenses || [];
  loaded.trip.expenses.push(expense);

  const saved = await saveTrip(
    ctx.tenant,
    loaded.trip,
    loaded.sha,
    `+ expense: ${description} ${expense.currency}${amount}`,
  );
  if (saved.error) return { error: saved.error };
  return { expense, expenses_count: loaded.trip.expenses.length };
}

async function getBudgetSummary(input, ctx) {
  const { tripId } = input || {};
  if (!tripId) return { error: "tripId is required" };
  const loaded = await loadTrip(ctx.tenant, tripId);
  if (loaded.error) return loaded;

  const expenses = loaded.trip.expenses || [];
  const reservations = loaded.trip.reservations || [];

  const byCategory = {};
  let total = 0;
  for (const e of expenses) {
    byCategory[e.category] = (byCategory[e.category] || 0) + e.amount;
    total += e.amount;
  }
  let reservationsTotal = 0;
  for (const r of reservations) {
    if (typeof r.cost === "number") reservationsTotal += r.cost;
  }
  const byPerson = {};
  for (const e of expenses) {
    if (!e.paidBy) continue;
    byPerson[e.paidBy] = (byPerson[e.paidBy] || 0) + e.amount;
  }

  return {
    trip_id: tripId,
    currency: loaded.trip.currency || DEFAULT_CURRENCY,
    expenses_total: total,
    reservations_total: reservationsTotal,
    grand_total: total + reservationsTotal,
    by_category: byCategory,
    by_person: byPerson,
    expense_count: expenses.length,
  };
}

async function addPackingItem(input, ctx) {
  const { tripId, item } = input || {};
  if (!tripId || !item) return { error: "tripId and item are required" };
  const loaded = await loadTrip(ctx.tenant, tripId);
  if (loaded.error) return loaded;

  const entry = {
    item,
    category: input.category || "other",
    assignedTo: input.assignedTo || null,
    packed: false,
    added: new Date().toISOString(),
  };
  loaded.trip.packing = loaded.trip.packing || [];
  loaded.trip.packing.push(entry);

  const saved = await saveTrip(
    ctx.tenant,
    loaded.trip,
    loaded.sha,
    `+ packing: ${item}`,
  );
  if (saved.error) return { error: saved.error };
  return { entry, packing_count: loaded.trip.packing.length };
}

async function getPackingList(input, ctx) {
  const { tripId, handle } = input || {};
  if (!tripId) return { error: "tripId is required" };
  const loaded = await loadTrip(ctx.tenant, tripId);
  if (loaded.error) return loaded;

  let packing = loaded.trip.packing || [];
  if (handle) {
    const lc = String(handle).toLowerCase();
    packing = packing.filter(
      (p) => p.assignedTo && String(p.assignedTo).toLowerCase() === lc,
    );
  }
  return { items: packing, count: packing.length };
}

// ── Dispatcher ───────────────────────────────────────────────────────────────

export async function executeTravelTool(toolName, input, ctx = {}) {
  // ctx shape: { tenant, from, groupId } — tenant is needed for context repo.
  const effective = {
    tenant: ctx.tenant || null,
    from: ctx.from || null,
    groupId: ctx.groupId || null,
  };
  switch (toolName) {
    case "create_trip":
      return createTrip(input, effective);
    case "get_trip":
      return getTrip(input, effective);
    case "list_trips":
      return listTrips(input, effective);
    case "add_to_itinerary":
      return addToItinerary(input, effective);
    case "add_reservation":
      return addReservation(input, effective);
    case "add_expense":
      return addExpense(input, effective);
    case "get_budget_summary":
      return getBudgetSummary(input, effective);
    case "add_packing_item":
      return addPackingItem(input, effective);
    case "get_packing_list":
      return getPackingList(input, effective);
    default:
      return { error: `unknown travel tool: ${toolName}` };
  }
}
