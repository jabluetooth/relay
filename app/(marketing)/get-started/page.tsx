import type { Metadata } from "next";
import Tag from "@/components/marketing/Tag";
import { LineReveal, Rise } from "@/components/marketing/Reveal";
import SectionNav from "@/components/marketing/SectionNav";
import CodeBlock from "@/components/marketing/CodeBlock";
import Checklist from "@/components/marketing/Checklist";
import Disclosure from "@/components/marketing/Disclosure";
import { REPO_URL } from "@/lib/site";

export const metadata: Metadata = {
  title: "Get started",
  description:
    "Run your own Relay: what you need, the exact steps as they work today, every environment variable, and fixes for the problems people actually hit.",
};

const NAV = [
  { id: "before", label: "Before you start" },
  { id: "code", label: "Get the code" },
  { id: "services", label: "Start the services" },
  { id: "config", label: "Configure" },
  { id: "run", label: "Run it" },
  { id: "trouble", label: "If it breaks" },
];

const PREREQS = [
  { id: "node", label: "Node.js 20.9 or newer", hint: "Relay runs on Next.js 16." },
  { id: "docker", label: "Docker, or a Postgres and a Qdrant you already have", hint: "Docker is the quickest way to get both running locally." },
  { id: "accounts", label: "Accounts at Google Cloud, Hugging Face, Groq and Upstash", hint: "Each one issues a key or token you paste into the setup wizard." },
  { id: "google", label: "The Google account you want to connect", hint: "You add it as a test user, because the OAuth app you create stays in Testing mode." },
  { id: "bash", label: "On Windows: Git Bash or WSL", hint: "The guided setup script is written in bash." },
];

const ENV = [
  ["DATABASE_URL", "Your Postgres connection string, e.g. postgres://postgres:<password>@localhost:5433/relay"],
  ["RELAY_OWNER_EMAIL", "The Google account you'll connect"],
  ["RELAY_ENCRYPTION_KEY", "Generate it (command below). Encrypts stored tokens"],
  ["RELAY_STATE_SECRET", "Generate it (command below). Signs the OAuth state"],
  ["GOOGLE_CLIENT_ID / _SECRET", "Google Cloud, OAuth client of type Web application"],
  ["GOOGLE_REDIRECT_URI", "http://localhost:3000/api/auth/google/callback"],
  ["QDRANT_URL / QDRANT_API_KEY", "http://localhost:6335 and the key you chose above"],
  ["HF_TOKEN", "Hugging Face, a Read token"],
  ["GROQ_API_KEY", "Groq console"],
  ["APP_BASE_URL", "Where Relay runs. Must be public HTTPS for Google push notifications"],
  ["QSTASH_*", "Upstash QStash token and signing keys, or QSTASH_DEV=true for the local emulator"],
] as const;

const FAQ = [
  {
    q: "Google says “This app isn't verified”",
    a: "Expected. The OAuth app you created is in Testing mode. Choose Advanced, then Go to Relay (unsafe). It is safe because you wrote the app and only you are on its test-user list.",
  },
  {
    q: "“Access blocked” or Error 403: access_denied",
    a: "The Google account you are signing in with is not on the consent screen's test-user list. Add it under APIs & Services, OAuth consent screen, Test users.",
  },
  {
    q: "Gmail shows “Quota exceeded”",
    a: "That is Gmail's per-user rate limit. Relay retries with backoff for about a minute and keeps partial progress, so run the sync again shortly and it continues from where it stopped.",
  },
  {
    q: "A source is stuck on “syncing”",
    a: "Each source holds a lock while it syncs so a duplicate job can't run twice. A lock left behind by a crash is treated as stale after 20 minutes and cleared automatically.",
  },
  {
    q: "The QStash emulator doesn't start on Windows",
    a: "The SDK's auto-installer fails on Windows because tar reads a C:\\ path as a remote host. Start it yourself in a separate terminal with npx @upstash/qstash-cli@latest dev and leave it running.",
  },
  {
    q: "It worked, then stopped working after a week",
    a: "For apps in Testing mode Google expires refresh tokens after seven days. Open Connections and reconnect the account.",
  },
];

