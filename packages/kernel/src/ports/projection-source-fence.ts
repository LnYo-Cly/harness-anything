import type { HarnessLayoutOverrides } from "../layout/index.ts";

export interface StableProjectionSourceFence {
  readonly kind: "stable";
  readonly identity: string;
  readonly headOid: string;
  readonly dirty: boolean;
  readonly changedPaths: ReadonlyArray<string>;
}

export interface UnknownProjectionSourceFence {
  readonly kind: "unknown";
  readonly reason: "git-unavailable" | "unborn-head" | "unmerged" | "unsafe-path" | "unsupported-source" | "dirty-unbounded" | "unstable";
}

export type ProjectionSourceFence = StableProjectionSourceFence | UnknownProjectionSourceFence;

export interface ProjectionSourceFenceReader {
  readonly capture: () => ProjectionSourceFence | Promise<ProjectionSourceFence>;
  readonly refresh?: () => ProjectionSourceFence | Promise<ProjectionSourceFence>;
  readonly noteCanonicalPaths?: (paths: ReadonlyArray<string>) => void;
  readonly subscribe?: (listener: () => void) => () => void;
  readonly close?: () => void;
}

export type ProjectionSourceFenceFactory = (options: {
  readonly rootDir: string;
  readonly layoutOverrides?: HarnessLayoutOverrides;
}) => ProjectionSourceFenceReader;
