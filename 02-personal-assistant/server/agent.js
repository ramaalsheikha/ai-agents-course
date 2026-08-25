import { ChatOllama } from "@langchain/ollama";
import { ChatOpenAI } from "@langchain/openai";
import { createAgent } from "langchain";
import { MemorySaver } from "@langchain/langgraph-checkpoint";
import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import { searchKnowledgeBase } from "./tools.js";
import {
  serpApiSearchTool,
  serpApiImageSearchTool,
} from "./tools-search-api.js";

// Shared checkpointer — thread IDs are namespaced per mode so histories stay separate.
const checkpointer = new MemorySaver();

export async function runAgent({
  sessionId = "default",
  message,
  mode = "rag",
}) {
  console.log(`[agent] Mode: ${mode.toUpperCase()} — sessionId: ${sessionId}`);

  let mcpClient = null;

  try {
    /*  For demonstration, we use the smaller Qwen 3.5 model from Ollama. 
        In a real application, you'd likely want a more capable model for better reasoning and tool use.
        To enable using OpenAI models, you'd switch to ChatOpenAI and ensure your environment is set up with OpenAI API keys.
     */
    const model = new ChatOllama({
      model: "qwen3.5:9b",
      temperature: 0,
      think: false,
    });

    // const model = new ChatOpenAI({
    //   model: "gpt-4o",
    //   temperature: 0,
    // });

    let tools;

    if (mode === "rag") {
      tools = [searchKnowledgeBase];
    } else if (mode === "api") {
      console.log("[agent] Mode: API — using direct SerpAPI REST tools");
      tools = [serpApiSearchTool, serpApiImageSearchTool];
    } else if (mode === "mcp") {
      console.log(
        "[agent] Mode: MCP — connecting to mcp-search-server at http://localhost:3002/mcp",
      );

      mcpClient = new MultiServerMCPClient({
        mcpServers: {
          "serp-search": {
            transport: "http",
            url: "http://localhost:3002/mcp",
          },
        },
      });

      tools = await mcpClient.getTools();
      console.log(
        `[agent] MCP tools discovered: ${tools.map((t) => t.name).join(", ")}`,
      );
    } else if (mode === "mcp-stdio") {
      console.log(
        "[agent] Mode: MCP-stdio — spawning stdio.js as child process",
      );

      mcpClient = new MultiServerMCPClient({
        mcpServers: {
          "serp-search": {
            transport: "stdio",
            command: "node",
            args: ["../../01-mcp-search-server/stdio.js"],
          },
        },
      });

      tools = await mcpClient.getTools();
      console.log(
        `[agent] MCP-stdio tools discovered: ${tools.map((t) => t.name).join(", ")}`,
      );
    } else {
      throw new Error(`Unknown mode: ${mode}`);
    }

    const agent = createAgent({
      model,
      tools,
      checkpointer,
      systemPrompt: `You are a helpful AI assistant with access to tools.

Call a tool when the user asks for information you do not already have: facts from the uploaded documents, current events, web results, or images. Answer from the tool output, not from memory.

Do not call a tool for greetings, thanks, farewells, small talk, or questions about who you are and what you can do. Reply to those directly in one or two short sentences, in the same language the user wrote in, and never quote document or search content in them.

If a tool returns nothing relevant, say so plainly instead of reporting unrelated results.

When a tool returns markdown image syntax like ![alt](url), you MUST include those exact markdown image tags in your response so the images render for the user. Do not describe or summarize images — pass the markdown through verbatim.`,
    });

    console.log(`🤖 Running agent for: "${message}"`);

    const response = await agent.invoke(
      {
        messages: [{ role: "user", content: message }],
      },
      {
        configurable: {
          // Namespace thread IDs per mode so conversation histories don't bleed across modes.
          thread_id: `${sessionId}-${mode}`,
        },
      },
    );

    const lastMessage = response.messages[response.messages.length - 1];
    const output = lastMessage?.content || "";

    console.log(`✅ Agent response: ${output.slice(0, 100)}...`);

    return { output, mode };
  } catch (error) {
    console.error("❌ Error in runAgent:", error);
    throw error;
  } finally {
    // Clean up MCP client connection.
    if (mcpClient) {
      await mcpClient.close().catch(() => undefined);
    }
  }
}
