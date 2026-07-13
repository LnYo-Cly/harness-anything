import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { makeRuntimeEventAppendPromise, makeRuntimeEventLedgerService } from "../../../../application/src/index.ts";
import {
  composeIdentityProvider,
  credentialKey,
  hasPersonRegistry,
  loadPersonRegistry,
  loadPeopleRoster,
  makePeopleRosterIdentityAdminSnapshot,
  makePersonAuthorizationProvider,
  makeTransportDerivedAuthenticationProvider,
  makeTransportDerivedIdentityProvider,
  personRegistryFromLegacyRoster,
  personRegistryFromRecords,
  validatePeopleRosterReferences,
  type CredentialRef,
  type IdentityAdminSnapshot,
  type IdentityProvider,
  type PersonRegistry,
  type RolePolicy
} from "../../../../daemon/src/index.ts";
import { createHarnessRuntimeContext, resolveHarnessLayout } from "../../../../kernel/src/index.ts";
import { readProjectHarnessSettings } from "../settings.ts";

export function loadDaemonIdentityWithEmail(
  rootDir: string,
  layoutOverrides: { readonly authoredRoot?: string } | undefined,
  primaryEmail: string | undefined,
  endpoint?: string
): {
  readonly personRegistry?: PersonRegistry;
  readonly identityProvider?: IdentityProvider;
  readonly identityAdminSnapshot?: IdentityAdminSnapshot;
  readonly appendRuntimeEvent?: ReturnType<typeof makeRuntimeEventAppendPromise>;
} {
  const runtimeContext = createHarnessRuntimeContext(rootDir, layoutOverrides);
  const layout = resolveHarnessLayout(runtimeContext);
  const peoplePath = path.join(layout.authoredRoot, "people.yaml");
  const transportOptions = {
    localUnixIssuer: `host:${os.hostname()}`,
    sshExecIssuer: `host:${os.hostname()}`,
    namedPipeIssuer: `host:${os.hostname()}:named-pipe`
  };
  if (!existsSync(peoplePath)) {
    const configured = configuredLocalIdentity(runtimeContext, primaryEmail, endpoint, transportOptions);
    if (!configured) return {};
    return {
      ...configured,
      appendRuntimeEvent: makeRuntimeEventAppendPromise(makeRuntimeEventLedgerService({ rootInput: runtimeContext }))
    };
  }
  const peopleRoster = loadPeopleRoster(runtimeContext);
  const personRegistry = hasPersonRegistry(runtimeContext)
    ? loadPersonRegistry(runtimeContext)
    : personRegistryFromLegacyRoster(peopleRoster);
  validatePeopleRosterReferences(personRegistry, peopleRoster);
  return {
    personRegistry,
    identityProvider: makeTransportDerivedIdentityProvider(peopleRoster, transportOptions),
    identityAdminSnapshot: makePeopleRosterIdentityAdminSnapshot(peopleRoster, personRegistry),
    appendRuntimeEvent: makeRuntimeEventAppendPromise(makeRuntimeEventLedgerService({ rootInput: runtimeContext }))
  };
}

function configuredLocalIdentity(
  rootInput: ReturnType<typeof createHarnessRuntimeContext>,
  primaryEmail: string | undefined,
  endpoint: string | undefined,
  transportOptions: Parameters<typeof makeTransportDerivedAuthenticationProvider>[1]
): {
  readonly personRegistry: PersonRegistry;
  readonly identityProvider: IdentityProvider;
  readonly identityAdminSnapshot: IdentityAdminSnapshot;
} | undefined {
  const settings = readProjectHarnessSettings(rootInput, "daemon-identity");
  if (!settings.ok || !settings.settings.identity) return undefined;
  const identity = settings.settings.identity;
  if (!primaryEmail) return undefined;
  const credentials: CredentialRef[] = [
    {
      kind: "unix-socket-owner-boundary",
      issuer: `host:${os.hostname()}`,
      subject: String(process.getuid?.() ?? 0)
    },
    ...(endpoint ? [{
      kind: "windows-named-pipe-client" as const,
      issuer: `host:${os.hostname()}:named-pipe`,
      subject: endpoint
    }] : [])
  ];
  const personRegistry = hasPersonRegistry(rootInput)
    ? loadPersonRegistry(rootInput)
    : personRegistryFromRecords([{
      personId: identity.personId,
      displayName: identity.displayName ?? identity.personId
    }]);
  const person = personRegistry.find(identity.personId);
  if (!person) throw new Error(`Configured identity is not registered: ${identity.personId}`);
  if (person.disabled) throw new Error(`Configured identity is disabled: ${identity.personId}`);
  const credentialKeys = new Set(credentials.map(credentialKey));
  const authentication = makeTransportDerivedAuthenticationProvider((credential, providerId) => {
    if (!credentialKeys.has(credentialKey(credential))) {
      return {
        ok: false,
        code: "credential_unknown",
        providerId,
        message: "Credential is not bound to the configured local person.",
        credential
      };
    }
    return { ok: true, personId: person.personId, providerId, credential, primaryEmail };
  }, transportOptions);
  const commandClasses = ["admin", "repo-write", "repo-read", "arbiter"] as const;
  const roles: RolePolicy[] = [{ roleId: "owner", commandClasses }];
  return {
    personRegistry,
    identityProvider: composeIdentityProvider(
      authentication,
      makePersonAuthorizationProvider(person.personId, commandClasses)
    ),
    identityAdminSnapshot: {
      people: [{
        personId: person.personId,
        displayName: person.displayName,
        primaryEmail,
        roles: ["owner"],
        disabled: false,
        credentials
      }],
      roles
    }
  };
}
