import { getChannelFeed, type SlackMessage } from "@/lib/slack";
import { Feed } from "@/components/Feed";
import { SetupNotice } from "@/components/SetupNotice";

// Re-render statically every hour (the "cron" refresh); client polling layers
// near-real-time updates on top of this.
export const revalidate = 3600;

export default async function Home() {
  let messages: SlackMessage[] = [];
  let error: string | null = null;

  try {
    messages = await getChannelFeed();
  } catch (err: any) {
    error = err?.message || "Failed to load the channel.";
  }

  if (error) {
    return <SetupNotice error={error} />;
  }

  return (
    <Feed
      initialMessages={messages}
      channelName={process.env.SLACK_CHANNEL_NAME || "medha"}
    />
  );
}
