import { fetchWithRetry } from "@/lib/http-retry";

// Hugging Face Inference API, same embedding model as Mimo (BAAI/bge-small-en-v1.5)
// for consistency with a pipeline already proven out on this stack.
//
// NOTE: as of late 2025, HuggingFace fully decommissioned the legacy
// api-inference.huggingface.co host in favor of router.huggingface.co's
// Inference Providers system (confirmed empirically: the old host now
// fails DNS resolution entirely). The token used here also needs the
// specific "Inference Providers" permission (generate one at
// https://huggingface.co/settings/tokens/new?ownUserPermissions=inference.serverless.write&tokenType=fineGrained),
// a plain "Read" token gets a 403 even against the correct URL.

const MODEL = "BAAI/bge-small-en-v1.5";
const ENDPOINT = `https://router.huggingface.co/hf-inference/models/${MODEL}/pipeline/feature-extraction`;

export async function embedText(text: string): Promise<number[]> {
  const token = process.env.HF_TOKEN;
  if (!token) throw new Error("HF_TOKEN is not set — see .env.example");

  const res = await fetchWithRetry(ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ inputs: text, options: { wait_for_model: true } }),
  });

  if (!res.ok) {
    throw new Error(`HuggingFace embedding request failed (${res.status}): ${await res.text()}`);
  }

  const embedding = (await res.json()) as number[];
  return embedding;
}
