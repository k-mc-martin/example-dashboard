export const scheduleNode = {
  parameters: { rule: { interval: [{ field: "minutes", minutesInterval: 15 }] } },
  id: "schedule", name: "Every 15 minutes", type: "n8n-nodes-base.scheduleTrigger", typeVersion: 1.2, position: [-900, 0],
};

export const manualNode = {
  parameters: {}, id: "manual", name: "Run manually", type: "n8n-nodes-base.manualTrigger", typeVersion: 1, position: [-900, 160],
};

export function unwrapResponse(value) {
  if (value && typeof value === "object" && "statusCode" in value) {
    const statusCode = Number(value.statusCode);
    if (!Number.isInteger(statusCode) || statusCode < 200 || statusCode >= 300) return { ok: false, statusCode, raw: value };
    return { ok: true, statusCode, body: value.body };
  }
  if (value?.error) {
    const error = value.error;
    const candidates = [error?.statusCode, error?.httpCode, error?.cause?.statusCode, error?.response?.statusCode, error?.response?.status];
    let statusCode = candidates.map(Number).find(Number.isInteger);
    if (!statusCode) {
      const match = String(error?.message ?? "").match(/(?:status(?: code)?|response code)\D{0,8}(\d{3})/i);
      if (match) statusCode = Number(match[1]);
    }
    return { ok: false, statusCode, raw: value };
  }
  return { ok: true, statusCode: 200, body: value };
}

export function safeUpstreamError(responses) {
  const failed = responses.map(unwrapResponse).find(result => !result.ok);
  if (!failed) return null;
  if (failed.statusCode === 401 || failed.statusCode === 403) return "authorization_required";
  if (failed.statusCode === 429) return "rate_limited";
  if (!Number.isInteger(failed.statusCode) || failed.statusCode >= 500) return "provider_unavailable";
  return "invalid_response";
}

export function httpNode({ id, name, url, credentialId, credentialName, position, query = [], pagination }) {
  const options = { response: { response: { fullResponse: true, neverError: true, responseFormat: "json" } } };
  if (pagination) options.pagination = pagination;
  return {
    parameters: {
      url, authentication: "genericCredentialType", genericAuthType: "httpHeaderAuth",
      sendQuery: query.length > 0, ...(query.length ? { queryParameters: { parameters: query } } : {}),
      sendHeaders: true, headerParameters: { parameters: [{ name: "Accept", value: credentialId === "SecDashLemonSqueezy" ? "application/vnd.api+json" : "application/json" }] }, options: { ...options, timeout: 30000 },
    }, id, name, type: "n8n-nodes-base.httpRequest", typeVersion: 4.2, position,
    onError: "continueRegularOutput",
    credentials: { httpHeaderAuth: { id: credentialId, name: credentialName } },
  };
}

export function codeNode(id, name, jsCode, position) {
  return { parameters: { jsCode }, id, name, type: "n8n-nodes-base.code", typeVersion: 2, position };
}

export function deliveryNode(position) {
  return {
    parameters: {
      method: "POST", url: "http://dashboard:3000/api/n8n/operations", authentication: "genericCredentialType", genericAuthType: "httpHeaderAuth",
      sendBody: true, contentType: "json", specifyBody: "json", jsonBody: "={{ $json }}",
      options: { response: { response: { responseFormat: "json" } }, timeout: 15000 },
    }, id: "deliver", name: "Deliver operation observation", type: "n8n-nodes-base.httpRequest", typeVersion: 4.2, position,
    credentials: { httpHeaderAuth: { id: "SecDashDashboardIngest", name: "SecDash dashboard intake" } }, retryOnFail: true, maxTries: 3, waitBetweenTries: 1000,
  };
}

export function workflow(id, name, nodes, connections) {
  return {
    id, name, active: false, nodes, connections,
    settings: { executionOrder: "v1", saveDataSuccessExecution: "none", saveDataErrorExecution: "none", saveManualExecutions: false, executionTimeout: 300 },
    pinData: {}, tags: [],
  };
}

export function connectBoth(first) {
  return {
    "Every 15 minutes": { main: [[{ node: first, type: "main", index: 0 }]] },
    "Run manually": { main: [[{ node: first, type: "main", index: 0 }]] },
  };
}
