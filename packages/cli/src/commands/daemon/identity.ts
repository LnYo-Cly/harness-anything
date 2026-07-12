import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { makeRuntimeEventAppendPromise, makeRuntimeEventLedgerService } from "../../../../application/src/index.ts";
import {
  loadPeopleRoster,
  makeTransportDerivedIdentityProvider,
  peopleRosterFromDocument
} from "../../../../daemon/src/index.ts";
import { createHarnessRuntimeContext, resolveHarnessLayout } from "../../../../kernel/src/index.ts";
import { readProjectHarnessSettings } from "../settings.ts";

export function loadDaemonIdentityWithEmail(
  rootDir: string,
  layoutOverrides: { readonly authoredRoot?: string } | undefined,
  primaryEmail: string | undefined,
  endpoint?: string
): {
  readonly peopleRoster?: ReturnType<typeof loadPeopleRoster>;
  readonly identityProvider?: ReturnType<typeof makeTransportDerivedIdentityProvider>;
  readonly appendRuntimeEvent?: ReturnType<typeof makeRuntimeEventAppendPromise>;
} {
  const runtimeContext = createHarnessRuntimeContext(rootDir, layoutOverrides);
  const layout = resolveHarnessLayout(runtimeContext);
  const peoplePath = path.join(layout.authoredRoot, "people.yaml");
  const peopleRoster = existsSync(peoplePath)
    ? loadPeopleRoster(runtimeContext)
    : configuredLocalPeopleRoster(runtimeContext, primaryEmail, endpoint);
  if (!peopleRoster) return {};
  return {
    peopleRoster,
    identityProvider: makeTransportDerivedIdentityProvider(peopleRoster, {
      localUnixIssuer: `host:${os.hostname()}`,
      sshExecIssuer: `host:${os.hostname()}`,
      namedPipeIssuer: `host:${os.hostname()}:named-pipe`
    }),
    appendRuntimeEvent: makeRuntimeEventAppendPromise(makeRuntimeEventLedgerService({ rootInput: runtimeContext }))
  };
}

function configuredLocalPeopleRoster(
  rootInput: ReturnType<typeof createHarnessRuntimeContext>,
  primaryEmail: string | undefined,
  endpoint: string | undefined
): ReturnType<typeof loadPeopleRoster> | undefined {
  const settings = readProjectHarnessSettings(rootInput, "daemon-identity");
  if (!settings.ok || !settings.settings.identity) return undefined;
  const identity = settings.settings.identity;
  if (!primaryEmail) return undefined;
  const credentials = [
    {
      kind: "unix-socket-owner-boundary",
      issuer: `host:${os.hostname()}`,
      subject: String(process.getuid?.() ?? 0)
    },
    ...(endpoint ? [{
      kind: "windows-named-pipe-client",
      issuer: `host:${os.hostname()}:named-pipe`,
      subject: endpoint
    }] : [])
  ];
  return peopleRosterFromDocument(JSON.stringify({
    schema: "harness-people/v1",
    people: [{
      personId: identity.personId,
      displayName: identity.displayName ?? identity.personId,
      primaryEmail,
      roles: ["owner"],
      credentials
    }],
    roles: [{ roleId: "owner", commandClasses: ["admin", "repo-write", "repo-read", "arbiter"] }]
  }));
}
