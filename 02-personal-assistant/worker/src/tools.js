import { embed, query } from "./pinecone.js";
import { normalizeText } from "./arabic.js";

const SERPAPI_ENDPOINT = "https://serpapi.com/search.json";

const searchSerpApi = async (env, engine, q, num = 5) => {
  if (!env.SERPAPI_API_KEY) throw new Error("SERPAPI_API_KEY is not set");

  const params = new URLSearchParams({
    q,
    engine,
    num: String(num),
    api_key: env.SERPAPI_API_KEY,
  });

  const res = await fetch(`${SERPAPI_ENDPOINT}?${params}`);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`SerpAPI error ${res.status}: ${body.slice(0, 500)}`);
  }

  return res.json();
};

export const searchKnowledgeBase = {
  name: "search_knowledge_base",
  description:
    "Searches the internal knowledge base for technical info and documentation. Use this when you need to find information from uploaded PDF documents.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "The search query to look up in the knowledge base",
      },
    },
    required: ["query"],
  },
  handler: async (env, { query: searchQuery }) => {
    const [vector] = await embed(env, [normalizeText(searchQuery)], "query");
    const matches = await query(env, vector, 4);

    const passages = matches
      .filter((match) => match.metadata?.text)
      .map((match) => {
        const { source, pageNumber, text } = match.metadata;
        const citation = source
          ? `${source}${pageNumber ? `, p.${pageNumber}` : ""}`
          : "unknown source";

        return `[${citation}]\n${text}`;
      });

    if (passages.length === 0) {
      return "No relevant information found in the knowledge base.";
    }

    return passages.join("\n\n---\n\n");
  },
};

export const webSearch = {
  name: "web_search",
  description:
    "Search the web using SerpAPI (Google). Use this to find current information on any topic.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "The search query" },
    },
    required: ["query"],
  },
  handler: async (env, { query: searchQuery }) => {
    const data = await searchSerpApi(env, "google", searchQuery);

    const results = (data.organic_results ?? [])
      .slice(0, 5)
      .map((r) => `**${r.title}**\n${r.link}\n${r.snippet ?? ""}`)
      .join("\n\n---\n\n");

    return results || "No results found.";
  },
};

export const imageSearch = {
  name: "image_search",
  description:
    "Search for images using SerpAPI (Google Images). Use this to find images on any topic.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "The image search query" },
    },
    required: ["query"],
  },
  handler: async (env, { query: searchQuery }) => {
    const data = await searchSerpApi(env, "google_images", searchQuery);

    const results = (data.images_results ?? [])
      .slice(0, 5)
      .map(
        (r) =>
          `![${r.title ?? "Image"}](${r.original})${r.source ? `\n_Source: ${r.source}_` : ""}`,
      )
      .join("\n\n---\n\n");

    return results || "No image results found.";
  },
};

export const TOOLS_BY_MODE = {
  rag: [searchKnowledgeBase],
  api: [webSearch, imageSearch],
};
