const split = (value) =>
  (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

const asDotSuffix = (suffix) => (suffix.startsWith(".") ? suffix : `.${suffix}`);

export const isAllowedOrigin = (origin, env) => {
  if (!origin) return false;

  if (split(env?.CLIENT_ORIGIN).includes(origin)) return true;

  const suffixes = split(env?.CLIENT_ORIGIN_SUFFIXES);
  if (suffixes.length === 0) return false;

  let hostname;
  let protocol;

  try {
    ({ hostname, protocol } = new URL(origin));
  } catch {
    return false;
  }

  if (protocol !== "https:") return false;

  return suffixes.some((suffix) => hostname.endsWith(asDotSuffix(suffix)));
};
