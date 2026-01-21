import { Content } from "@google/genai";
import { InMemoryRunner, isFinalResponse, stringifyContent } from "@google/adk";
import { directvAgent } from "./agent";

const directvRunner = new InMemoryRunner({
  agent: directvAgent,
  appName: "directv-internal-agent",
});

export async function runAgent(input: string) {
  const userId = `web-${Date.now()}`;
  const session = await directvRunner.sessionService.createSession({
    appName: directvRunner.appName,
    userId,
    state: {},
  });

  const newMessage: Content = {
    role: "user",
    parts: [{ text: input }],
  };

  const events = directvRunner.runAsync({
    userId: session.userId,
    sessionId: session.id,
    newMessage,
  });

  let finalResponse: string | null = null;
  let latestAgentContent: string | null = null;
  const toolOutputs: Array<{ name: string; payload: unknown }> = [];

  for await (const event of events) {
    if (process.env.NODE_ENV !== "production") {
      console.info("[ADK EVENT]", {
        author: event.author,
        hasContent: Boolean(event.content),
        content: event.content ? stringifyContent(event.content) : null,
        errorCode: (event as unknown as { errorCode?: string }).errorCode,
        errorMessage: (event as unknown as { errorMessage?: string }).errorMessage,
      });
      try {
        console.info("[ADK EVENT RAW]", JSON.stringify(event, null, 2));
      } catch (serializationError) {
        console.warn("[ADK EVENT RAW:error]", serializationError);
        console.dir(event, { depth: 4 });
      }
    }

    if (event.content?.parts) {
      for (const part of event.content.parts) {
        if ("functionResponse" in part && part.functionResponse) {
          toolOutputs.push({
            name: part.functionResponse.name,
            payload: part.functionResponse.response,
          });
        }
      }
    }

    if (event.author === directvAgent.name && event.content) {
      const serialized = stringifyContent(event.content).trim();
      if (serialized) {
        latestAgentContent = serialized;
      }
    }

    if (isFinalResponse(event) && event.content?.parts) {
      finalResponse = event.content.parts
        .map((part) => part.text)
        .filter((text): text is string => Boolean(text))
        .join("\n")
        .trim();
    }
  }

  if (finalResponse && finalResponse.length > 0) {
    return finalResponse;
  }

  if (latestAgentContent) {
    return latestAgentContent;
  }

  if (toolOutputs.length > 0) {
    const formatted = toolOutputs
      .map((entry) => {
        const data = (entry.payload as { result?: unknown })?.result ?? entry.payload;
        const prettyPayload = typeof data === "string" ? data : JSON.stringify(data, null, 2);
        return `Tool ${entry.name} response:\n${prettyPayload}`;
      })
      .join("\n\n");
    return formatted;
  }

  return "Agent run completed but no textual response was returned.";
}
