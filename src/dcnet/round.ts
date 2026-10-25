import {
  bytesToHex,
  copyBytes,
  equalBytes,
  isZeroBytes,
  sampleBytes,
  secureRandomBytes,
  xorBytes,
  zeroBytes,
  type RandomBytes,
} from "./bytes.js";
import {
  assertValidGraph,
  incidentEdges,
  type DcGraph,
  type ParticipantId,
} from "./graph.js";

export type BytesById = ReadonlyMap<string, Uint8Array>;

export interface ParticipantContribution {
  readonly participant: ParticipantId;
  readonly input: Uint8Array;
  readonly incidentEdges: readonly string[];
  readonly broadcast: Uint8Array;
}

export interface PublicContribution {
  readonly participant: ParticipantId;
  readonly broadcast: Uint8Array;
}

export interface RoundResult {
  readonly graph: DcGraph;
  readonly roundId: string;
  readonly width: number;
  readonly edgeMasks: BytesById;
  readonly inputs: BytesById;
  readonly contributions: readonly ParticipantContribution[];
  readonly broadcasts: BytesById;
  readonly aggregate: Uint8Array;
}

export interface RunRoundOptions {
  readonly graph: DcGraph;
  readonly inputs: BytesById;
  readonly roundId?: string;
  readonly rng?: RandomBytes;
  readonly edgeMasks?: BytesById;
}

export type FreshRoundOptions = Omit<RunRoundOptions, "graph">;

export type ContributionIssue =
  | { readonly kind: "unknown-participant"; readonly participant: string }
  | { readonly kind: "duplicate-participant"; readonly participant: string }
  | { readonly kind: "not-byte-vector"; readonly participant: string }
  | {
      readonly kind: "wrong-width";
      readonly participant: string;
      readonly expected: number;
      readonly actual: number;
    };

export type ContributionAggregation =
  | {
      readonly status: "ok";
      readonly aggregate: Uint8Array;
      readonly accepted: readonly PublicContribution[];
    }
  | {
      readonly status: "malformed";
      readonly issues: readonly ContributionIssue[];
      readonly missing: readonly ParticipantId[];
    }
  | {
      readonly status: "aborted";
      readonly reason: "missing-contributions";
      readonly missing: readonly ParticipantId[];
    };

export interface AggregateContributionOptions {
  readonly graph: DcGraph;
  readonly width: number;
  readonly contributions: readonly PublicContribution[];
}

function validateWidth(width: number): void {
  if (!Number.isSafeInteger(width) || width <= 0) {
    throw new RangeError("contribution width must be a positive safe integer");
  }
}

function cloneExactAssignments(
  ids: readonly string[],
  assignments: BytesById,
  label: string,
  expectedWidth?: number,
): {
  readonly values: ReadonlyMap<string, Uint8Array>;
  readonly width: number;
} {
  const allowed = new Set(ids);
  for (const id of assignments.keys()) {
    if (!allowed.has(id))
      throw new TypeError(`${label} contains unknown identifier: ${id}`);
  }
  for (const id of ids) {
    if (!assignments.has(id))
      throw new TypeError(`${label} is missing identifier: ${id}`);
  }

  const first = assignments.get(ids[0]!)!;
  const width = expectedWidth ?? first.length;
  validateWidth(width);
  const result = new Map<string, Uint8Array>();
  for (const id of ids) {
    const value = assignments.get(id)!;
    if (!(value instanceof Uint8Array)) {
      throw new TypeError(`${label} for ${id} must be a Uint8Array`);
    }
    if (value.length !== width) {
      throw new RangeError(`${label} for ${id} must be exactly ${width} bytes`);
    }
    result.set(id, copyBytes(value));
  }
  return { values: result, width };
}

export function makeZeroInputs(graph: DcGraph, width: number): BytesById {
  validateWidth(width);
  return new Map(
    graph.participants.map(
      (participant) => [participant, zeroBytes(width)] as const,
    ),
  );
}

export function makeSingleSenderInputs(
  graph: DcGraph,
  sender: ParticipantId,
  payload: Uint8Array,
): BytesById {
  if (!graph.participants.includes(sender))
    throw new TypeError(`unknown sender: ${sender}`);
  validateWidth(payload.length);
  return new Map(
    graph.participants.map(
      (participant) =>
        [
          participant,
          participant === sender
            ? copyBytes(payload)
            : zeroBytes(payload.length),
        ] as const,
    ),
  );
}

