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

const SHARED_RULES = `Do not call a tool for greetings, thanks, farewells, small talk, or questions about who you are and what you can do. Reply to those directly in one or two short sentences, in the same language the user wrote in, and never quote document or search content in them.

If a tool returns nothing relevant, say so plainly instead of reporting unrelated results. Never fill the gap from memory.

When a tool returns markdown image syntax like ![alt](url), you MUST include those exact markdown image tags in your response so the images render for the user. Do not describe or summarize images — pass the markdown through verbatim.`;

const MODE_RULES = {
  rag: `You are a document assistant. The only knowledge you have about the user's documents comes from the search_knowledge_base tool.

For any question that is not small talk, call search_knowledge_base first, every time, before you answer. Do this even when the subject sounds familiar — names in these documents refer to the user's own material, not to anything you may recognise from training. Answering a document question from memory is always wrong.

Each passage is prefixed with its source as [filename, p.N]. Ground every claim in the returned passages and cite the filename you used. Answer in the language the user wrote in.`,
  api: `Use the web and image search tools for anything about current events, live data, or images.`,
  mcp: `Use the tools discovered from the MCP server for anything about current events, live data, or images.`,
};

const buildSystemPrompt = (mode) =>
  `${MODE_RULES[mode] ?? MODE_RULES.api}\n\n${SHARED_RULES}`;

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
      systemPrompt: buildSystemPrompt(mode),
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
