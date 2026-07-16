// harness-test-tier: integration
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createAcceptedConnectionEvidence,
  createUnixSocketTransportServer,
  encodeJsonLineFrame,
  encodeLengthPrefixedFrame,
  sshAuthorityWireBootstrapFrame,
  sshForcedCommandBootstrapFrame,
  type AcceptedConnectionBinding,
  type AcceptedConnectionEvidenceAdapter,
  type DaemonAuthenticationContext
} from "../src/index.ts";

test("authority-wire ingress preserves bytes coalesced with the authenticated bootstrap", async (t) => {
  if (process.platform === "win32") return;
  const socketPath = tempSocketPath();
  const received = deferred<Buffer>();
  const entered = deferred<void>();
  let binding: AcceptedConnectionBinding | undefined;
  let sessionCloses = 0;
  const transport = createUnixSocketTransportServer({
    daemonId: "authority-wire-coalesced",
    socketPath,
    acceptedConnectionEvidenceAdapter: observedPeerAdapter(),
    acceptSshForcedCommand: (frame) => frame.canonicalRoot === "/srv/canonical",
    createProtocolServer: () => { throw new Error("authority-wire ingress must not enter JSON-RPC"); },
    authorityWireIngress: ({
      bootstrap,
      authContext,
      input,
      acceptedConnection,
      acceptedConnectionEvidence
    }) => {
      assert.equal(bootstrap.streamProtocol, "harness-authority-wire/v1");
      assert.equal(authContext.sshForcedCommand.personId, "person_alice");
      assert.equal(acceptedConnection.evidence, acceptedConnectionEvidence);
      assert.equal(acceptedConnectionEvidence.peerCredential.available, true);
      acceptedConnection.assertActive();
      binding = acceptedConnection;
      entered.resolve();
      readExactBytes(input, authorityFrame.length).then(received.resolve, received.reject);
      return {
        close: async () => { sessionCloses += 1; }
      };
    }
  });
  await transport.start();
  t.after(async () => transport.stop());

  const client = await connect(socketPath);
  const authorityFrame = encodeLengthPrefixedFrame({
    type: "harness-authority-wire/v1",
    kind: "hello",
    requestId: "coalesced",
    connectionGeneration: 1,
    workspaceId: "workspace",
    channelNonceDigest: "client-field-is-not-authority",
    protocol: { wire: 1, event: 1, receipt: 1, digest: 1, commandRegistry: 1 }
  });
  client.write(Buffer.concat([
    Buffer.from(encodeJsonLineFrame(sshAuthorityWireBootstrapFrame({
      personId: "person_alice",
      canonicalRoot: "/srv/canonical"
    }))),
    authorityFrame
  ]));

  await entered.promise;
  assert.deepEqual(await received.promise, authorityFrame);
  client.destroy();
  await once(client, "close");
  await waitUntil(() => binding?.isActive() === false);
  assert.throws(() => binding?.assertActive(), /connection generation is closed/u);
  assert.equal(sessionCloses, 1);
});

test("authority-wire routing preserves the existing forced-command JSON-RPC path", async (t) => {
  if (process.platform === "win32") return;
  const socketPath = tempSocketPath();
  let authorityCalls = 0;
  let seenContext: DaemonAuthenticationContext | undefined;
  const transport = createUnixSocketTransportServer({
    daemonId: "authority-wire-json-rpc",
    socketPath,
    acceptedConnectionEvidenceAdapter: observedPeerAdapter(),
    acceptSshForcedCommand: (frame) => frame.canonicalRoot === "/srv/canonical",
    authorityWireIngress: () => { authorityCalls += 1; },
    createProtocolServer: (authContext, acceptedConnection) => {
      seenContext = authContext;
      acceptedConnection?.assertActive();
      return {
        handle: async (request) => {
          const single = Array.isArray(request) ? request[0]! : request;
          return { jsonrpc: "2.0", id: single.id ?? null, result: { ok: true } };
        }
      };
    }
  });
  await transport.start();
  t.after(async () => transport.stop());

  const client = await connect(socketPath);
  client.write(Buffer.concat([
    Buffer.from(encodeJsonLineFrame(sshForcedCommandBootstrapFrame({
      personId: "person_alice",
      canonicalRoot: "/srv/canonical"
    }))),
    Buffer.from(encodeJsonLineFrame({ jsonrpc: "2.0", id: 7, method: "protocol.hello", params: {} }))
  ]));

  assert.deepEqual(await readJsonLine(client), { jsonrpc: "2.0", id: 7, result: { ok: true } });
  assert.equal(seenContext?.sshForcedCommand?.personId, "person_alice");
  assert.equal(authorityCalls, 0);
  client.destroy();
  await once(client, "close");
});

test("authority-wire ingress fails closed when peer evidence is unavailable", async (t) => {
  if (process.platform === "win32") return;
  const socketPath = tempSocketPath();
  let authorityCalls = 0;
  const transport = createUnixSocketTransportServer({
    daemonId: "authority-wire-no-peer",
    socketPath,
    acceptedConnectionEvidenceAdapter: unavailablePeerAdapter(),
    acceptSshForcedCommand: true,
    authorityWireIngress: () => { authorityCalls += 1; },
    createProtocolServer: () => { throw new Error("authority-wire ingress must not enter JSON-RPC"); }
  });
  await transport.start();
  t.after(async () => transport.stop());

  const client = await connect(socketPath);
  const closed = once(client, "close");
  client.write(encodeJsonLineFrame(sshAuthorityWireBootstrapFrame({
    personId: "person_alice",
    canonicalRoot: "/srv/canonical"
  })));
  await closed;
  assert.equal(authorityCalls, 0);
});

