const CALL_KEYS = new Set([
  "name",
  "parameters",
  "arguments",
  "args",
  "input",
  "type",
  "id",
]);

const WRAPPER_RESIDUE =
  /<\/?tool_call>|<\/?function_call>|```(?:json|tool_code)?/gi;

const objectSpans = (text) => {
  const spans = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }

    if (char === '"') {
      inString = true;
    } else if (char === "{") {
      if (depth === 0) start = i;
      depth += 1;
    } else if (char === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0)
        spans.push({ start, end: i + 1, body: text.slice(start, i + 1) });
    }
  }

  return spans;
};

const INVALID_ESCAPE = /\\(?!["\\/bfnrtu])/g;

const parseLoose = (body) => {
  try {
    return JSON.parse(body);
  } catch {
    try {
      return JSON.parse(body.replace(INVALID_ESCAPE, ""));
    } catch {
      return undefined;
    }
  }
};

const isToolCall = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  if (typeof value.name !== "string") return false;

  const keys = Object.keys(value);
  if (!keys.every((key) => CALL_KEYS.has(key))) return false;

  return (
    value.type === "function" ||
    keys.some((key) => key !== "name" && key !== "id")
  );
};

export const stripToolCalls = (raw) => {
  const text = String(raw ?? "");
  let cleaned = "";
  let cursor = 0;
  let stripped = false;

  for (const span of objectSpans(text)) {
    const parsed = parseLoose(span.body);
    if (!isToolCall(parsed)) continue;

    cleaned += text.slice(cursor, span.start);
    cursor = span.end;
    stripped = true;
  }

  cleaned += text.slice(cursor);

  if (!stripped) return text;

  return cleaned
    .replace(WRAPPER_RESIDUE, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
};
