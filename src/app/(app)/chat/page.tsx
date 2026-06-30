import { requireUser } from "@/lib/auth";
import { ChatWorkspace } from "@/components/chat/chat-workspace";

export default async function ChatPage() {
  await requireUser();
  return <ChatWorkspace />;
}
