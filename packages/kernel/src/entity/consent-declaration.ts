import { Schema } from "effect";
import { consentActions } from "../domain/consent.ts";
import { decodeEntityDeclaration, jsonEntityDocumentCodec } from "./declaration.ts";
import {
  readyIdentityProjectionFacets,
  readyStorageLocator,
  typedOnlySemanticDiff
} from "./registry-compiler.ts";

const PersonPrincipalSchema = Schema.Struct({
  personId: Schema.String,
  displayName: Schema.optional(Schema.String),
  primaryEmail: Schema.optional(Schema.String),
  providerId: Schema.optional(Schema.String),
  credential: Schema.optional(Schema.Struct({ kind: Schema.String, issuer: Schema.String, subject: Schema.String }))
});

const ActorSchema = Schema.Struct({
  principal: PersonPrincipalSchema,
  executor: Schema.NullOr(Schema.Struct({ kind: Schema.Literal("agent"), id: Schema.String })),
  responsibleHuman: Schema.String
});

export const ConsentChannelSchema = Schema.Union(
  Schema.Struct({ kind: Schema.Literal("agent-relayed"), assurance: Schema.Literal("relayed-assertion") }),
  Schema.Struct({ kind: Schema.Literal("human-cli"), assurance: Schema.Literal("principal-bound-command") }),
  Schema.Struct({ kind: Schema.Literal("gui-click"), assurance: Schema.Literal("authenticated-interaction") })
);

export const ConsentResponseSchema = Schema.Union(
  Schema.Struct({
    kind: Schema.Literal("utterance"),
    text: Schema.String.pipe(Schema.minLength(1)),
    session_ref: Schema.String.pipe(Schema.pattern(/^session\/.+$/u))
  }),
  Schema.Struct({
    kind: Schema.Literal("interaction"),
    interaction_ref: Schema.String.pipe(Schema.minLength(1)),
    label: Schema.String.pipe(Schema.minLength(1))
  })
);

