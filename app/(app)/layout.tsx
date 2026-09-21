import Shell from "@/components/Shell";

// The product itself (chat, connections, observability) keeps the
// persistent app shell; the public site under (marketing) has its own.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <Shell>{children}</Shell>;
}
