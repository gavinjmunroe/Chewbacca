import { MessageSquare } from "lucide-react";

export const metadata = { title: "Messages | EGATS" };

export default function MessagesPage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center space-y-6 max-w-md mx-auto">
      <div className="w-20 h-20 bg-violet-500/10 border border-violet-500/20 rounded-3xl flex items-center justify-center">
        <MessageSquare className="w-10 h-10 text-violet-400" />
      </div>
      <div>
        <h1 className="text-2xl font-bold mb-2">Messages</h1>
        <p className="text-white/50">Direct messaging between dancers and recruiters is coming soon. For now, coordinate bookings through the booking system.</p>
      </div>
      <div className="bg-white/[0.04] border border-white/10 rounded-2xl p-5 text-left w-full">
        <h3 className="font-semibold mb-3 text-sm">Until then, you can:</h3>
        <ul className="space-y-2 text-sm text-white/50">
          <li>• Add notes when creating a booking request</li>
          <li>• Use evaluator notes in verification reviews</li>
          <li>• Contact via social links on profiles</li>
        </ul>
      </div>
    </div>
  );
}
