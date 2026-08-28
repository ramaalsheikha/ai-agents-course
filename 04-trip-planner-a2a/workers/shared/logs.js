const MAX_LOG_ENTRIES = 200;

export const createLogCollector = (label) => {
  const logs = [];

  const log = (component, message, status = "info") => {
    if (logs.length < MAX_LOG_ENTRIES) {
      logs.push({ ts: Date.now(), component, message, status });
    }
    console.log(`[${label}] [${component}] ${message}`);
  };

  return { logs, log };
};

export const summarizeArgs = (args) => {
  const text = JSON.stringify(args ?? {});
  return text.length > 160 ? `${text.slice(0, 157)}...` : text;
};
