import { getChatMessages, getMembers, requireContext } from "@/lib/data";
import { resolveClaudeKey } from "@/lib/claude-key";
import { ChatWindow } from "./chat-window";

export default async function ChatPage() {
  const ctx = await requireContext();
  const [messages, members, claudeKey] = await Promise.all([
    getChatMessages(ctx),
    getMembers(ctx),
    resolveClaudeKey(ctx),
  ]);

  return (
    <ChatWindow
      initialMessages={messages}
      memberNames={Object.fromEntries(members.map((m) => [m.user_id, m.display_name]))}
      currentUserId={ctx.userId}
      smartBot={claudeKey.source !== "none"}
    />
  );
}
