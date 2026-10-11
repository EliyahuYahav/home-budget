import { getChatMessages, getMembers, requireContext } from "@/lib/data";
import { isClaudeConfigured } from "@/lib/env";
import { ChatWindow } from "./chat-window";

export default async function ChatPage() {
  const ctx = await requireContext();
  const [messages, members] = await Promise.all([getChatMessages(ctx), getMembers(ctx)]);

  return (
    <ChatWindow
      initialMessages={messages}
      memberNames={Object.fromEntries(members.map((m) => [m.user_id, m.display_name]))}
      currentUserId={ctx.userId}
      smartBot={isClaudeConfigured()}
    />
  );
}