test("authority-wire ingress fails closed without a registered handler", async (t) => {
  if (process.platform === "win32") return;
  const socketPath = tempSocketPath();
  const transport = createUnixSocketTransportServer({
    daemonId: "authority-wire-no-handler",
    socketPath,
    acceptedConnectionEvidenceAdapter: observedPeerAdapter(),
    acceptSshForcedCommand: true,
    createProtocolServer: () => { throw new Error("authority-wire ingress must not enter JSON-RPC"); }
  });
  await transport.start();
  t.after(async () => transport.stop());

  const client = await connect(socketPath);
  const closed = once(client, "close");
  client.write(encodeJsonLineFrame(sshAuthorityWireBootstrapFrame({
    personId: "person_alice",
    canonicalRoot: "/srv/canonical"
  })));
  await closed;
});

test("authority-wire ingress fails closed when evidence does not match the accepted socket", async (t) => {
  if (process.platform === "win32") return;
  const socketPath = tempSocketPath();
  let authorityCalls = 0;
  const transport = createUnixSocketTransportServer({
    daemonId: "authority-wire-evidence-mismatch",
    socketPath,
    acceptedConnectionEvidenceAdapter: mismatchedEvidenceAdapter(),
    acceptSshForcedCommand: true,
    authorityWireIngress: () => { authorityCalls += 1; },
    createProtocolServer: () => { throw new Error("mismatched evidence must not reach JSON-RPC"); }
  });
  await transport.start();
  t.after(async () => transport.stop());

  const client = await connect(socketPath);
  await once(client, "close");
  assert.equal(authorityCalls, 0);
});

function tempSocketPath(): string {
  return path.join(mkdtempSync(path.join(os.tmpdir(), "ha-authority-wire-")), "daemon.sock");
}

function observedPeerAdapter(): AcceptedConnectionEvidenceAdapter<net.Socket> {
  return {
    observeAcceptedConnection: async (input) => createAcceptedConnectionEvidence({
      connectionId: input.connectionId,
      connectionGeneration: input.connectionGeneration,
      daemonInstanceId: input.daemonInstanceId,
      transportKind: "unix-socket",
      peerCredential: {
        available: true,
        value: {
          schema: "os-observed-peer-credential/v1",
          platform: "linux",
          source: "SO_PEERCRED",
          uid: process.getuid?.() ?? 0,
          gid: process.getgid?.() ?? 0,
          pid: process.pid
        }
      },
      ...(input.compatibilityBoundary ? { compatibilityBoundary: input.compatibilityBoundary } : {}),
      serverRandom: Buffer.alloc(32, 9)
    })
  };
}

function unavailablePeerAdapter(): AcceptedConnectionEvidenceAdapter<net.Socket> {
  return {
    observeAcceptedConnection: async (input) => createAcceptedConnectionEvidence({
      connectionId: input.connectionId,
      connectionGeneration: input.connectionGeneration,
      daemonInstanceId: input.daemonInstanceId,
      transportKind: "unix-socket",
      peerCredential: {
        available: false,
        code: "observation_failed",
        source: "os-peer-credential-adapter"
      },
      ...(input.compatibilityBoundary ? { compatibilityBoundary: input.compatibilityBoundary } : {}),
      serverRandom: Buffer.alloc(32, 7)
    })
  };
}

function mismatchedEvidenceAdapter(): AcceptedConnectionEvidenceAdapter<net.Socket> {
  return {
    observeAcceptedConnection: async (input) => createAcceptedConnectionEvidence({
      connectionId: `${input.connectionId}-different`,
      connectionGeneration: input.connectionGeneration,
      daemonInstanceId: input.daemonInstanceId,
      transportKind: "unix-socket",
      peerCredential: {
        available: true,
        value: {
          schema: "os-observed-peer-credential/v1",
          platform: "linux",
          source: "SO_PEERCRED",
          uid: process.getuid?.() ?? 0,
          pid: process.pid
        }
      },
      serverRandom: Buffer.alloc(32, 5)
    })
  };
}

function connect(socketPath: string): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    socket.once("error", reject);
    socket.once("connect", () => {
      socket.off("error", reject);
      resolve(socket);
    });
  });
}

function readExactBytes(input: NodeJS.ReadableStream, length: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let buffered = Buffer.alloc(0);
    input.on("data", onData);
    input.once("error", reject);
    input.once("end", onEnd);

    function onData(chunk: Buffer): void {
      buffered = Buffer.concat([buffered, chunk]);
      if (buffered.length < length) return;
      cleanup();
      resolve(buffered.subarray(0, length));
    }

    function onEnd(): void {
      cleanup();
      reject(new Error(`stream ended after ${buffered.length} of ${length} bytes`));
    }

    function cleanup(): void {
      input.off("data", onData);
      input.off("error", reject);
      input.off("end", onEnd);
    }
  });
}

function readJsonLine(input: NodeJS.ReadableStream): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let buffered = "";
    input.on("data", onData);
    input.once("error", reject);

    function onData(chunk: Buffer): void {
      buffered += chunk.toString("utf8");
      const newline = buffered.indexOf("\n");
      if (newline < 0) return;
      input.off("data", onData);
      input.off("error", reject);
      resolve(JSON.parse(buffered.slice(0, newline)) as unknown);
    }
  });
}

function deferred<Value>(): {
  readonly promise: Promise<Value>;
  readonly resolve: (value: Value) => void;
  readonly reject: (error: unknown) => void;
} {
  let resolve!: (value: Value) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function waitUntil(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("condition did not settle before timeout");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
