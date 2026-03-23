import { tool } from "langchain";
import { z } from "zod";

// Direct SerpAPI REST call — the agent process owns the API key and HTTP logic.
export const serpApiSearchTool = tool(
  async ({ query }) => {
    console.log(`[API mode] Calling SerpAPI REST directly for: "${query}"`);

    const apiKey = process.env.SERPAPI_API_KEY;
    if (!apiKey) {
      throw new Error("SERPAPI_API_KEY is not set");
    }

    const params = new URLSearchParams({
      q: query,
      api_key: apiKey,
      engine: "google",
      num: "5",
    });
    const res = await fetch(`https://serpapi.com/search.json?${params}`);

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`SerpAPI error ${res.status}: ${text}`);
    }

    const data = await res.json();
    const results = (data.organic_results ?? [])
      .map((r) => `**${r.title}**\n${r.link}\n${r.snippet ?? ""}`)
      .join("\n\n---\n\n");

    return results || "No results found.";
  },
  {
    name: "web_search",
    description:
      "Search the web using SerpAPI (Google). Use this to find current information on any topic.",
    schema: z.object({
      query: z.string().describe("The search query"),
    }),
  },
);

// Another direct REST call — every new tool means more code in the client.
export const serpApiImageSearchTool = tool(
  async ({ query }) => {
    console.log(`[API mode] Calling SerpAPI Images REST directly for: "${query}"`);

    const apiKey = process.env.SERPAPI_API_KEY;
    if (!apiKey) {
      throw new Error("SERPAPI_API_KEY is not set");
    }

    const params = new URLSearchParams({
      q: query,
      api_key: apiKey,
      engine: "google_images",
      num: "5",
    });
    const res = await fetch(`https://serpapi.com/search.json?${params}`);

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`SerpAPI error ${res.status}: ${text}`);
    }

    const data = await res.json();
    const results = (data.images_results ?? [])
      .slice(0, 5)
      .map((r) => `![${r.title ?? "Image"}](${r.original})${r.source ? `\n_Source: ${r.source}_` : ""}`)
      .join("\n\n---\n\n");

    return results || "No image results found.";
  },
  {
    name: "image_search",
    description:
      "Search for images using SerpAPI (Google Images). Use this to find images on any topic.",
    schema: z.object({
      query: z.string().describe("The image search query"),
    }),
  },
);
