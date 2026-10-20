import { BigQuery } from "@google-cloud/bigquery";
import { togariConfig, isBigQueryConfigured } from "./config.js";

let client;

function getClient() {
  if (!client) {
    const options = { projectId: togariConfig.gcpProjectId };
    const creds = togariConfig.gcpCredentialsBase64;
    if (creds) {
      options.credentials = JSON.parse(
        Buffer.from(creds, "base64").toString("utf8"),
      );
    }
    client = new BigQuery(options);
  }
  return client;
}

export function table(datasetKey, name) {
  const dataset = togariConfig.datasets[datasetKey];
  return `\`${togariConfig.gcpProjectId}.${dataset}.${name}\``;
}

export async function runQuery(sql, params = {}) {
  if (!isBigQueryConfigured()) {
    throw new Error("togari_not_configured");
  }
  const [rows] = await getClient().query({ query: sql, params });
  return rows;
}

export function _resetForTests() {
  client = undefined;
}