export function sampleEdgeMasks(
  graph: DcGraph,
  width: number,
  rng: RandomBytes = secureRandomBytes,
): BytesById {
  validateWidth(width);
  return new Map(
    graph.edges.map((edge) => [edge.id, sampleBytes(width, rng)] as const),
  );
}

export function runRound(options: RunRoundOptions): RoundResult {
  const graph = assertValidGraph(options.graph);
  const inputAssignments = cloneExactAssignments(
    graph.participants,
    options.inputs,
    "input assignment",
  );
  const width = inputAssignments.width;
  const edgeMasks =
    options.edgeMasks === undefined
      ? sampleEdgeMasks(graph, width, options.rng)
      : cloneExactAssignments(
          graph.edges.map((edge) => edge.id),
          options.edgeMasks,
          "edge-mask assignment",
          width,
        ).values;

  const contributions: ParticipantContribution[] = [];
  const broadcasts = new Map<ParticipantId, Uint8Array>();
  for (const participant of graph.participants) {
    const edges = incidentEdges(graph, participant);
    const terms = [
      inputAssignments.values.get(participant)!,
      ...edges.map((edge) => edgeMasks.get(edge.id)!),
    ];
    const broadcast = xorBytes(...terms);
    broadcasts.set(participant, copyBytes(broadcast));
    contributions.push({
      participant,
      input: copyBytes(inputAssignments.values.get(participant)!),
      incidentEdges: Object.freeze(edges.map((edge) => edge.id)),
      broadcast: copyBytes(broadcast),
    });
  }

  const aggregate = xorBytes(
    ...graph.participants.map((participant) => broadcasts.get(participant)!),
  );

  return {
    graph,
    roundId: options.roundId ?? "round-1",
    width,
    edgeMasks,
    inputs: inputAssignments.values,
    contributions: Object.freeze(contributions),
    broadcasts,
    aggregate,
  };
}

function maskAssignmentFingerprint(round: RoundResult): string {
  return JSON.stringify(
    [...round.graph.edges]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((edge) => [edge.id, bytesToHex(round.edgeMasks.get(edge.id)!)]),
  );
}

/**
 * Stateful guard for the honest lesson path. It rejects a repeated round label
 * and an exactly repeated complete edge-mask assignment. Deliberate reuse
 * demonstrations call the stateless runRound helper instead.
 */
export class FreshRoundGuard {
  readonly graph: DcGraph;

  #roundIds = new Set<string>();
  #maskAssignments = new Set<string>();

  constructor(graph: DcGraph) {
    this.graph = assertValidGraph(graph);
  }

  get acceptedRoundCount(): number {
    return this.#roundIds.size;
  }

  run(options: FreshRoundOptions): RoundResult {
    const roundId = options.roundId ?? "round-1";
    if (this.#roundIds.has(roundId)) {
      throw new Error(`honest round identifier was already used: ${roundId}`);
    }

    const round = runRound({ ...options, graph: this.graph, roundId });
    const fingerprint = maskAssignmentFingerprint(round);
    if (this.#maskAssignments.has(fingerprint)) {
      throw new Error(
        "honest path refuses an exactly reused edge-mask assignment",
      );
    }

    this.#roundIds.add(roundId);
    this.#maskAssignments.add(fingerprint);
    return round;
  }
}

