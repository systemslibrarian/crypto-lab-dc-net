import {
  copyBytes,
  equalBytes,
  sampleBytes,
  secureRandomBytes,
  type RandomBytes,
} from "./bytes.js";
import { assertValidGraph, type DcGraph, type ParticipantId } from "./graph.js";
import { aggregateContributions, type PublicContribution } from "./round.js";

const COMMITMENT_DOMAIN = "crypto-lab-dc-net/contribution-commitment/v1";
export const COMMITMENT_NONCE_BYTES = 32;
export const COMMITMENT_DIGEST_BYTES = 32;

export interface ContributionCommitmentOpening {
  readonly sessionId: string;
  readonly roundId: string;
  readonly graph: DcGraph;
  readonly participant: ParticipantId;
  readonly contribution: Uint8Array;
  readonly nonce: Uint8Array;
}

function assertWellFormedText(value: string, label: string): void {
  if (value.length === 0) throw new TypeError(`${label} must not be empty`);
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new TypeError(`${label} must be well-formed Unicode`);
      }
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new TypeError(`${label} must be well-formed Unicode`);
    }
  }
}

function uint32(value: number): Uint8Array {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new RangeError("canonical field length exceeds uint32");
  }
  const result = new Uint8Array(4);
  new DataView(result.buffer).setUint32(0, value, false);
  return result;
}

function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  if (!Number.isSafeInteger(length))
    throw new RangeError("canonical payload is too large");
  const result = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function frame(value: Uint8Array): Uint8Array {
  return concatBytes([uint32(value.length), value]);
}

function encodeText(value: string, label: string): Uint8Array {
  assertWellFormedText(value, label);
  return new TextEncoder().encode(value);
}

function compareByteStrings(left: Uint8Array, right: Uint8Array): number {
  const common = Math.min(left.length, right.length);
  for (let index = 0; index < common; index += 1) {
    const difference = left[index]! - right[index]!;
    if (difference !== 0) return difference;
  }
  return left.length - right.length;
}

function compareText(left: string, right: string): number {
  return compareByteStrings(
    new TextEncoder().encode(left),
    new TextEncoder().encode(right),
  );
}

function canonicalGraphParts(graph: DcGraph): readonly Uint8Array[] {
  // Membership order is protocol context, not a set: the declared order is bound.
  const participants = graph.participants;
  const edges = graph.edges
    .map((edge) => {
      const endpoints = [edge.left, edge.right].sort(compareText);
      return { id: edge.id, left: endpoints[0]!, right: endpoints[1]! };
    })
    .sort((left, right) => compareText(left.id, right.id));

  return [
    uint32(participants.length),
    ...participants.map((participant) =>
      frame(encodeText(participant, "participant identifier")),
    ),
    uint32(edges.length),
    ...edges.flatMap((edge) => [
      frame(encodeText(edge.id, "edge identifier")),
      frame(encodeText(edge.left, "edge endpoint")),
      frame(encodeText(edge.right, "edge endpoint")),
    ]),
  ];
}

export function canonicalCommitmentPayload(
  opening: ContributionCommitmentOpening,
): Uint8Array {
  const graph = assertValidGraph(opening.graph);
  if (!graph.participants.includes(opening.participant)) {
    throw new TypeError(
      `commitment participant is not in the graph: ${opening.participant}`,
    );
  }
  if (
    !(opening.contribution instanceof Uint8Array) ||
    opening.contribution.length === 0
  ) {
    throw new RangeError(
      "committed contribution must be a non-empty Uint8Array",
    );
  }
  if (
    !(opening.nonce instanceof Uint8Array) ||
    opening.nonce.length !== COMMITMENT_NONCE_BYTES
  ) {
    throw new RangeError(
      `commitment nonce must be exactly ${COMMITMENT_NONCE_BYTES} bytes`,
    );
  }

  return concatBytes([
    frame(encodeText(COMMITMENT_DOMAIN, "commitment domain")),
    frame(encodeText(opening.sessionId, "session identifier")),
    frame(encodeText(opening.roundId, "round identifier")),
    ...canonicalGraphParts(graph),
    frame(encodeText(opening.participant, "participant identifier")),
    frame(opening.contribution),
    frame(opening.nonce),
  ]);
}

async function sha256(value: Uint8Array): Promise<Uint8Array> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle === undefined)
    throw new Error("Web Crypto SHA-256 is unavailable");
  const owned = new Uint8Array(value.length);
  owned.set(value);
  const digest = await subtle.digest("SHA-256", owned.buffer);
  return new Uint8Array(digest);
}

