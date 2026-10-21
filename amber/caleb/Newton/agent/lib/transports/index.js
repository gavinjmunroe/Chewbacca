/**
 * Transport router — Loop Message (iMessage) only.
 */

import { sendMessage as sendLoop, sendTapback } from "../transport.js";

/**
 * Send a message via Loop Message (iMessage).
 * @param {string} platform - always "imessage"
 * @param {string} chatId - phone number or group ID
 * @param {string} message - text to send
 * @param {object} opts - Loop-specific options (group, etc.)
 */
export async function sendMultiPlatform(platform, chatId, message, opts = {}) {
  return sendLoop(chatId, message, opts);
}

/**
 * Get platform status.
 */
export function getPlatformStatus() {
  return {
    imessage: { configured: true, name: "iMessage (Loop)" },
  };
}

export { sendTapback };
