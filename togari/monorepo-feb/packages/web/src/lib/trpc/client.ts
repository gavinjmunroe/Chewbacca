import { createTRPCReact } from '@trpc/react-query';
import { httpBatchLink } from '@trpc/client';
import type { AppRouter } from '@togari/api';

export const trpc = createTRPCReact<AppRouter>();

export function getTRPCClient() {
  return trpc.createClient({
    links: [
      httpBatchLink({
        url: `${process.env.NEXT_PUBLIC_API_URL}/api/trpc`,
        async headers() {
          // Get Clerk token and pass to API
          return {
            authorization: `Bearer ${await getToken()}`,
          };
        },
      }),
    ],
  });
}

async function getToken(): Promise<string> {
  // This will be implemented with Clerk's useAuth hook in components
  return '';
}
