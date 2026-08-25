export class ApiError extends Error {
  constructor({ message, status, code, detail }) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

const CODE_MESSAGES = {
  4006: "The AI service has hit its usage limit. Please try again in a little while.",
  3040: "The AI service is temporarily unavailable. Please try again in a moment.",
  3036: "The AI service has hit its usage limit. Please try again in a little while.",
};

const STATUS_MESSAGES = {
  400: "That request could not be processed. Please rephrase and try again.",
  401: "The service is not authorized right now. Please contact the administrator.",
  403: "The service is not authorized right now. Please contact the administrator.",
  404: "The service endpoint could not be reached. Please try again later.",
  413: "That file is too large. Please upload a PDF under 25MB.",
  429: "Too many requests. Please wait a moment before trying again.",
  500: "Something went wrong on our side. Please try again.",
  502: "The service is temporarily unavailable. Please try again in a moment.",
  503: "The service is temporarily unavailable. Please try again in a moment.",
  504: "The request took too long. Please try again.",
};

const PATTERN_MESSAGES = [
  [/quota|limit exceeded|out of credit|insufficient|balance/i, "The AI service has hit its usage limit. Please try again in a little while."],
  [/rate.?limit|too many requests/i, "Too many requests. Please wait a moment before trying again."],
  [/timeout|timed out|deadline/i, "The request took too long. Please try again."],
  [/failed to fetch|networkerror|load failed/i, "Cannot reach the server. Check your connection and try again."],
  [/capacity|overloaded|unavailable/i, "The service is temporarily unavailable. Please try again in a moment."],
  [/only pdf/i, "Only PDF files can be uploaded."],
  [/25mb|too large|exceeds/i, "That file is too large. Please upload a PDF under 25MB."],
];

const DEFAULT_MESSAGE = "Something went wrong. Please try again.";

export const extractErrorCode = (text) => {
  const match = /\b(\d{4})\b/.exec(text ?? "");
  return match ? Number(match[1]) : null;
};

export const toFriendlyMessage = (error) => {
  const code = error?.code ?? extractErrorCode(error?.detail ?? error?.message);
  if (code && CODE_MESSAGES[code]) return CODE_MESSAGES[code];

  const raw = `${error?.detail ?? ""} ${error?.message ?? ""}`;
  const pattern = PATTERN_MESSAGES.find(([regex]) => regex.test(raw));
  if (pattern) return pattern[1];

  if (error?.status && STATUS_MESSAGES[error.status]) return STATUS_MESSAGES[error.status];

  return DEFAULT_MESSAGE;
};
