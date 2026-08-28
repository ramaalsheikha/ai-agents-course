import { embed, query } from "./pinecone.js";
import { normalizeText } from "../../shared/arabic.js";

const SERPAPI_ENDPOINT = "https://serpapi.com/search.json";

const noop = () => {};

const searchSerpApi = async (env, engine, q, num = 5, log = noop) => {
  if (!env.SERPAPI_API_KEY) throw new Error("SERPAPI_API_KEY is not set");

  const params = new URLSearchParams({
    q,
    engine,
    num: String(num),
    api_key: env.SERPAPI_API_KEY,
  });

  log("api", `Calling SerpAPI ${engine} for "${q}"...`, "pending");

  const res = await fetch(`${SERPAPI_ENDPOINT}?${params}`);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    log("api", `SerpAPI responded ${res.status}`, "error");
    throw new Error(`SerpAPI error ${res.status}: ${body.slice(0, 500)}`);
  }

  log("api", `SerpAPI responded ${res.status} OK`, "success");

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
  handler: async (env, { query: searchQuery }, log = noop) => {
    log("rag", `Searching Pinecone for "${searchQuery}"...`, "pending");

    const [vector] = await embed(env, [normalizeText(searchQuery)], "query");
    const matches = await query(env, vector, 4);

    log(
      "rag",
      `Pinecone returned ${matches.length} match${matches.length === 1 ? "" : "es"}`,
      "success",
    );

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
      log("rag", "No passage carried usable text, answering without context", "error");
      return "No relevant information found in the knowledge base.";
    }

    log("rag", `Grounding the answer in ${passages.length} passages`, "info");

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
  handler: async (env, { query: searchQuery }, log = noop) => {
    const data = await searchSerpApi(env, "google", searchQuery, 5, log);

    const organic = (data.organic_results ?? []).slice(0, 5);
    log("api", `${organic.length} organic result${organic.length === 1 ? "" : "s"} kept`, "info");

    const results = organic
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
  handler: async (env, { query: searchQuery }, log = noop) => {
    const data = await searchSerpApi(env, "google_images", searchQuery, 5, log);

    const images = (data.images_results ?? []).slice(0, 5);
    log("api", `${images.length} image result${images.length === 1 ? "" : "s"} kept`, "info");

    const results = images
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
