// Error monitoring — wire to Sentry, LogRocket, or similar
// To enable: npm install @sentry/nextjs && configure sentry.client.config.ts

export function captureException(error: unknown, context?: Record<string, unknown>) {
  // TODO: Replace with Sentry.captureException(error, { extra: context });
  if (process.env.NODE_ENV === "production") {
    // Production: errors are silently swallowed until monitoring is wired
    console.error("[monitoring]", error, context);
  }
}

export function captureMessage(message: string, level: "info" | "warning" | "error" = "info") {
  if (process.env.NODE_ENV !== "test") {
    console.log(`[${level}]`, message);
  }
}
