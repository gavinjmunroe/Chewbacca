import express from "express";
import {
  togariConfig,
  isBigQueryConfigured,
  isMcpConfigured,
} from "./config.js";

export const togariRouter = express.Router();

export function ok(res, data) {
  res.json({ success: true, data });
}

export function fail(res, status, error) {
  res.status(status).json({ success: false, error });
}

export function wrap(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      if (err.message === "togari_not_configured") {
        return fail(res, 503, "togari_not_configured");
      }
      if (/Not found: Dataset/.test(err.message || "")) {
        return fail(
          res,
          503,
          "This view's data layer is not provisioned in Togari yet.",
        );
      }
      console.error("[togari]", err);
      fail(res, 500, err.message || "internal_error");
    }
  };
}

togariRouter.get(
  "/status",
  wrap(async (req, res) => {
    ok(res, {
      brand: togariConfig.brand,
      bigquery: isBigQueryConfigured(),
      mcp: isMcpConfigured(),
      channels: togariConfig.channels.map((c) => c.key),
    });
  }),
);

import { registerPeopleRoutes } from "./people.js";
registerPeopleRoutes(togariRouter);

import { registerChannelRoutes } from "./channels.js";
registerChannelRoutes(togariRouter);

import { registerPipelineRoutes } from "./pipeline.js";
registerPipelineRoutes(togariRouter);

import { registerManagementRoutes } from "./management.js";
registerManagementRoutes(togariRouter);

import { registerChatRoutes } from "./chat.js";
registerChatRoutes(togariRouter);

import { registerCompanyRoutes } from "./companies.js";
registerCompanyRoutes(togariRouter);

import { registerSettingsRoutes } from "./settings.js";
registerSettingsRoutes(togariRouter);
