import {
  loadApnsRegistration,
  normalizeApnsEnvironment,
  registerApnsToken,
  resolveApnsAuthConfigFromEnv,
  sendApnsAlert,
} from "../../infra/push-apns.js";
import { ErrorCodes, errorShape, validatePushTestParams } from "../protocol/index.js";
import { respondInvalidParams, respondUnavailableOnThrow } from "./nodes.helpers.js";
import type { GatewayRequestHandlers } from "./types.js";

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export const pushHandlers: GatewayRequestHandlers = {
  "push.test": async ({ params, respond }) => {
    if (!validatePushTestParams(params)) {
      respondInvalidParams({
        respond,
        method: "push.test",
        validator: validatePushTestParams,
      });
      return;
    }

    const nodeId = String(params.nodeId ?? "").trim();
    if (!nodeId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "nodeId required"));
      return;
    }

    const title = normalizeOptionalString(params.title) ?? "OpenClaw";
    const body = normalizeOptionalString(params.body) ?? `Push test for node ${nodeId}`;

    await respondUnavailableOnThrow(respond, async () => {
      const registration = await loadApnsRegistration(nodeId);
      if (!registration) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `node ${nodeId} has no APNs registration (connect iOS node first)`,
          ),
        );
        return;
      }

      const auth = await resolveApnsAuthConfigFromEnv(process.env);
      if (!auth.ok) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, auth.error));
        return;
      }

      const overrideEnvironment = normalizeApnsEnvironment(params.environment);
      const result = await sendApnsAlert({
        auth: auth.value,
        registration: {
          ...registration,
          environment: overrideEnvironment ?? registration.environment,
        },
        nodeId,
        title,
        body,
      });
      respond(true, result, undefined);
    });
  },

  "push.register": async ({ params, client, respond }) => {
    const token = typeof params.token === "string" ? params.token.trim() : "";
    const topic = typeof params.topic === "string" ? params.topic.trim() : "";
    const environment = params.environment;

    if (!token) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "token required"));
      return;
    }
    if (!topic) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "topic required"));
      return;
    }

    const nodeId =
      (client?.connect?.device?.id as string | undefined) ??
      (client?.connect?.client?.id as string | undefined) ??
      "";
    if (!nodeId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "device identity required"));
      return;
    }

    try {
      await registerApnsToken({ nodeId, token, topic, environment });
      respond(true, { nodeId, registered: true }, undefined);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, message));
    }
  },
};
