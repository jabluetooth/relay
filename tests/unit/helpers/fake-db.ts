// A stand-in for the Drizzle `db` proxy (lib/db/index.ts) so modules that
// query Postgres can be unit-tested with no database. Every query builder
// chain is recorded in `calls`, and each awaited read (a select, a
// `.returning()` write, or `db.execute`) takes the next queued result, in
// order. Writes without `.returning()` resolve to undefined, like Drizzle's.
//
// Use it with node:test's module mocking, keeping the real schema so
// drizzle's `eq(schema.x.y, ...)` still receives real column objects:
//
//   const fake = createFakeDb();
//   mockModule("lib/db/index.ts", { db: fake.db, schema });

import { mock } from "node:test";

export type Op = "select" | "insert" | "update" | "delete" | "execute";

export interface Call {
  op: Op;
  table?: unknown;
  values?: unknown;
  set?: unknown;
  returning: boolean;
}

type Chain = {
  from(table: unknown): Chain;
  where(...args: unknown[]): Chain;
  limit(n: number): Chain;
  orderBy(...args: unknown[]): Chain;
  groupBy(...args: unknown[]): Chain;
  values(v: unknown): Chain;
  set(v: unknown): Chain;
  onConflictDoUpdate(...args: unknown[]): Chain;
  onConflictDoNothing(...args: unknown[]): Chain;
  returning(...args: unknown[]): Chain;
  then<T>(resolve: (value: unknown) => T, reject?: (err: unknown) => T): Promise<T>;
};

export function createFakeDb() {
  const results: unknown[] = [];
  const calls: Call[] = [];

  function chain(op: Op, table?: unknown): Chain {
    const call: Call = { op, table, returning: false };
    calls.push(call);
    const self: Chain = {
      from(t) { call.table = t; return self; },
      where() { return self; },
      limit() { return self; },
      orderBy() { return self; },
      groupBy() { return self; },
      values(v) { call.values = v; return self; },
      set(v) { call.set = v; return self; },
      onConflictDoUpdate() { return self; },
      onConflictDoNothing() { return self; },
      returning() { call.returning = true; return self; },
      then(resolve, reject) {
        const reads = op === "select" || call.returning;
        const out = reads ? (results.length > 0 ? results.shift() : []) : undefined;
        return Promise.resolve(out).then(resolve, reject);
      },
    };
    return self;
  }

  const db = {
    select: () => chain("select"),
    insert: (table: unknown) => chain("insert", table),
    update: (table: unknown) => chain("update", table),
    delete: (table: unknown) => chain("delete", table),
    execute: async () => {
      calls.push({ op: "execute", returning: true });
      return results.length > 0 ? results.shift() : [];
    },
  };

  return {
    db,
    calls,
    /** Queues results for the next awaited reads, in order. */
    queue(...rows: unknown[]) {
      results.push(...rows);
    },
    /** Calls of one kind against one table, in the order they happened. */
    callsTo(op: Op, table?: unknown) {
      return calls.filter((c) => c.op === op && (table === undefined || c.table === table));
    },
    reset() {
      results.length = 0;
      calls.length = 0;
    },
  };
}

/** Absolute module URL for a path relative to the repo root. */
export function moduleUrl(pathFromRoot: string): string {
  return new URL(`../../../${pathFromRoot}`, import.meta.url).href;
}

/**
 * Replaces a module (a repo-relative path like "lib/qdrant.ts", or a package
 * name) with the given exports, for every import that happens afterwards.
 * Needs `--experimental-test-module-mocks`, which `npm test` passes. The cast
 * is only because the pinned @types/node predates the `exports` option.
 */
export function mockModule(specifier: string, exports: Record<string, unknown>): void {
  const target = specifier.includes("/") ? moduleUrl(specifier) : specifier;
  mock.module(target, { exports } as unknown as Parameters<typeof mock.module>[1]);
}
