/**
 * DataWeaveRunner
 * Thin client for a local DataWeave compiler service (e.g. your Docker image
 * listening on :3000) that POSTs a script + inputs and returns the result.
 */
class DataWeaveRunner {
    constructor({
        url = "http://localhost:3000/api/transform",
        version = "2.3.0",
        timeoutMs = 15000
    } = {}) {
        this.url = url;
        this.version = version;
        this.timeoutMs = timeoutMs;
    }

    async execute(script, inputs = []) {
        if (!script || typeof script !== "string") {
            throw new Error("`script` is required and must be a string");
        }
        if (!Array.isArray(inputs)) {
            throw new Error("`inputs` must be an array");
        }

        console.log("[dw] preparing request", {
            url: this.url,
            version: this.version,
            scriptLength: script.length,
            scriptPreview: script.slice(0, 160),
            inputs: inputs.map((input) => ({
                name: input && input.name,
                mimeType: (input && input.mimeType) || "application/json"
            }))
        });

        const body = {
            script,
            inputs: inputs.map((input, i) => {
                if (!input || typeof input.name !== "string") {
                    throw new Error(`inputs[${i}] is missing a valid "name"`);
                }
                return {
                    name: input.name,
                    value:
                        typeof input.value === "string"
                            ? input.value
                            : JSON.stringify(input.value, null, 2),
                    mimeType: input.mimeType || "application/json"
                };
            }),
            version: this.version
        };

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);

        let response;
        try {
            response = await fetch(this.url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
                signal: controller.signal
            });
            console.log("[dw] compiler response received", {
                status: response.status,
                ok: response.ok
            });
        } catch (err) {
            if (err.name === "AbortError") {
                throw new Error(
                    `DataWeave compiler did not respond within ${this.timeoutMs}ms (is the Docker container on ${this.url} running?)`
                );
            }
            console.error("[dw] compiler request failed", err);
            throw new Error(`Could not reach DataWeave compiler at ${this.url}: ${err.message}`);
        } finally {
            clearTimeout(timer);
        }

        if (!response.ok) {
            // Try to pull a useful message out of a non-2xx response body
            let detail = "";
            try {
                const text = await response.text();
                detail = text ? ` - ${text}` : "";
            } catch {
                /* ignore */
            }
            throw new Error(`Compiler responded with HTTP ${response.status}${detail}`);
        }

        const result = await response.json();

        console.log("[dw] compiler payload", {
            hasError: Boolean(result.error),
            outputType: typeof result.output,
            outputPreview: typeof result.output === "string" ? result.output.slice(0, 200) : JSON.stringify(result.output).slice(0, 200)
        });

        if (result.error) {
            throw new Error(result.error);
        }

        try {
            return JSON.parse(result.output);
        } catch {
            return result.output;
        }
    }
}

module.exports = { DataWeaveRunner };