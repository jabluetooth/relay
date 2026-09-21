import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/lib/db";
import { getOrCreateOwnerUser } from "@/lib/db/owner";
import { answerQuery } from "@/lib/rag/pipeline";

const bodySchema = z.object({
  sessionId: z.string().uuid().optional(),
  message: z.string().min(1).max(2000),
});

export async function POST(req: NextRequest) {
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { message } = parsed.data;
  let { sessionId } = parsed.data;

  if (sessionId) {
    const [session] = await db
      .select()
      .from(schema.chatSessions)
      .where(eq(schema.chatSessions.id, sessionId))
      .limit(1);
    if (!session) return NextResponse.json({ error: "Session not found" }, { status: 404 });
  } else {
    const user = await getOrCreateOwnerUser();
    const [session] = await db.insert(schema.chatSessions).values({ userId: user.id }).returning();
    sessionId = session.id;
  }

  await db.insert(schema.chatMessages).values({ sessionId, role: "user", content: message });

  const result = await answerQuery(message);

  const [assistantMessage] = await db
    .insert(schema.chatMessages)
    .values({
      sessionId,
      role: "assistant",
      content: result.answer,
      confidence: result.confidence,
      refused: result.refused,
    })
    .returning();

  if (result.citations.length > 0) {
    await db.insert(schema.citations).values(
      result.citations.map((c) => ({
        messageId: assistantMessage.id,
        chunkId: c.chunkId,
        snippet: c.snippet,
      }))
    );
  }

  return NextResponse.json({
    sessionId,
    answer: result.answer,
    refused: result.refused,
    confidence: result.confidence,
    citations: result.citations,
  });
}
