import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { evaluateApiContractRegistry } from "./check-api-contract-registry.mjs";

test("API contract registry accepts the repository route registry", () => {
  assert.deepEqual(evaluateApiContractRegistry(), []);
});

test("API contract registry rejects preload methods missing from registry", async () => {
  await withFixtureRepo(async (root) => {
    writeFixture(root, {
      preloadMethods: ["getTasks", "getTaskDetail"],
      dispatchMethods: ["getTasks", "getTaskDetail"],
      serviceMethods: ["getTasks", "getTaskDetail"],
      registryEntries: [route({ guiBridgeMethod: "getTasks", serviceMethod: "getTasks" })]
    });

    const violations = evaluateApiContractRegistry(root);

    assert.equal(violations.some((violation) => violation.includes("getTaskDetail") && violation.includes("preload allowlist")), true);
  });
});

test("API contract registry rejects routes pointing at missing service methods", async () => {
  await withFixtureRepo(async (root) => {
    writeFixture(root, {
      preloadMethods: ["getTasks"],
      dispatchMethods: ["getTasks"],
      serviceMethods: ["getTasks"],
      registryEntries: [route({ serviceMethod: "missingMethod" })]
    });

    const violations = evaluateApiContractRegistry(root);

    assert.equal(violations.some((violation) => violation.includes("missing LocalControllerService.missingMethod")), true);
  });
});

test("API contract registry rejects duplicate method and path pairs", async () => {
  await withFixtureRepo(async (root) => {
    writeFixture(root, {
      preloadMethods: ["getTasks", "getTaskDetail"],
      dispatchMethods: ["getTasks", "getTaskDetail"],
      serviceMethods: ["getTasks", "getTaskDetail"],
      registryEntries: [
        route({ id: "tasks.list", guiBridgeMethod: "getTasks", serviceMethod: "getTasks" }),
        route({ id: "tasks.detail", guiBridgeMethod: "getTaskDetail", serviceMethod: "getTaskDetail" })
      ]
    });

    const violations = evaluateApiContractRegistry(root);

    assert.equal(violations.some((violation) => violation.includes("duplicate route method/path GET /api/tasks")), true);
  });
});

test("API contract registry rejects malformed schema ids and undispatched bridge methods", async () => {
  await withFixtureRepo(async (root) => {
    writeFixture(root, {
      preloadMethods: ["getTasks"],
      dispatchMethods: [],
      serviceMethods: ["getTasks"],
      registryEntries: [route({ inputSchemaId: "TaskListResult", guiBridgeMethod: "getTasks" })]
    });

    const violations = evaluateApiContractRegistry(root);

    assert.equal(violations.some((violation) => violation.includes("malformed inputSchemaId")), true);
    assert.equal(violations.some((violation) => violation.includes("GUI service dispatch")), true);
  });
});

test("API contract registry rejects valid-looking but unregistered schema ids", async () => {
  await withFixtureRepo(async (root) => {
    writeFixture(root, {
      preloadMethods: ["getTasks"],
      dispatchMethods: ["getTasks"],
      serviceMethods: ["getTasks"],
      registryEntries: [route({ inputSchemaId: "application.not-real/v1" })]
    });

    const violations = evaluateApiContractRegistry(root);

    assert.equal(violations.some((violation) => violation.includes("application.not-real/v1") && violation.includes("not registered")), true);
  });
});

test("API contract registry rejects dispatch branches calling the wrong service method", async () => {
  await withFixtureRepo(async (root) => {
    writeFixture(root, {
      preloadMethods: ["getTasks"],
      dispatchBranches: [{ method: "getTasks", serviceMethod: "getTaskDetail" }],
      serviceMethods: ["getTasks", "getTaskDetail"],
      registryEntries: [route({ guiBridgeMethod: "getTasks", serviceMethod: "getTasks" })]
    });

    const violations = evaluateApiContractRegistry(root);

    assert.equal(violations.some((violation) => violation.includes("getTasks dispatch does not call LocalControllerService.getTasks")), true);
    assert.equal(violations.some((violation) => violation.includes("getTasks dispatch calls unexpected LocalControllerService.getTaskDetail")), true);
  });
});