export function generateCommitmentNonce(
  rng: RandomBytes = secureRandomBytes,
): Uint8Array {
  return sampleBytes(COMMITMENT_NONCE_BYTES, rng);
}

export async function createContributionCommitment(
  opening: ContributionCommitmentOpening,
): Promise<Uint8Array> {
  return sha256(canonicalCommitmentPayload(opening));
}

export async function verifyContributionCommitment(
  commitment: Uint8Array,
  opening: ContributionCommitmentOpening,
): Promise<boolean> {
  if (
    !(commitment instanceof Uint8Array) ||
    commitment.length !== COMMITMENT_DIGEST_BYTES
  ) {
    return false;
  }
  let payload: Uint8Array;
  try {
    payload = canonicalCommitmentPayload(opening);
  } catch (error) {
    if (error instanceof TypeError || error instanceof RangeError) return false;
    throw error;
  }
  return equalBytes(commitment, await sha256(payload));
}

export type CommitRevealPhase = "commit" | "reveal" | "complete" | "aborted";

export type CommitRevealAbortReason =
  | "unknown-participant"
  | "duplicate-commitment"
  | "invalid-commitment-length"
  | "missing-commitments"
  | "early-reveal"
  | "duplicate-reveal"
  | "wrong-contribution-width"
  | "invalid-opening"
  | "missing-reveals";

export type CommitRevealAction =
  | { readonly accepted: true }
  | {
      readonly accepted: false;
      readonly reason: CommitRevealAbortReason | "phase-closed";
    };

export type CommitRevealTransition =
  | { readonly status: "ready" }
  | { readonly status: "closed"; readonly phase: "complete" }
  | {
      readonly status: "aborted";
      readonly reason: CommitRevealAbortReason;
      readonly missing: readonly ParticipantId[];
    };

export type CommitRevealFinalResult =
  | {
      readonly status: "ok";
      readonly aggregate: Uint8Array;
      readonly contributions: readonly PublicContribution[];
    }
  | {
      readonly status: "aborted";
      readonly reason: CommitRevealAbortReason;
      readonly missing: readonly ParticipantId[];
    };

export interface CommitRevealCoordinatorOptions {
  readonly graph: DcGraph;
  readonly sessionId: string;
  readonly roundId: string;
  readonly width: number;
}

function copyFinalResult(
  result: CommitRevealFinalResult,
): CommitRevealFinalResult {
  return result.status === "ok"
    ? {
        status: "ok",
        aggregate: copyBytes(result.aggregate),
        contributions: result.contributions.map(
          ({ participant, broadcast }) => ({
            participant,
            broadcast: copyBytes(broadcast),
          }),
        ),
      }
    : {
        status: "aborted",
        reason: result.reason,
        missing: [...result.missing],
      };
}

export class CommitRevealCoordinator {
  readonly graph: DcGraph;
  readonly sessionId: string;
  readonly roundId: string;
  readonly width: number;

  #phase: CommitRevealPhase = "commit";
  #commitments = new Map<ParticipantId, Uint8Array>();
  #reveals = new Map<ParticipantId, Uint8Array>();
  #pendingReveals = new Set<ParticipantId>();
  #abortReason: CommitRevealAbortReason | null = null;
  #abortMissing: readonly ParticipantId[] = [];
  #finalResult: CommitRevealFinalResult | null = null;

  constructor(options: CommitRevealCoordinatorOptions) {
    this.graph = assertValidGraph(options.graph);
    assertWellFormedText(options.sessionId, "session identifier");
    assertWellFormedText(options.roundId, "round identifier");
    if (!Number.isSafeInteger(options.width) || options.width <= 0) {
      throw new RangeError(
        "commit/reveal width must be a positive safe integer",
      );
    }
    this.sessionId = options.sessionId;
    this.roundId = options.roundId;
    this.width = options.width;
  }

  get phase(): CommitRevealPhase {
    return this.#phase;
  }

