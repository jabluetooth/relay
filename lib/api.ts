import { NextResponse } from "next/server";
import { z } from "zod";

const UUID = z.string().uuid();

export function isUuid(value: unknown): value is string {
  return UUID.safeParse(value).success;
}

/**
 * Parses a request's JSON body against a zod schema. Returns either the parsed
 * data or a ready-to-return 400, so a malformed or empty body is a clean client
 * error instead of an unhandled exception (a 500 with an empty body).
 */
export async function parseBody<S extends z.ZodTypeAny>(
  req: Request,
  schema: S,
): Promise<{ data: z.infer<S>; error?: undefined } | { data?: undefined; error: NextResponse }> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return { error: NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 }) };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return { error: NextResponse.json({ error: parsed.error.flatten() }, { status: 400 }) };
  }
  return { data: parsed.data };
}

/** Escapes LIKE/ILIKE wildcards so a search for "50%" means the literal text. */
export function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (c) => "\\" + c);
}