test("API contract registry rejects duplicate dispatch branches", async () => {
  await withFixtureRepo(async (root) => {
    writeFixture(root, {
      preloadMethods: ["getTasks"],
      dispatchBranches: [
        { method: "getTasks", serviceMethod: "getTaskDetail" },
        { method: "getTasks", serviceMethod: "getTasks" }
      ],
      serviceMethods: ["getTasks", "getTaskDetail"],
      registryEntries: [route({ guiBridgeMethod: "getTasks", serviceMethod: "getTasks" })]
    });

    const violations = evaluateApiContractRegistry(root);

    assert.equal(violations.some((violation) => violation.includes("duplicate dispatch branch for getTasks")), true);
    assert.equal(violations.some((violation) => violation.includes("getTasks dispatch does not call LocalControllerService.getTasks")), true);
  });
});

test("API contract registry covers deferred GUI bridge methods without active routes", async () => {
  await withFixtureRepo(async (root) => {
    writeFixture(root, {
      preloadMethods: ["getTasks", "archiveTask"],
      dispatchMethods: ["getTasks", "archiveTask"],
      serviceMethods: ["getTasks", "archiveTask"],
      registryEntries: [route({ guiBridgeMethod: "getTasks", serviceMethod: "getTasks" })],
      deferredEntries: [{
        guiBridgeMethod: "archiveTask",
        service: "LocalControllerService",
        serviceMethod: "archiveTask",
        reason: "Archive is disabled until route ownership lands."
      }]
    });

    assert.deepEqual(evaluateApiContractRegistry(root), []);
  });
});

async function withFixtureRepo(fn) {
  const root = await mkdtemp(path.join(tmpdir(), "ha-api-registry-"));
  try {
    mkdirSync(path.join(root, "packages/gui/src/api"), { recursive: true });
    mkdirSync(path.join(root, "packages/gui/src/preload"), { recursive: true });
    mkdirSync(path.join(root, "packages/application/src"), { recursive: true });
    await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function writeFixture(root, options) {
  const schemaContracts = options.schemaContracts ?? [
    { id: "gui.empty/v1", owner: "gui", typeName: "EmptyGuiPayload" },
    { id: "application.local-controller-error/v1", owner: "application", typeName: "LocalControllerError" },
    { id: "application.task-list-result/v1", owner: "application", typeName: "TaskListResult" }
  ];
  const deferredEntries = options.deferredEntries ?? [];
  const dispatchBranches = options.dispatchBranches
    ?? options.dispatchMethods.map((method) => ({ method, serviceMethod: method }));
  writeFileSync(path.join(root, "packages/gui/src/api/api-contract-registry.ts"), [
    "export interface EmptyGuiPayload {}",
    "export const apiSchemaContracts = [",
    ...schemaContracts.map((entry) => `  ${JSON.stringify(entry)},`),
    "] as const;",
    "export const apiRouteContracts = [",
    ...options.registryEntries.map((entry) => `  ${JSON.stringify(entry)},`),
    "] as const;",
    "export const deferredGuiBridgeContracts = [",
    ...deferredEntries.map((entry) => `  ${JSON.stringify(entry)},`),
    "] as const;",
    ""
  ].join("\n"), "utf8");
  writeFileSync(path.join(root, "packages/gui/src/preload/allowlist.ts"), [
    "export const allowedPreloadApi = {",
    ...options.preloadMethods.map((method) => `  ${method}: ${JSON.stringify(method)},`),
    "} as const;",
    ""
  ].join("\n"), "utf8");
  writeFileSync(path.join(root, "packages/gui/src/api/service-bridge.ts"), [
    "export function dispatchGuiServiceMethod(method: string): unknown {",
    ...dispatchBranches.map((branch) => `  if (method === ${JSON.stringify(branch.method)}) return service.${branch.serviceMethod}();`),
    "  return {};",
    "}",
    ""
  ].join("\n"), "utf8");
  writeFileSync(path.join(root, "packages/application/src/index.ts"), [
    ...schemaContracts
      .filter((entry) => entry.owner === "application")
      .map((entry) => `export interface ${entry.typeName} {}`),
    "export interface LocalControllerService {",
    ...options.serviceMethods.map((method) => `  readonly ${method}: () => unknown;`),
    "}",
    ""
  ].join("\n"), "utf8");
}

function route(overrides = {}) {
  return {
    id: "tasks.list",
    method: "GET",
    path: "/api/tasks",
    inputSchemaId: "gui.empty/v1",
    outputSchemaId: "application.task-list-result/v1",
    errorSchemaId: "application.local-controller-error/v1",
    service: "LocalControllerService",
    serviceMethod: "getTasks",
    auth: "local-session-token",
    guiBridgeMethod: "getTasks",
    ...overrides
  };
}
