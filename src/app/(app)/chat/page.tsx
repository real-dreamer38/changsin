import { requireUser } from "@/lib/auth";
import { ChatInterface } from "@/components/chat/chat-interface";

export default async function ChatPage() {
  await requireUser();
  return <ChatInterface />;
}