  get commitments(): ReadonlyMap<ParticipantId, Uint8Array> {
    return new Map(
      [...this.#commitments].map(([participant, digest]) => [
        participant,
        copyBytes(digest),
      ]),
    );
  }

  get reveals(): ReadonlyMap<ParticipantId, Uint8Array> {
    return new Map(
      [...this.#reveals].map(([participant, contribution]) => [
        participant,
        copyBytes(contribution),
      ]),
    );
  }

  #missingFrom(
    values: ReadonlyMap<ParticipantId, Uint8Array>,
  ): readonly ParticipantId[] {
    return this.graph.participants.filter(
      (participant) => !values.has(participant),
    );
  }

  #abort(
    reason: CommitRevealAbortReason,
    missing: readonly ParticipantId[] = [],
  ): CommitRevealAction {
    this.#phase = "aborted";
    this.#abortReason = reason;
    this.#abortMissing = [...missing];
    this.#finalResult = { status: "aborted", reason, missing: [...missing] };
    return { accepted: false, reason };
  }

  submitCommitment(
    participant: ParticipantId,
    commitment: Uint8Array,
  ): CommitRevealAction {
    if (this.#phase !== "commit")
      return { accepted: false, reason: "phase-closed" };
    if (!this.graph.participants.includes(participant)) {
      return this.#abort("unknown-participant");
    }
    if (this.#commitments.has(participant))
      return this.#abort("duplicate-commitment");
    if (
      !(commitment instanceof Uint8Array) ||
      commitment.length !== COMMITMENT_DIGEST_BYTES
    ) {
      return this.#abort("invalid-commitment-length");
    }
    this.#commitments.set(participant, copyBytes(commitment));
    return { accepted: true };
  }

  beginReveal(): CommitRevealTransition {
    if (this.#phase === "aborted") {
      return {
        status: "aborted",
        reason: this.#abortReason!,
        missing: [...this.#abortMissing],
      };
    }
    if (this.#phase !== "commit") {
      return this.#phase === "reveal"
        ? { status: "ready" }
        : { status: "closed", phase: "complete" };
    }
    const missing = this.#missingFrom(this.#commitments);
    if (missing.length > 0) {
      this.#abort("missing-commitments", missing);
      return { status: "aborted", reason: "missing-commitments", missing };
    }
    this.#phase = "reveal";
    return { status: "ready" };
  }

  async submitReveal(
    participant: ParticipantId,
    contribution: Uint8Array,
    nonce: Uint8Array,
  ): Promise<CommitRevealAction> {
    if (this.#phase === "commit") return this.#abort("early-reveal");
    if (this.#phase !== "reveal")
      return { accepted: false, reason: "phase-closed" };
    if (!this.graph.participants.includes(participant)) {
      return this.#abort("unknown-participant");
    }
    if (
      this.#reveals.has(participant) ||
      this.#pendingReveals.has(participant)
    ) {
      return this.#abort("duplicate-reveal");
    }
    if (
      !(contribution instanceof Uint8Array) ||
      contribution.length !== this.width
    ) {
      return this.#abort("wrong-contribution-width");
    }
    const contributionSnapshot = copyBytes(contribution);
    const nonceSnapshot = copyBytes(nonce);
    this.#pendingReveals.add(participant);
    let valid: boolean;
    try {
      valid = await verifyContributionCommitment(
        this.#commitments.get(participant)!,
        {
          sessionId: this.sessionId,
          roundId: this.roundId,
          graph: this.graph,
          participant,
          contribution: contributionSnapshot,
          nonce: nonceSnapshot,
        },
      );
    } finally {
      this.#pendingReveals.delete(participant);
    }
    if (this.#phase !== "reveal")
      return { accepted: false, reason: "phase-closed" };
    if (!valid) return this.#abort("invalid-opening");
    this.#reveals.set(participant, contributionSnapshot);
    return { accepted: true };
  }

  finalize(): CommitRevealFinalResult {
    if (this.#finalResult !== null) return copyFinalResult(this.#finalResult);
    if (this.#phase === "commit") {
      const missing = this.#missingFrom(this.#commitments);
      if (missing.length > 0) {
        this.#abort("missing-commitments", missing);
      } else {
        this.#abort("missing-reveals", this.graph.participants);
      }
      return copyFinalResult(this.#finalResult!);
    }
    const missing = this.#missingFrom(this.#reveals);
    if (missing.length > 0 || this.#pendingReveals.size > 0) {
      const stillMissing = this.graph.participants.filter(
        (participant) => !this.#reveals.has(participant),
      );
      this.#abort("missing-reveals", stillMissing);
      return copyFinalResult(this.#finalResult!);
    }
    const contributions = this.graph.participants.map((participant) => ({
      participant,
      broadcast: this.#reveals.get(participant)!,
    }));
    const aggregation = aggregateContributions({
      graph: this.graph,
      width: this.width,
      contributions,
    });
    if (aggregation.status !== "ok") {
      throw new Error(
        "internal error: complete reveal set failed structural aggregation",
      );
    }
    this.#phase = "complete";
    this.#finalResult = {
      status: "ok",
      aggregate: aggregation.aggregate,
      contributions: aggregation.accepted,
    };
    return copyFinalResult(this.#finalResult);
  }
}
