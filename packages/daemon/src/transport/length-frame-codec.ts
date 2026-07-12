export const defaultAuthorityMaxFrameBytes = 1024 * 1024;

export interface LengthFrameBatch {
  readonly frames: ReadonlyArray<unknown>;
  readonly error?: Error;
}

export interface LengthPrefixedFrameReader {
  readonly push: (chunk: Buffer | Uint8Array) => LengthFrameBatch;
  readonly flush: () => LengthFrameBatch;
}

export function createLengthPrefixedFrameReader(maxFrameBytes = defaultAuthorityMaxFrameBytes): LengthPrefixedFrameReader {
  if (!Number.isSafeInteger(maxFrameBytes) || maxFrameBytes <= 0) throw new Error("maxFrameBytes must be a positive safe integer");
  let buffered = Buffer.alloc(0);
  let failed: Error | undefined;

  return {
    push: (chunk) => {
      if (failed) return { frames: [], error: failed };
      buffered = buffered.length === 0 ? Buffer.from(chunk) : Buffer.concat([buffered, Buffer.from(chunk)]);
      return drain();
    },
    flush: () => {
      if (failed) return { frames: [], error: failed };
      if (buffered.length === 0) return { frames: [] };
      failed = new Error(`truncated authority frame: ${buffered.length} byte(s) remain`);
      return { frames: [], error: failed };
    }
  };

  function drain(): LengthFrameBatch {
    const frames: unknown[] = [];
    while (buffered.length >= 4) {
      const length = buffered.readUInt32BE(0);
      if (length > maxFrameBytes) {
        failed = new Error(`authority frame length ${length} exceeds limit ${maxFrameBytes}`);
        return { frames, error: failed };
      }
      if (buffered.length < 4 + length) break;
      const body = buffered.subarray(4, 4 + length);
      buffered = buffered.subarray(4 + length);
      try {
        frames.push(JSON.parse(body.toString("utf8")) as unknown);
      } catch (error) {
        failed = new Error(`invalid authority frame JSON: ${error instanceof Error ? error.message : String(error)}`);
        return { frames, error: failed };
      }
    }
    return { frames };
  }
}

export function encodeLengthPrefixedFrame(frame: unknown, maxFrameBytes = defaultAuthorityMaxFrameBytes): Buffer {
  const body = Buffer.from(JSON.stringify(frame), "utf8");
  if (body.length > maxFrameBytes) throw new Error(`authority frame length ${body.length} exceeds limit ${maxFrameBytes}`);
  const prefix = Buffer.allocUnsafe(4);
  prefix.writeUInt32BE(body.length, 0);
  return Buffer.concat([prefix, body]);
}