const ConsentBaseSchema = {
  schema: Schema.Literal("consent/v1"),
  consent_id: Schema.String.pipe(Schema.pattern(/^cns_[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{26}$/u)),
  task_ref: Schema.String.pipe(Schema.pattern(/^task\/task_[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{26}$/u)),
  execution_ref: Schema.String.pipe(Schema.pattern(/^execution\/task_[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{26}\/exe_[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{26}$/u)),
  principal: Schema.Struct({ personId: Schema.String.pipe(Schema.minLength(1)) }),
  scope: Schema.Struct({
    actions: Schema.Array(Schema.Literal(...consentActions)).pipe(Schema.minItems(1)),
    content_pin: Schema.Struct({
      algorithm: Schema.Literal("execution-consent-pin/v1"),
      digest: Schema.String.pipe(Schema.pattern(/^sha256:[a-f0-9]{64}$/u))
    })
  }),
  disclosure: Schema.Struct({
    completion_claim: Schema.String.pipe(Schema.minLength(1)),
    known_gaps: Schema.Array(Schema.String),
    residual_risks: Schema.Array(Schema.String)
  }),
  channel: ConsentChannelSchema,
  response: ConsentResponseSchema,
  recorded_by: ActorSchema,
  granted_at: Schema.String,
  expires_at: Schema.String
};

export const ConsentSnapshotSchema = Schema.Struct({
  principal: ConsentBaseSchema.principal,
  scope: ConsentBaseSchema.scope,
  disclosure: ConsentBaseSchema.disclosure,
  channel: ConsentBaseSchema.channel,
  response: ConsentBaseSchema.response,
  recorded_by: ConsentBaseSchema.recorded_by,
  granted_at: ConsentBaseSchema.granted_at,
  expires_at: ConsentBaseSchema.expires_at
});

export const ConsentSchema = Schema.Union(
  Schema.Struct({ ...ConsentBaseSchema, state: Schema.Literal("open", "expired"), consumed_by: Schema.Null, consumed_at: Schema.Null }),
  Schema.Struct({
    ...ConsentBaseSchema,
    state: Schema.Literal("consumed"),
    consumed_by: Schema.String.pipe(Schema.pattern(/^review\/task_[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{26}\/rev_[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{26}$/u)),
    consumed_at: Schema.String
  })
).pipe(Schema.filter((consent) => {
  const actions = consent.scope.actions;
  if (!actions.includes("approve_execution") || new Set(actions).size !== actions.length) return false;
  if (consent.recorded_by.principal.personId !== consent.principal.personId) return false;
  if (consent.channel.kind === "agent-relayed") {
    return consent.recorded_by.executor !== null && consent.response.kind === "utterance";
  }
  if (consent.recorded_by.executor !== null) return false;
  return consent.channel.kind === "gui-click"
    ? consent.response.kind === "interaction"
    : consent.response.kind === "utterance";
}));

export const consentDeclaration = decodeEntityDeclaration({
  kind: "consent",
  schema: ConsentSchema,
  documentCodec: jsonEntityDocumentCodec,
  mutabilityContract: {
    identity: { mutability: "immutable", read: [{ kind: "show", path: "consent.identity" }], write: [], reason: "consent identity and scope are immutable" },
    scope: { mutability: "immutable", read: [{ kind: "show", path: "consent.scope" }], write: [], reason: "consent remains bound to one execution content pin" },
    state: { mutability: "lifecycle", read: [{ kind: "projection", path: "state", queryable: true }], write: [{ kind: "lifecycle", operation: "consume" }, { kind: "lifecycle", operation: "expire" }], reason: "open consent has terminal consumed or expired outcomes" }
  },
  anchors: { entityRef: "consent/{taskId}/{consentId}", anchors: [] },
  dispositionMatrix: {
    entries: {
      retire: { level: "D1", action: "retire", supported: false, writeOpKinds: [], reason: "expiry is an explicit consent state" },
      supersede: { level: "D1", action: "supersede", supported: false, writeOpKinds: [], reason: "a new human statement creates a new consent" },
      invalidate: { level: "D1", action: "invalidate", supported: false, writeOpKinds: [], reason: "consent terminates through consumed or expired" },
      archive: { level: "D2", action: "archive", supported: false, writeOpKinds: [], reason: "consent follows its host task" },
      tombstone: { level: "D3", action: "tombstone", supported: false, writeOpKinds: [], reason: "consent history is durable" },
      "hard-delete": { level: "D4", action: "hard-delete", supported: false, writeOpKinds: [], reason: "consent is approval provenance" }
    }
  },
  storageForm: "hosted-entity",
  ...readyIdentityProjectionFacets("consent", ["taskId", "consentId"], {
    table: "consent_projection", idColumn: "consent_id", identityField: "consentId"
  }),
  storageLocator: readyStorageLocator({
    locate: (identity) => {
      const entityPath = `tasks/${identity.taskId}/consents/${identity.consentId}.md`;
      return {
        targets: [{ kind: "document", path: entityPath, access: "exact" }],
        consistencyScope: `path:${entityPath}`
      };
    }
  }),
  mutationContract: { status: "ready", actions: ["grant", "consume", "expire"] },
  semanticDiff: typedOnlySemanticDiff("machine-owned consent documents reject transparent canonical writes"),
  rootResolver: {
    pathTemplate: "tasks/{taskId}/consents/{consentId}.md",
    identity: ["taskId", "consentId"],
    host: { entityKind: "task", pathTemplate: "tasks/{taskId}", identity: ["taskId"] }
  },
  projection: {
    table: "consent_projection",
    columns: [
      { name: "consent_id", field: "consent_id", type: "text", primaryKey: true },
      { name: "task_ref", field: "task_ref", type: "text" },
      { name: "execution_ref", field: "execution_ref", type: "text" },
      { name: "principal_json", field: "principal", type: "json" },
      { name: "scope_json", field: "scope", type: "json" },
      { name: "disclosure_json", field: "disclosure", type: "json" },
      { name: "channel_json", field: "channel", type: "json" },
      { name: "response_json", field: "response", type: "json" },
      { name: "recorded_by_json", field: "recorded_by", type: "json" },
      { name: "granted_at", field: "granted_at", type: "text" },
      { name: "expires_at", field: "expires_at", type: "text" },
      { name: "state", field: "state", type: "text" },
      { name: "consumed_by", field: "consumed_by", type: "text" },
      { name: "consumed_at", field: "consumed_at", type: "text" }
    ]
  }
});
