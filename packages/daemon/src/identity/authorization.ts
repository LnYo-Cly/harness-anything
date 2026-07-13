import type {
  AuthorizationProvider,
  DaemonCommandClass,
  IdentityAuthorizationAction,
  IdentityAuthorizationDecision,
  IdentityAuthorizationFailure,
  IdentityAuthorizationSuccess,
  PeopleRoster,
  PersonId
} from "./types.ts";

export type AuthorizationFailure = IdentityAuthorizationFailure;
export type AuthorizationSuccess = IdentityAuthorizationSuccess;

export function authorizePersonForMethod(
  personId: PersonId,
  action: IdentityAuthorizationAction,
  roster: PeopleRoster
): IdentityAuthorizationDecision {
  if (!action.commandClass) {
    return { ok: false, code: "command_class_missing", message: `Method is missing commandClass: ${action.method}` };
  }
  const binding = roster.people.find((person) => person.personId === personId);
  if (binding?.roles.some((roleId) => roster.roleAllows(roleId, action.commandClass!))) return { ok: true };
  return {
    ok: false,
    code: "rbac_forbidden",
    message: `Person ${personId} is not authorized for ${action.commandClass} method ${action.method}.`
  };
}

export function makePeopleRosterAuthorizationProvider(roster: PeopleRoster): AuthorizationProvider {
  return { authorize: async ({ personId, action }) => authorizePersonForMethod(personId, action, roster) };
}

export function makePersonAuthorizationProvider(
  personId: PersonId,
  commandClasses: ReadonlyArray<DaemonCommandClass>
): AuthorizationProvider {
  const allowed = new Set(commandClasses);
  return {
    authorize: async ({ personId: candidate, action }) => {
      if (!action.commandClass) {
        return { ok: false, code: "command_class_missing", message: `Method is missing commandClass: ${action.method}` };
      }
      if (candidate === personId && allowed.has(action.commandClass)) return { ok: true };
      return {
        ok: false,
        code: "rbac_forbidden",
        message: `Person ${candidate} is not authorized for ${action.commandClass} method ${action.method}.`
      };
    }
  };
}
