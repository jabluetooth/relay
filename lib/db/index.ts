import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

type Db = ReturnType<typeof drizzle<typeof schema>>;

// Connected on first use, not at import. `next build` imports every route
// module to collect page data, and the public site-only deployment has no
// database at all — an eager check here failed that build with
// "DATABASE_URL is not set". Everything that actually queries still gets the
// same clear error, just when it first touches `db`.
let instance: Db | undefined;

function connect(): Db {
  if (!instance) {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL is not set — see .env.example");
    }
    instance = drizzle(postgres(process.env.DATABASE_URL, { max: 10 }), { schema });
  }
  return instance;
}

export const db = new Proxy({} as Db, {
  get(_target, prop) {
    const real = connect();
    const value = Reflect.get(real, prop, real);
    return typeof value === "function" ? value.bind(real) : value;
  },
});

export * as schema from "./schema";
