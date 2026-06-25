const OPENAI_API_KEY = "xx";
const ASSISTANT_ID = "asst_XXXXXXXXXXXX"; // your Assistant’s ID

type Run = {
  id: string;
  thread_id: string;
  status:
    | "queued" | "in_progress" | "requires_action"
    | "completed" | "failed" | "cancelled" | "expired";
  last_error?: { code: string; message: string } | null;
};

type MessageList = {
  data: Array<{
    id: string;
    role: "user" | "assistant";
    content: Array<
      | { type: "text"; text: { value: string; annotations: any[] } }
      | { type: string } // (images, file refs, etc.)
    >;
  }>;
};

async function createThreadAndRun(userText: string) {
  const res = await fetch("https://api.openai.com/v1/threads/runs", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
      "OpenAI-Beta": "assistants=v2",
    },
    body: JSON.stringify({
      assistant_id: ASSISTANT_ID,
      thread: {
        messages: [{ role: "user", content: userText }],
      },
    }),
  });
  if (!res.ok) throw new Error(`Create run failed: ${res.status} ${await res.text()}`);
  const run: Run = await res.json();
  return run;
}

async function waitForRun(threadId: string, runId: string, intervalMs = 1000) {
  while (true) {
    const res = await fetch(`https://api.openai.com/v1/threads/${threadId}/runs/${runId}`, {
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "OpenAI-Beta": "assistants=v2",
      },
    });
    if (!res.ok) throw new Error(`Poll failed: ${res.status} ${await res.text()}`);
    const run: Run = await res.json();

    if (run.status === "completed") return;
    if (["failed", "cancelled", "expired"].includes(run.status)) {
      throw new Error(`Run ${run.status}: ${run.last_error?.message ?? "no details"}`);
    }
    await new Promise(r => setTimeout(r, intervalMs));
  }
}

async function readLatestAssistantMessage(threadId: string) {
  const res = await fetch(
    `https://api.openai.com/v1/threads/${threadId}/messages?limit=1&order=desc`,
    {
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "OpenAI-Beta": "assistants=v2",
      },
    }
  );
  if (!res.ok) throw new Error(`List messages failed: ${res.status} ${await res.text()}`);
  const list: MessageList = await res.json();
  const msg = list.data[0];
  const text = msg?.content
    .filter((c: any) => c.type === "text")
    .map((c: any) => c.text.value)
    .join("\n");
  return text ?? "(no text content)";
}

async function main() {
  if (!OPENAI_API_KEY) throw new Error("Missing OPENAI_API_KEY");
  const userText = "In one sentence, what is the capital of Norway?";

  const run = await createThreadAndRun(userText);
  await waitForRun(run.thread_id, run.id);

  const reply = await readLatestAssistantMessage(run.thread_id);
}
