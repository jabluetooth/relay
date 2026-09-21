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
    "Install Relay with one npm command. What you need, what the setup asks for, how to connect Google, and fixes for the problems people actually hit.",
};

const NAV = [
  { id: "before", label: "Before you start" },
  { id: "install", label: "Install and run" },
  { id: "setup", label: "The setup" },
  { id: "connect", label: "Connect Google" },
  { id: "commands", label: "Commands" },
  { id: "trouble", label: "If it breaks" },
];

const PREREQS = [
  { id: "node", label: "Node.js 20.9 or newer", hint: "Check with node --version." },
  { id: "docker", label: "Docker Desktop, running", hint: "Relay keeps its data in Postgres and Qdrant, and Docker starts both for you." },
  { id: "accounts", label: "Accounts at Google Cloud, Hugging Face and Groq", hint: "Each one gives you a key. The setup asks for them one at a time." },
  { id: "google", label: "The Google account you want to search", hint: "You add it as a test user in your own Google Cloud project." },
];

const COMMANDS = [
  ["relay", "Start Relay. The first run walks you through setup."],
  ["relay setup", "Enter or change your Google, Hugging Face and Groq keys."],
  ["relay doctor", "Check that Docker, both databases, the job runner and your keys are working."],
  ["relay stop", "Stop Postgres and Qdrant. Your data is kept."],
  ["relay --open", "Start Relay, then open it in your browser."],
] as const;

