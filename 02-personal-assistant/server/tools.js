import { tool } from "langchain";
import { z } from "zod";
import { PineconeStore } from "@langchain/pinecone";
import { PineconeEmbeddings } from "@langchain/pinecone";
import { Pinecone as PineconeClient } from "@pinecone-database/pinecone";
import { normalizeText } from "./lib/arabic.js";

let vectorStore;

const getVectorStore = async () => {
  if (vectorStore) return vectorStore;

  const apiKey = process.env.PINECONE_API_KEY;
  const indexName = process.env.PINECONE_INDEX;

  if (!apiKey) {
    throw new Error("Missing PINECONE_API_KEY");
  }
  if (!indexName) {
    throw new Error("Missing PINECONE_INDEX");
  }

  const pc = new PineconeClient({ apiKey });
  const index = pc.Index(indexName);

  // This MUST match the embedding model used during ingestion
  const embeddings = new PineconeEmbeddings({
    model: "llama-text-embed-v2",
  });

  vectorStore = await PineconeStore.fromExistingIndex(embeddings, {
    pineconeIndex: index,
  });

  return vectorStore;
};

const formatResult = (doc) => {
  const { source, pageNumber } = doc.metadata ?? {};
  const citation = source ? `${source}${pageNumber ? `, p.${pageNumber}` : ""}` : "unknown source";

  return `[${citation}]\n${doc.pageContent}`;
};

export const searchKnowledgeBase = tool(
  async ({ query }) => {
    const normalized = normalizeText(query);
    console.log(`🔍 Agent is searching Pinecone for: "${normalized}"`);

    const store = await getVectorStore();
    const results = await store.similaritySearch(normalized, 10);

    if (results.length === 0) {
      return "No relevant information found in the knowledge base.";
    }

    return results.map(formatResult).join("\n\n---\n\n");
  },
  {
    name: "search_knowledge_base",
    description:
      "Searches the internal knowledge base for technical info and documentation. Use this when you need to find information from uploaded PDF documents.",
    schema: z.object({
      query: z
        .string()
        .describe("The search query to look up in the knowledge base"),
    }),
  },
);
