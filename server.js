const express = require("express");
const cors = require("cors");
const { DataWeaveRunner } = require("./dataweaverunner");

const app = express();
app.use(cors());
app.use(express.json({ limit: "5mb" }));

app.use((req, res, next) => {
  const startedAt = Date.now();
  console.log(`[api] ${req.method} ${req.originalUrl}`);

  res.on("finish", () => {
    console.log(`[api] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${Date.now() - startedAt}ms)`);
  });

  next();
});

function normalizeDataWeaveScript(script) {
  if (typeof script !== "string") {
    return script;
  }

  if (script.includes("\n")) {
    return script;
  }

  if (script.includes("\\n")) {
    return script.replace(/\\n/g, "\n");
  }

  return script;
}

function normalizeInputs(inputs) {
  if (Array.isArray(inputs)) {
    return inputs;
  }

  return [];
}

const HEALTHCHECK_URL = process.env.HEALTHCHECK_URL || "https://dataweave-playground-latest.onrender.com/healthCheck";

async function checkHealthcheckUrl() {
  const startedAt = Date.now();

  try {
    const response = await fetch(HEALTHCHECK_URL, { method: "GET" });
    const durationMs = Date.now() - startedAt;

    console.log("[healthcheck] heartbeat ok", {
      url: HEALTHCHECK_URL,
      status: response.status,
      ok: response.ok,
      durationMs
    });

    return {
      ok: response.ok,
      status: response.status,
      durationMs
    };
  } catch (error) {
    const durationMs = Date.now() - startedAt;

    console.error("[healthcheck] heartbeat failed", {
      url: HEALTHCHECK_URL,
      durationMs,
      error: error.message
    });

    return {
      ok: false,
      status: 0,
      durationMs,
      error: error.message
    };
  }
}

// Points at your local Docker DataWeave compiler on :3000
const dw = new DataWeaveRunner({
  url: process.env.DW_COMPILER_URL || "https://dataweave-playground-latest.onrender.com/api/transform",
  version: process.env.DW_VERSION || "2.3.0"
});

app.get("/healthcheck", async (req, res) => {
  const result = await checkHealthcheckUrl();

  res.status(result.ok ? 200 : 503).json({
    status: result.ok ? "ok" : "degraded",
    upstream: HEALTHCHECK_URL,
    ...result
  });
});

app.post("/api/transform", async (req, res) => {
  const { script, inputs } = req.body || {};
  const normalizedScript = normalizeDataWeaveScript(script);
  const normalizedInputs = normalizeInputs(inputs);

  console.log("[api] incoming transform request", {
    scriptType: typeof script,
    scriptLength: typeof script === "string" ? script.length : 0,
    normalizedScriptLength: typeof normalizedScript === "string" ? normalizedScript.length : 0,
    inputsType: Array.isArray(inputs) ? "array" : typeof inputs,
    inputsCount: normalizedInputs.length,
    inputNames: normalizedInputs.map((input) => input && input.name).filter(Boolean)
  });

  if (!Array.isArray(inputs) && typeof inputs !== "undefined") {
    console.warn("[api] inputs was not an array; defaulting to []", {
      receivedType: typeof inputs
    });
  }

  try {
    const output = await dw.execute(normalizedScript, normalizedInputs);
    console.log("[api] transform completed", {
      outputType: typeof output,
      outputPreview: typeof output === "string" ? output.slice(0, 200) : JSON.stringify(output).slice(0, 200)
    });
    res.json({ output });
  } catch (err) {
    console.error("[api] transform failed", err);
    res.status(400).json({ error: err.message });
  }
});

app.get("/health", (req, res) => res.json({ status: "ok" }));
app.get("/healthcheck", async (req, res) => {
  const result = await checkHealthcheckUrl();

  res.status(result.ok ? 200 : 503).json({
    status: result.ok ? "ok" : "degraded",
    upstream: HEALTHCHECK_URL,
    ...result
  });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`DataWeave API listening on http://localhost:${PORT}`);
  console.log(`Forwarding compiles to ${dw.url}`);
  console.log(`Healthcheck target is ${HEALTHCHECK_URL}`);

  checkHealthcheckUrl();
  setInterval(() => {
    checkHealthcheckUrl();
  }, 3 * 60 * 1000);
});
