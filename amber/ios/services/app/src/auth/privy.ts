import { PrivyClient } from '@privy-io/server-auth';
import { config } from '../config/env.js';

export const privy = new PrivyClient(config.privy.appId, config.privy.appSecret);

export interface PrivyUser {
  id: string;
  createdAt: number;
  linkedAccounts: Array<{
    type: string;
    address?: string;
    walletClientType?: string;
  }>;
}

export async function verifyPrivyToken(token: string): Promise<PrivyUser> {
  if (!privy) {
    throw new Error('Privy client not configured');
  }
  const claims = await privy.verifyAuthToken(token);
  return {
    id: claims.userId,
    createdAt: 0,
    linkedAccounts: [],
  };
}

