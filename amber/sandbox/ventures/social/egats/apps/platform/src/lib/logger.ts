const isDev = process.env.NODE_ENV !== "production";

export const logger = {
  error: (context: string, error: unknown) => {
    if (isDev) {
      console.error(`[${context}]`, error);
    } else {
      console.error(`[${context}] Error`);
    }
  },
  info: (context: string, message: string) => {
    if (isDev) {
      console.log(`[${context}] ${message}`);
    }
  },
};