const FAQ = [
  {
    q: "It says Docker isn't running",
    a: "Open Docker Desktop and wait until it reports that it is running, then run relay again. Relay never starts Docker itself.",
  },
  {
    q: "Port 3000 is already in use",
    a: "Stop whatever is using it, or set PORT in ~/.relay/.env. If you change it, add the new redirect URI (with that port) to your OAuth client in Google Cloud.",
  },
  {
    q: "Google says “This app isn't verified”",
    a: "Expected. The OAuth app you created is in Testing mode. Choose Advanced, then Go to your app. It is safe because you created the app and only you are on its test-user list.",
  },
  {
    q: "“Access blocked” or Error 403: access_denied",
    a: "The Google account you are signing in with is not on the consent screen's test-user list. Add it under Google Auth Platform, Audience, Test users.",
  },
  {
    q: "“redirect_uri_mismatch”",
    a: "The redirect URI in your Google OAuth client has to match the one the setup printed exactly, including the port. Copy it again from the setup, or run relay setup to see it.",
  },
  {
    q: "Gmail shows “Quota exceeded”",
    a: "That is Gmail's per-user rate limit. Relay retries with backoff for about a minute and keeps partial progress, so press Sync again shortly and it continues from where it stopped.",
  },
  {
    q: "It worked, then stopped working after a week",
    a: "For apps in Testing mode Google expires refresh tokens after seven days. Open Connections and reconnect the account.",
  },
  {
    q: "Where is my data, and how do I remove it?",
    a: "Your keys are in ~/.relay/.env. Your indexed text is in two Docker volumes on this computer. To delete everything, run relay stop, then remove the volumes in Docker Desktop (their names start with relay_) and delete the ~/.relay folder. Disconnecting an account on the Connections page also deletes its indexed content and revokes Relay's access at Google.",
  },
  {
    q: "Something else is wrong",
    a: "Run relay doctor. It checks every part Relay depends on and tells you which one is failing and what to do about it.",
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

function Mono({ children }: { children: React.ReactNode }) {
  return <span className="font-mono text-foreground">{children}</span>;
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
          lines={["Run your own.", "One command."]}
        />
        <Rise inView={false} delay={0.45}>
          <p className="mt-8 max-w-[54ch] text-lg leading-relaxed text-muted">
            Relay runs on your own computer, with your own database and your own keys. Nothing is hosted for you, and
            nothing you index leaves your machine except the passages sent to the two model services. Most of the setup
            time is clicking through Google Cloud once.
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

          <Step id="install" n={2} title="Install and run">
            <CodeBlock prompt label="run it without installing anything" code="npx relay-workspace" />
            <P>
              The first run asks for your keys (next step), starts Postgres and Qdrant in Docker, creates the database
              tables, and starts Relay at <Mono>http://localhost:3000</Mono>. Prefer a permanent command?
            </P>
            <CodeBlock prompt label="or install it once" code={"npm install -g relay-workspace\nrelay"} />
          </Step>

          <Step id="setup" n={3} title="The setup">
            <P>
              Relay reads your Workspace through a Google Cloud project that you own, so nobody else ever holds access to
              your data. The setup prints these four steps with links. You do them once.
            </P>
            <ol className="max-w-[64ch] list-decimal space-y-3 pl-5 leading-relaxed text-muted marker:font-mono marker:text-xs">
              <li>Create a project in Google Cloud, then enable the Drive, Docs, Gmail, Calendar and Sheets APIs.</li>
              <li>
                Set up the OAuth consent screen as <Mono>External</Mono> with publishing status <Mono>Testing</Mono>, and
                add your own Google account under Test users.
              </li>
              <li>
                Create an OAuth client of type <Mono>Web application</Mono> with the authorized redirect URI{" "}
                <Mono>http://localhost:3000/api/auth/google/callback</Mono>.
              </li>
              <li>Copy the client ID and client secret. Then create a Hugging Face token (Read) and a Groq API key.</li>
            </ol>
            <P>
              Paste each key when asked. Hugging Face and Groq keys are tested on the spot, so a typo is caught before
              anything starts. Relay also generates its own encryption key and database passwords and keeps them in{" "}
              <Mono>~/.relay/.env</Mono>. Back that file up: the encryption key protects your stored Google access, and
              without it you would have to reconnect.
            </P>
          </Step>

          <Step id="connect" n={4} title="Connect Google">
            <P>
              Open <Mono>/connections</Mono>, connect Drive, and press Sync. When it finishes, ask a question on{" "}
              <Mono>/chat</Mono>. Gmail is opt-in: you pick a label or a date range first, because Relay never indexes a
              whole mailbox by default. Once you trust it, switch on auto-sync so sources keep themselves fresh.
            </P>
            <P>
              Drive and Calendar refresh when you press Sync, and Gmail is checked every five minutes. Google can only
              push change notifications to a public HTTPS address, which a computer at home does not have.
            </P>
          </Step>

          <Step id="commands" n={5} title="Commands">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[28rem] text-left text-sm">
                <caption className="sr-only">Relay commands</caption>
                <tbody>
                  {COMMANDS.map(([cmd, what]) => (
                    <tr key={cmd} className="border-b border-border first:border-t align-baseline">
                      <th scope="row" className="py-3 pr-6 font-mono text-xs font-normal">{cmd}</th>
                      <td className="py-3 text-muted">{what}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <P>
              Relay listens only on <Mono>127.0.0.1</Mono> and has no login, because it is built for one person on one
              computer. Do not expose it to a network. The security page explains what protects it and what does not.
            </P>
          </Step>

          <section id="trouble" className="scroll-mt-28 border-t border-border pt-8">
            <p className="font-mono text-xs text-muted">06</p>
            <LineReveal
              className="mt-3 text-[clamp(1.9rem,3.8vw,3.5rem)] font-semibold leading-[1] tracking-[-0.035em]"
              lines={["If it breaks"]}
            />
            <div className="mt-8 space-y-8">
              <Disclosure items={FAQ} />
              <div>
                <p className="mb-3 font-mono text-xs uppercase tracking-[0.1em] text-muted">Building from source instead</p>
                <CodeBlock
                  prompt
                  label="terminal"
                  code={`git clone ${REPO_URL} relay\ncd relay\nnpm install\nnpm run build:package\nnode bin/relay.mjs`}
                />
              </div>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
