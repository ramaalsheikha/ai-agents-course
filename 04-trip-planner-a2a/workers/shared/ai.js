const DEFAULT_TEXT_MODEL = "@cf/openai/gpt-oss-120b";
const DEFAULT_JSON_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

export const textModel = (env) => env.TEXT_MODEL || DEFAULT_TEXT_MODEL;
export const jsonModel = (env) => env.JSON_MODEL || DEFAULT_JSON_MODEL;

export const toText = (value) => {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(toText).filter(Boolean).join("");

  if (value && typeof value === "object") {
    if (Array.isArray(value.output)) {
      return value.output
        .filter((part) => part.type !== "reasoning")
        .map((part) => toText(part.content ?? part.text ?? ""))
        .filter(Boolean)
        .join("");
    }
    return toText(value.response ?? value.text ?? value.content ?? "");
  }

  return "";
};

export const toStructured = (value) => {
  if (!value || typeof value !== "object") return null;
  const payload = value.response;
  return payload && typeof payload === "object" && !Array.isArray(payload) ? payload : null;
};
