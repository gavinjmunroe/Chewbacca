/**
 * Google Sheets tools — REST API client.
 *
 * Reuses Google OAuth via google-oauth.js.
 * Service key prefix: SHEETS (falls back to GCAL)
 * Endpoint: https://sheets.googleapis.com/v4/spreadsheets/
 *
 * Tools:
 *   sheets_get_values          (spreadsheetId, range)
 *   sheets_append_row          (spreadsheetId, range, values)
 *   sheets_update_values       (spreadsheetId, range, values)
 *   sheets_create_spreadsheet  (title, initialValues?)
 */

import { getGoogleAccessToken } from "./google-oauth.js";
import { registerCapability } from "../capabilities.js";

registerCapability(
  "_tools_Sheets",
  "Read and write Google Sheets spreadsheets",
);

const SHEETS_BASE = "https://sheets.googleapis.com/v4/spreadsheets/";

// ---------------------------------------------------------------------------
// Tool schemas
// ---------------------------------------------------------------------------

export const SHEETS_TOOLS = [
  {
    name: "sheets_get_values",
    description:
      "Read cell values from a Google Sheet range (e.g. 'Sheet1!A1:D10').",
    input_schema: {
      type: "object",
      required: ["spreadsheetId", "range"],
      properties: {
        spreadsheetId: { type: "string" },
        range: {
          type: "string",
          description: "A1 notation range, e.g. 'Sheet1!A1:Z100'",
        },
      },
    },
  },
  {
    name: "sheets_append_row",
    description:
      "Append one or more rows to a Google Sheet after the last row of data.",
    input_schema: {
      type: "object",
      required: ["spreadsheetId", "range", "values"],
      properties: {
        spreadsheetId: { type: "string" },
        range: {
          type: "string",
          description:
            "A1 notation range specifying the sheet, e.g. 'Sheet1!A:Z'",
        },
        values: {
          type: "array",
          description:
            "2D array of rows to append, e.g. [[\"Name\",\"Score\"],[\"Alice\",95]]",
          items: { type: "array" },
        },
      },
    },
  },
  {
    name: "sheets_update_values",
    description: "Write values to a specific range in a Google Sheet.",
    input_schema: {
      type: "object",
      required: ["spreadsheetId", "range", "values"],
      properties: {
        spreadsheetId: { type: "string" },
        range: {
          type: "string",
          description: "A1 notation range, e.g. 'Sheet1!A1'",
        },
        values: {
          type: "array",
          description: "2D array of values to write",
          items: { type: "array" },
        },
      },
    },
  },
  {
    name: "sheets_create_spreadsheet",
    description: "Create a new Google Spreadsheet, optionally with data.",
    input_schema: {
      type: "object",
      required: ["title"],
      properties: {
        title: { type: "string", description: "Spreadsheet title" },
        initialValues: {
          type: "array",
          description:
            "Optional 2D array of initial cell values for Sheet1, e.g. [[\"A\",\"B\"],[1,2]]",
          items: { type: "array" },
        },
      },
    },
  },
];

// ---------------------------------------------------------------------------
// Executor
// ---------------------------------------------------------------------------

export async function executeSheetsTool(toolName, input, ctx) {
  const tenant = ctx?.tenant ?? ctx;
  let token;
  try {
    token = await getGoogleAccessToken(tenant, "sheets");
  } catch (e) {
    return { error: e.message, hint: "connect-first" };
  }

  try {
    switch (toolName) {
      case "sheets_get_values":
        return sheetsGetValues(token, input);
      case "sheets_append_row":
        return sheetsAppendRow(token, input);
      case "sheets_update_values":
        return sheetsUpdateValues(token, input);
      case "sheets_create_spreadsheet":
        return sheetsCreate(token, input);
      default:
        return { error: `Unknown Sheets tool: ${toolName}` };
    }
  } catch (e) {
    return { error: e.message };
  }
}

// ---------------------------------------------------------------------------
// Implementations
// ---------------------------------------------------------------------------

async function sheetsReq(method, url, token, body = null) {
  const opts = {
    method,
    headers: { Authorization: `Bearer ${token}` },
  };
  if (body !== null) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Sheets ${method} ${url} failed (${res.status}): ${text}`);
  }
  return res.json();
}

async function sheetsGetValues(token, { spreadsheetId, range }) {
  const enc = encodeURIComponent(range);
  const url = `${SHEETS_BASE}${encodeURIComponent(spreadsheetId)}/values/${enc}`;
  const data = await sheetsReq("GET", url, token);
  return {
    spreadsheetId,
    range: data.range,
    values: data.values ?? [],
    rowCount: (data.values ?? []).length,
  };
}

async function sheetsAppendRow(token, { spreadsheetId, range, values }) {
  const enc = encodeURIComponent(range);
  const url =
    `${SHEETS_BASE}${encodeURIComponent(spreadsheetId)}/values/${enc}:append` +
    `?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;

  const data = await sheetsReq("POST", url, token, {
    range,
    majorDimension: "ROWS",
    values,
  });

  return {
    success: true,
    spreadsheetId,
    updatedRange: data.updates?.updatedRange,
    updatedRows: data.updates?.updatedRows,
  };
}

async function sheetsUpdateValues(token, { spreadsheetId, range, values }) {
  const enc = encodeURIComponent(range);
  const url =
    `${SHEETS_BASE}${encodeURIComponent(spreadsheetId)}/values/${enc}` +
    `?valueInputOption=USER_ENTERED`;

  const data = await sheetsReq("PUT", url, token, {
    range,
    majorDimension: "ROWS",
    values,
  });

  return {
    success: true,
    spreadsheetId,
    updatedRange: data.updatedRange,
    updatedRows: data.updatedRows,
    updatedColumns: data.updatedColumns,
    updatedCells: data.updatedCells,
  };
}

async function sheetsCreate(token, { title, initialValues }) {
  const body = { properties: { title } };

  const data = await sheetsReq(
    "POST",
    SHEETS_BASE,
    token,
    body,
  );

  const spreadsheetId = data.spreadsheetId;

  if (initialValues?.length) {
    await sheetsUpdateValues(token, {
      spreadsheetId,
      range: "Sheet1!A1",
      values: initialValues,
    });
  }

  return {
    spreadsheetId,
    title,
    url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
  };
}
