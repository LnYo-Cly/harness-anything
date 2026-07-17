// harness-test-tier: contract
import assert from "node:assert/strict";
import test from "node:test";
import { createInMemoryTerminalSessionService } from "../../gui/src/terminal/session-registry.ts";
import { jsonRpcMethodContracts, type JsonRpcRequest } from "../src/index.ts";
import { emptyLocalController, makeServer, resultReceipt } from "./json-rpc-protocol-fixtures.ts";

test("agent runtime inventory route is contract-derived and returns the safe application projection", async () => {
  const controller = {
    ...emptyLocalController(),
    getAgentRuntimes: async () => ({
      ok: true as const,
      schema: "agent-runtime-inventory-projection/v1" as const,
      generatedAt: "2026-07-17T12:00:00.000Z",
      rebuildable: true as const,
      kinds: [],
      installations: [],
      sessions: []
    })
  };
  const server = makeServer({
    services: {
      LocalControllerService: controller,
      TerminalSessionService: createInMemoryTerminalSessionService()
    }
  });
  await server.handle({
    jsonrpc: "2.0",
    id: "hello",
    method: "protocol.hello",
    params: { protocolVersion: 1 }
  });
  const request = {
    jsonrpc: "2.0",
    id: "runtime-inventory",
    method: "repo.agent-runtimes.inventory",
    params: { repo: { repoId: "canonical" }, payload: {} }
  } satisfies JsonRpcRequest;

  const receipt = resultReceipt(await server.handle(request));

  assert.equal(jsonRpcMethodContracts.some(({ method }) => method === request.method), true);
  assert.equal(receipt.ok, true);
  assert.equal(receipt.details.data.schema, "agent-runtime-inventory-projection/v1");
  assert.equal(receipt.details.data.rebuildable, true);
});
