import {
  copyBytes,
  equalBytes,
  isZeroBytes,
  xorBytes,
  zeroBytes,
} from "./bytes.js";
import {
  graphIdentity,
  inducedGraph,
  isConnected,
  type DcEdge,
  type DcGraph,
  type ParticipantId,
} from "./graph.js";
import {
  aggregateContributions,
  type BytesById,
  type RoundResult,
} from "./round.js";

function assertCompatibleRounds(first: RoundResult, second: RoundResult): void {
  if (graphIdentity(first.graph) !== graphIdentity(second.graph)) {
    throw new TypeError(
      "reuse analysis requires the same participant and key graph",
    );
  }
  if (first.width !== second.width) {
    throw new RangeError("reuse analysis requires equal contribution widths");
  }
}

export interface MaskReuseAnalysis {
  readonly allMasksReused: boolean;
  readonly reusedEdges: readonly string[];
  readonly broadcastDifferences: BytesById;
  readonly inputDifferences: BytesById;
  readonly perParticipantLeakEquation: ReadonlyMap<ParticipantId, boolean>;
  readonly firstRoundKnownEmpty: boolean;
  readonly recoveredSecondInputs: BytesById | null;
}

export function analyzeMaskReuse(
  first: RoundResult,
  second: RoundResult,
): MaskReuseAnalysis {
  assertCompatibleRounds(first, second);
  const reusedEdges = first.graph.edges
    .filter((edge) =>
      equalBytes(first.edgeMasks.get(edge.id)!, second.edgeMasks.get(edge.id)!),
    )
    .map((edge) => edge.id);
  const allMasksReused = reusedEdges.length === first.graph.edges.length;
  const broadcastDifferences = new Map<ParticipantId, Uint8Array>();
  const inputDifferences = new Map<ParticipantId, Uint8Array>();
  const perParticipantLeakEquation = new Map<ParticipantId, boolean>();
  for (const participant of first.graph.participants) {
    const broadcastDifference = xorBytes(
      first.broadcasts.get(participant)!,
      second.broadcasts.get(participant)!,
    );
    const inputDifference = xorBytes(
      first.inputs.get(participant)!,
      second.inputs.get(participant)!,
    );
    broadcastDifferences.set(participant, broadcastDifference);
    inputDifferences.set(participant, inputDifference);
    perParticipantLeakEquation.set(
      participant,
      equalBytes(broadcastDifference, inputDifference),
    );
  }
  const firstRoundKnownEmpty = first.graph.participants.every((participant) =>
    isZeroBytes(first.inputs.get(participant)!),
  );
  const recoveredSecondInputs =
    allMasksReused && firstRoundKnownEmpty
      ? new Map(
          first.graph.participants.map(
            (participant) =>
              [
                participant,
                copyBytes(broadcastDifferences.get(participant)!),
              ] as const,
          ),
        )
      : null;
  return {
    allMasksReused,
    reusedEdges,
    broadcastDifferences,
    inputDifferences,
    perParticipantLeakEquation,
    firstRoundKnownEmpty,
    recoveredSecondInputs,
  };
}

export interface DropoutAnalysis {
  readonly status: "aborted";
  readonly reason: "missing-contributions";
  readonly missingParticipants: readonly ParticipantId[];
  readonly presentParticipants: readonly ParticipantId[];
  readonly partialAggregate: Uint8Array;
  readonly presentInputXor: Uint8Array;
  readonly boundaryEdges: readonly DcEdge[];
  readonly boundaryMaskXor: Uint8Array;
  readonly expectedPartialAggregate: Uint8Array;
  readonly boundaryEquationHolds: boolean;
}

export function analyzeDropout(
  round: RoundResult,
  missingParticipants: readonly ParticipantId[],
): DropoutAnalysis {
  const missingSet = new Set(missingParticipants);
  if (missingSet.size !== missingParticipants.length || missingSet.size === 0) {
    throw new TypeError(
      "dropout analysis needs one or more unique missing participants",
    );
  }
  for (const participant of missingSet) {
    if (!round.graph.participants.includes(participant)) {
      throw new TypeError(
        `missing set names unknown participant: ${participant}`,
      );
    }
  }
  const missing = round.graph.participants.filter((participant) =>
    missingSet.has(participant),
  );
  const present = round.graph.participants.filter(
    (participant) => !missingSet.has(participant),
  );
  const received = round.contributions
    .filter((contribution) => !missingSet.has(contribution.participant))
    .map((contribution) => ({
      participant: contribution.participant,
      broadcast: contribution.broadcast,
    }));
  const aggregation = aggregateContributions({
    graph: round.graph,
    width: round.width,
    contributions: received,
  });
  if (aggregation.status !== "aborted") {
    throw new Error(
      "internal error: missing contributions did not abort aggregation",
    );
  }
  const partialAggregate =
    present.length === 0
      ? zeroBytes(round.width)
      : xorBytes(
          ...present.map((participant) => round.broadcasts.get(participant)!),
        );
  const presentInputXor =
    present.length === 0
      ? zeroBytes(round.width)
      : xorBytes(
          ...present.map((participant) => round.inputs.get(participant)!),
        );
  const boundaryEdges = round.graph.edges.filter(
    (edge) => missingSet.has(edge.left) !== missingSet.has(edge.right),
  );
  const boundaryMaskXor =
    boundaryEdges.length === 0
      ? zeroBytes(round.width)
      : xorBytes(...boundaryEdges.map((edge) => round.edgeMasks.get(edge.id)!));
  const expectedPartialAggregate = xorBytes(presentInputXor, boundaryMaskXor);
  return {
    status: "aborted",
    reason: "missing-contributions",
    missingParticipants: missing,
    presentParticipants: present,
    partialAggregate,
    presentInputXor,
    boundaryEdges,
    boundaryMaskXor,
    expectedPartialAggregate,
    boundaryEquationHolds: equalBytes(
      partialAggregate,
      expectedPartialAggregate,
    ),
  };
}

export interface ReformedGraph {
  readonly graph: DcGraph;
  readonly removedParticipants: readonly ParticipantId[];
  readonly connected: boolean;
  readonly requiresFreshMasks: true;
}

export function reformGraphAfterDropout(
  graph: DcGraph,
  missingParticipants: readonly ParticipantId[],
): ReformedGraph {
  const missingSet = new Set(missingParticipants);
  if (missingSet.size !== missingParticipants.length || missingSet.size === 0) {
    throw new TypeError(
      "reform requires one or more unique missing participants",
    );
  }
  for (const participant of missingSet) {
    if (!graph.participants.includes(participant)) {
      throw new TypeError(`cannot remove unknown participant: ${participant}`);
    }
  }
  if (graph.participants.length - missingSet.size < 2) {
    throw new RangeError(
      "a reformed DC-net needs at least two remaining participants",
    );
  }
  const reformed = inducedGraph(graph, missingSet);
  return {
    graph: reformed,
    removedParticipants: graph.participants.filter((participant) =>
      missingSet.has(participant),
    ),
    connected: isConnected(reformed),
    requiresFreshMasks: true,
  };
}
