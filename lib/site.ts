// Where the public site and the source live. Defaults are the real ones;
// the env vars exist so a fork can point its own deployment elsewhere.
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://relayby.filheinzrelatorre.com";
export const REPO_URL = process.env.NEXT_PUBLIC_REPO_URL ?? "https://github.com/jabluetooth/relay";