function Step({ id, n, title, children }: { id: string; n: number; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-28 border-t border-border pb-[clamp(3.5rem,7vw,7rem)] pt-8">
      <p className="font-mono text-xs text-muted">0{n}</p>
      <LineReveal
        className="mt-3 text-[clamp(1.9rem,3.8vw,3.5rem)] font-semibold leading-[1] tracking-[-0.035em]"
        lines={[title]}
      />
      <div className="mt-8 space-y-6">{children}</div>
    </section>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="max-w-[64ch] leading-relaxed text-muted">{children}</p>;
}

export default function GetStartedPage() {
  return (
    <>
      <section className="px-[5vw] pb-[clamp(3rem,6vw,6rem)] pt-[clamp(2.5rem,6vw,6rem)]">
        <Rise inView={false}>
          <Tag>get started</Tag>
        </Rise>
        <LineReveal
          as="h1"
          inView={false}
          delay={0.1}
          className="mt-6 text-[clamp(2.75rem,8vw,8.5rem)] font-semibold leading-[0.93] tracking-[-0.045em]"
          lines={["Run your own.", "About an hour."]}
        />
        <Rise inView={false} delay={0.45}>
          <p className="mt-8 max-w-[54ch] text-lg leading-relaxed text-muted">
            Relay is self-hosted: your machine, your database, your Google Cloud project and your API keys. These are the
            steps as they work today. Most of the hour is clicking through Google Cloud.
          </p>
        </Rise>
      </section>

      <div className="grid gap-10 px-[5vw] lg:grid-cols-[minmax(0,3fr)_minmax(0,9fr)] lg:gap-16">
        <aside className="hidden lg:block">
          <div className="sticky top-28">
            <SectionNav items={NAV} label="get-started" />
          </div>
        </aside>

        <div>
          <Step id="before" n={1} title="Before you start">
            <Checklist items={PREREQS} />
          </Step>

          <Step id="code" n={2} title="Get the code">
            <CodeBlock prompt label="terminal" code={`git clone ${REPO_URL} relay\ncd relay\nnpm install`} />
          </Step>

          <Step id="services" n={3} title="Start the services">
            <P>
              Relay needs Postgres for provenance and Qdrant for vectors. If you have neither, these two commands start
              both in Docker. Replace the placeholder passwords, and keep the Qdrant key: it goes into your
              configuration.
            </P>
            <CodeBlock
              prompt
              label="postgres"
              code={"docker run -d --name relay-postgres \\\n  -e POSTGRES_PASSWORD=<choose-a-password> -e POSTGRES_DB=relay \\\n  -p 5433:5432 postgres:16"}
            />
            <CodeBlock
              prompt
              label="qdrant"
              code={"docker run -d --name relay-qdrant \\\n  -e QDRANT__SERVICE__API_KEY=<choose-a-key> \\\n  -p 6335:6333 -v relay_qdrant_storage:/qdrant/storage \\\n  qdrant/qdrant"}
            />
          </Step>

          <Step id="config" n={4} title="Configure">
            <P>
              The guided script opens each Google Cloud, Hugging Face, Groq and Upstash page in your browser, tells you
              what to click, and writes what you paste back into <span className="font-mono text-foreground">.env.local</span>.
              It does not create the database or the two secrets, so generate those yourself.
            </P>
            <CodeBlock prompt label="guided setup" code="./scripts/setup.sh" />
            <CodeBlock
              prompt
              label="generate the two secrets (run twice, one per variable)"
              code={`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`}
            />
            <div className="overflow-x-auto">
              <table className="w-full min-w-[30rem] text-left text-sm">
                <caption className="sr-only">Environment variables</caption>
                <tbody>
                  {ENV.map(([name, from]) => (
                    <tr key={name} className="border-b border-border first:border-t align-baseline">
                      <th scope="row" className="py-3 pr-4 font-mono text-xs font-normal">{name}</th>
                      <td className="py-3 text-muted">{from}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Step>

          <Step id="run" n={5} title="Run it">
            <CodeBlock prompt label="create the tables" code="npm run db:push" />
            <CodeBlock prompt label="second terminal, leave it running" code="npx @upstash/qstash-cli@latest dev" />
            <CodeBlock prompt label="the app" code="npm run dev" />
            <P>
              Open <span className="font-mono text-foreground">/connections</span>, connect Drive, and press Sync. When
              it finishes, ask a question on <span className="font-mono text-foreground">/chat</span>. Once you trust it,
              switch on auto-sync so every source keeps itself fresh.
            </P>
            <P>
              Keep it on localhost. Relay has no login of its own, so if you host it anywhere else, put authentication
              in front of it first. The security page explains why.
            </P>
          </Step>

          <section id="trouble" className="scroll-mt-28 border-t border-border pt-8">
            <p className="font-mono text-xs text-muted">06</p>
            <LineReveal
              className="mt-3 text-[clamp(1.9rem,3.8vw,3.5rem)] font-semibold leading-[1] tracking-[-0.035em]"
              lines={["If it breaks"]}
            />
            <div className="mt-8">
              <Disclosure items={FAQ} />
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