export function aggregateContributions(
  options: AggregateContributionOptions,
): ContributionAggregation {
  const graph = assertValidGraph(options.graph);
  validateWidth(options.width);
  const participants = new Set(graph.participants);
  const seen = new Set<ParticipantId>();
  const issues: ContributionIssue[] = [];
  const accepted: PublicContribution[] = [];

  for (const contribution of options.contributions) {
    if (!participants.has(contribution.participant)) {
      issues.push({
        kind: "unknown-participant",
        participant: contribution.participant,
      });
      continue;
    }
    if (seen.has(contribution.participant)) {
      issues.push({
        kind: "duplicate-participant",
        participant: contribution.participant,
      });
      continue;
    }
    seen.add(contribution.participant);
    if (!(contribution.broadcast instanceof Uint8Array)) {
      issues.push({
        kind: "not-byte-vector",
        participant: contribution.participant,
      });
      continue;
    }
    if (contribution.broadcast.length !== options.width) {
      issues.push({
        kind: "wrong-width",
        participant: contribution.participant,
        expected: options.width,
        actual: contribution.broadcast.length,
      });
      continue;
    }
    accepted.push({
      participant: contribution.participant,
      broadcast: copyBytes(contribution.broadcast),
    });
  }

  const missing = graph.participants.filter(
    (participant) => !seen.has(participant),
  );
  if (issues.length > 0) {
    return { status: "malformed", issues, missing };
  }
  if (missing.length > 0) {
    return { status: "aborted", reason: "missing-contributions", missing };
  }

  const byParticipant = new Map(
    accepted.map(
      (contribution) => [contribution.participant, contribution] as const,
    ),
  );
  const ordered = graph.participants.map((participant) =>
    byParticipant.get(participant)!,
  );
  return {
    status: "ok",
    aggregate: xorBytes(
      ...ordered.map((contribution) => contribution.broadcast),
    ),
    accepted: ordered,
  };
}

export interface CollisionAnalysis {
  readonly senderIds: readonly ParticipantId[];
  readonly senderCount: number;
  readonly aggregate: Uint8Array;
  readonly zeroAggregate: boolean;
  readonly multipleSenders: boolean;
  readonly oneBitParity: 0 | 1 | null;
  readonly outputDeterminesSenderCount: false;
}

export function analyzeCollision(inputs: BytesById): CollisionAnalysis {
  if (inputs.size === 0)
    throw new RangeError("collision analysis needs participants");
  const values = [...inputs.values()];
  const width = values[0]!.length;
  validateWidth(width);
  if (values.some((value) => value.length !== width)) {
    throw new RangeError("all inputs must have the same width");
  }
  const senderIds = [...inputs.entries()]
    .filter(([, input]) => !isZeroBytes(input))
    .map(([participant]) => participant);
  const aggregate = xorBytes(...values);
  const isOneBitModel =
    width === 1 && values.every((value) => value[0] === 0 || value[0] === 1);
  return {
    senderIds,
    senderCount: senderIds.length,
    aggregate,
    zeroAggregate: isZeroBytes(aggregate),
    multipleSenders: senderIds.length > 1,
    oneBitParity: isOneBitModel ? ((senderIds.length % 2) as 0 | 1) : null,
    outputDeterminesSenderCount: false,
  };
}

export interface ShapedJamAnalysis {
  readonly participant: ParticipantId;
  readonly structurallyAccepted: true;
  readonly honestBroadcast: Uint8Array;
  readonly dishonestBroadcast: Uint8Array;
  readonly delta: Uint8Array;
  readonly honestAggregate: Uint8Array;
  readonly jammedAggregate: Uint8Array;
}

export function analyzeShapedJam(
  round: RoundResult,
  participant: ParticipantId,
  dishonestBroadcast: Uint8Array,
): ShapedJamAnalysis {
  if (!round.graph.participants.includes(participant)) {
    throw new TypeError(`unknown participant: ${participant}`);
  }
  if (dishonestBroadcast.length !== round.width) {
    throw new RangeError(
      `dishonest contribution must be exactly ${round.width} bytes`,
    );
  }
  const honestBroadcast = round.broadcasts.get(participant)!;
  const replaced = round.contributions.map((contribution) => ({
    participant: contribution.participant,
    broadcast:
      contribution.participant === participant
        ? dishonestBroadcast
        : contribution.broadcast,
  }));
  const aggregation = aggregateContributions({
    graph: round.graph,
    width: round.width,
    contributions: replaced,
  });
  if (aggregation.status !== "ok") {
    throw new Error("internal error: a shaped replacement became malformed");
  }
  const delta = xorBytes(honestBroadcast, dishonestBroadcast);
  if (!equalBytes(aggregation.aggregate, xorBytes(round.aggregate, delta))) {
    throw new Error(
      "internal error: jam delta did not transfer to the aggregate",
    );
  }
  return {
    participant,
    structurallyAccepted: true,
    honestBroadcast: copyBytes(honestBroadcast),
    dishonestBroadcast: copyBytes(dishonestBroadcast),
    delta,
    honestAggregate: copyBytes(round.aggregate),
    jammedAggregate: aggregation.aggregate,
  };
}
