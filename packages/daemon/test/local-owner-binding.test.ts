// harness-test-tier: fast
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { localDefaultBinding } from "../src/daemon-host-binding.ts";
import { evaluateFleetAction } from "../src/host-action-authorization.ts";
import { localOwnerPersonId } from "../src/local-owner-binding.ts";
import { evaluateRepoCellAction } from "../src/repo-cell-authorization.ts";

const ownerUid = process.getuid?.() ?? 0,
  socketOwner = {
    transportKind: "unix-socket" as const,
    unixSocketOwnerBoundary: { ownerUid, source: "unix-socket-filesystem-owner-boundary" as const },
  };

test("without a Keycloak session the socket owner acts as the person people.yaml binds to this host", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "local-owner-"));
  mkdirSync(path.join(root, "harness"));
  writeFileSync(
    path.join(root, "harness", "people.yaml"),
    [
      "people:",
      "  - personId: someone_else",
      "    credentials: [{ kind: unix-socket-owner-boundary, issuer: host:elsewhere, subject: 0 }]",
      "  - personId: person_owner",
      `    credentials: [{ kind: unix-socket-owner-boundary, issuer: "host:${os.hostname()}", subject: ${ownerUid} }]`,
    ].join("\n"),
  );
  assert.equal(localOwnerPersonId(root, ownerUid), "person_owner");
  assert.equal(localOwnerPersonId(undefined, ownerUid), `local-user-${ownerUid}`);
  const binding = localDefaultBinding(socketOwner, null, false, root);
  assert.equal(binding.actor.principal.personId, "person_owner");
  assert.equal(binding.daemonSocketOwner, true);
});

test("the socket owner is allowed repository and host actions; a non-owner still needs Keycloak", async () => {
  const owner = localDefaultBinding(socketOwner),
    // The host attaches a center authority to every binding; that alone is not a user session.
    withCenter = { ...owner, keycloakAuthorization: { center: async () => ({}) as never } },
    repoDecision = (binding: typeof owner) =>
      evaluateRepoCellAction({
        action: { kind: "task-create" },
        binding,
        actionId: "local-owner",
        repoId: "repo",
        revision: 1,
        now: "2026-10-20T00:00:00.000Z",
      });
  assert.deepEqual((await repoDecision(withCenter)).reasonCodes, ["daemon_socket_owner"]);
  const host = await evaluateFleetAction({
    kind: "repository-read",
    binding: withCenter,
    actionId: "local-owner-read",
    evaluatedAtCut: "repository:repo:current",
  });
  assert.equal(host.outcome, "allowed");
  const stranger = { actor: owner.actor, source: "local" as const };
  assert.equal((await repoDecision(stranger)).outcome, "denied");
  assert.throws(() => localDefaultBinding({ transportKind: "fleet-tls" }), /Sign in with Keycloak/u);
});
