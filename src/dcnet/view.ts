import {
  bytesToHex,
  copyBytes,
  equalBytes,
  isZeroBytes,
  xorBytes,
  zeroBytes,
} from "./bytes.js";
import {
  connectedComponents,
  incidentEdges,
  type DcEdge,
  type ParticipantId,
} from "./graph.js";
import {
  makeSingleSenderInputs,
  runRound,
  type BytesById,
  type RoundResult,
} from "./round.js";

export interface ComponentTotal {
  readonly participants: readonly ParticipantId[];
  readonly total: Uint8Array;
}

export interface PosteriorEntry {
  readonly participant: ParticipantId;
  readonly priorWeight: number;
  readonly normalizedPrior: number;
  readonly posterior: number;
}

export type ExactOneReason =
  | "compatible"
  | "coalition-input-is-nonzero"
  | "no-single-compatible-component";

export interface ExactOneAnalysis {
  readonly payload: Uint8Array;
  readonly compatible: boolean;
  readonly reason: ExactOneReason;
  readonly candidates: readonly ParticipantId[];
  readonly posterior: readonly PosteriorEntry[] | null;
}

export interface CoalitionAnalysis {
  readonly coalition: readonly ParticipantId[];
  readonly honestParticipants: readonly ParticipantId[];
  readonly knownEdges: readonly DcEdge[];
  readonly unknownEdges: readonly DcEdge[];
  readonly knownMasks: BytesById;
  readonly residualBroadcasts: BytesById;
  readonly components: readonly ComponentTotal[];
  readonly exactOne: ExactOneAnalysis | null;
}

export interface AnalyzeCoalitionOptions {
  readonly round: RoundResult;
  readonly coalition: readonly ParticipantId[];
  readonly exactOnePayload?: Uint8Array;
  readonly priors?: ReadonlyMap<ParticipantId, number>;
}

function validateKnownEdges(
  round: RoundResult,
  knownEdgeIds: ReadonlySet<string>,
): void {
  const graphEdgeIds = new Set(round.graph.edges.map((edge) => edge.id));
  for (const edgeId of knownEdgeIds) {
    if (!graphEdgeIds.has(edgeId))
      throw new TypeError(`unknown disclosed edge: ${edgeId}`);
  }
}

function residualForParticipant(
  round: RoundResult,
  participant: ParticipantId,
  knownEdgeIds: ReadonlySet<string>,
): Uint8Array {
  const knownIncidentMasks = incidentEdges(round.graph, participant)
    .filter((edge) => knownEdgeIds.has(edge.id))
    .map((edge) => round.edgeMasks.get(edge.id)!);
  if (knownIncidentMasks.length === 0) {
    return copyBytes(round.broadcasts.get(participant)!);
  }
  return xorBytes(round.broadcasts.get(participant)!, ...knownIncidentMasks);
}

function observerComponents(
  round: RoundResult,
  knownEdgeIds: ReadonlySet<string>,
  excludedParticipants: ReadonlySet<ParticipantId>,
): {
  readonly residualBroadcasts: BytesById;
  readonly components: readonly ComponentTotal[];
} {
  validateKnownEdges(round, knownEdgeIds);
  const residualBroadcasts = new Map<ParticipantId, Uint8Array>();
  for (const participant of round.graph.participants) {
    if (!excludedParticipants.has(participant)) {
      residualBroadcasts.set(
        participant,
        residualForParticipant(round, participant, knownEdgeIds),
      );
    }
  }
  const componentMembers = connectedComponents(round.graph, {
    excludedParticipants,
    excludedEdges: knownEdgeIds,
  });
  const components = componentMembers.map((participants) => ({
    participants,
    total: xorBytes(
      ...participants.map((participant) =>
        residualBroadcasts.get(participant)!,
      ),
    ),
  }));
  return { residualBroadcasts, components };
}

export function priorPreservingPosterior(
  universe: readonly ParticipantId[],
  candidates: readonly ParticipantId[],
  priors: ReadonlyMap<ParticipantId, number>,
): readonly PosteriorEntry[] {
  const universeSet = new Set(universe);
  const candidateSet = new Set(candidates);
  if (candidateSet.size !== candidates.length) {
    throw new TypeError("candidate identifiers must be unique");
  }
  for (const candidate of candidates) {
    if (!universeSet.has(candidate))
      throw new TypeError(`candidate is outside universe: ${candidate}`);
  }
  for (const participant of universe) {
    if (!priors.has(participant))
      throw new TypeError(`missing prior for ${participant}`);
    const weight = priors.get(participant)!;
    if (!Number.isFinite(weight) || weight < 0) {
      throw new RangeError(
        `prior for ${participant} must be finite and non-negative`,
      );
    }
  }
  for (const participant of priors.keys()) {
    if (!universeSet.has(participant))
      throw new TypeError(`prior names unknown participant: ${participant}`);
  }

  const totalPrior = universe.reduce(
    (sum, participant) => sum + priors.get(participant)!,
    0,
  );
  if (!(totalPrior > 0))
    throw new RangeError("prior weights must have positive total mass");
  const candidateMass = candidates.reduce(
    (sum, participant) => sum + priors.get(participant)!,
    0,
  );
  if (!(candidateMass > 0)) {
    throw new RangeError("compatible candidates must have positive prior mass");
  }

  return universe.map((participant) => {
    const weight = priors.get(participant)!;
    return {
      participant,
      priorWeight: weight,
      normalizedPrior: weight / totalPrior,
      posterior: candidateSet.has(participant) ? weight / candidateMass : 0,
    };
  });
}

export function analyzeCoalition(
  options: AnalyzeCoalitionOptions,
): CoalitionAnalysis {
  const { round } = options;
  const coalitionSet = new Set<ParticipantId>();
  for (const participant of options.coalition) {
    if (!round.graph.participants.includes(participant)) {
      throw new TypeError(
        `coalition names unknown participant: ${participant}`,
      );
    }
    if (coalitionSet.has(participant)) {
      throw new TypeError(`duplicate coalition participant: ${participant}`);
    }
    coalitionSet.add(participant);
  }
  const coalition = round.graph.participants.filter((participant) =>
    coalitionSet.has(participant),
  );
  const honestParticipants = round.graph.participants.filter(
    (participant) => !coalitionSet.has(participant),
  );
  const knownEdges = round.graph.edges.filter(
    (edge) => coalitionSet.has(edge.left) || coalitionSet.has(edge.right),
  );
  const knownEdgeIds = new Set(knownEdges.map((edge) => edge.id));
  const unknownEdges = round.graph.edges.filter(
    (edge) => !knownEdgeIds.has(edge.id),
  );
  const knownMasks = new Map(
    knownEdges.map(
      (edge) => [edge.id, copyBytes(round.edgeMasks.get(edge.id)!)] as const,
    ),
  );
  const observer = observerComponents(round, knownEdgeIds, coalitionSet);

  let exactOne: ExactOneAnalysis | null = null;
  if (options.exactOnePayload !== undefined) {
    const payload = copyBytes(options.exactOnePayload);
    if (payload.length !== round.width) {
      throw new RangeError(
        `exact-one payload must be exactly ${round.width} bytes`,
      );
    }
    if (isZeroBytes(payload)) {
      throw new RangeError("an exact-one payload must be nonzero");
    }
    const coalitionIsEmpty = coalition.every((participant) =>
      isZeroBytes(round.inputs.get(participant)!),
    );
    const matching = observer.components.filter((component) =>
      equalBytes(component.total, payload),
    );
    const otherComponentsAreZero = observer.components.every(
      (component) =>
        equalBytes(component.total, payload) || isZeroBytes(component.total),
    );
    const compatible =
      coalitionIsEmpty && matching.length === 1 && otherComponentsAreZero;
    const candidates = compatible ? [...matching[0]!.participants] : [];
    let posterior: readonly PosteriorEntry[] | null = null;
    if (options.priors !== undefined && compatible) {
      posterior = priorPreservingPosterior(
        honestParticipants,
        candidates,
        options.priors,
      );
    }
    exactOne = {
      payload,
      compatible,
      reason: !coalitionIsEmpty
        ? "coalition-input-is-nonzero"
        : compatible
          ? "compatible"
          : "no-single-compatible-component",
      candidates,
      posterior,
    };
  } else if (options.priors !== undefined) {
    throw new TypeError("priors require an exact-one payload");
  }

  return {
    coalition,
    honestParticipants,
    knownEdges,
    unknownEdges,
    knownMasks,
    residualBroadcasts: observer.residualBroadcasts,
    components: observer.components,
    exactOne,
  };
}

export interface LateDisclosureAnalysis {
  readonly disclosedEdges: readonly DcEdge[];
  readonly undisclosedEdges: readonly DcEdge[];
  readonly residualBroadcasts: BytesById;
  readonly components: readonly ComponentTotal[];
  readonly recoveredInputs: BytesById;
}

export function analyzeLateDisclosure(
  round: RoundResult,
  disclosedEdgeIds: readonly string[],
): LateDisclosureAnalysis {
  const disclosedSet = new Set(disclosedEdgeIds);
  if (disclosedSet.size !== disclosedEdgeIds.length) {
    throw new TypeError("disclosed edge identifiers must be unique");
  }
  validateKnownEdges(round, disclosedSet);
  const observer = observerComponents(round, disclosedSet, new Set());
  const recoveredInputs = new Map<ParticipantId, Uint8Array>();
  for (const component of observer.components) {
    if (component.participants.length === 1) {
      recoveredInputs.set(
        component.participants[0]!,
        copyBytes(component.total),
      );
    }
  }
  return {
    disclosedEdges: round.graph.edges.filter((edge) =>
      disclosedSet.has(edge.id),
    ),
    undisclosedEdges: round.graph.edges.filter(
      (edge) => !disclosedSet.has(edge.id),
    ),
    residualBroadcasts: observer.residualBroadcasts,
    components: observer.components,
    recoveredInputs,
  };
}

export function recoverInputsFromAllMasks(round: RoundResult): BytesById {
  const analysis = analyzeLateDisclosure(
    round,
    round.graph.edges.map((edge) => edge.id),
  );
  if (analysis.recoveredInputs.size !== round.graph.participants.length) {
    throw new Error(
      "internal error: complete disclosure did not recover every input",
    );
  }
  return analysis.recoveredInputs;
}

export type OneBitInput = 0 | 1;

export interface EnumerateOneBitViewOptions {
  readonly graph: RoundResult["graph"];
  readonly coalition: readonly ParticipantId[];
  readonly inputs: ReadonlyMap<ParticipantId, OneBitInput>;
  readonly maxEdges?: number;
}

export interface OneBitViewDistribution {
  readonly maskAssignmentCount: number;
  readonly frequencies: ReadonlyMap<string, number>;
}

function oneBitInputsToBytes(
  participants: readonly ParticipantId[],
  inputs: ReadonlyMap<ParticipantId, OneBitInput>,
): BytesById {
  for (const participant of inputs.keys()) {
    if (!participants.includes(participant)) {
      throw new TypeError(
        `one-bit inputs name unknown participant: ${participant}`,
      );
    }
  }
  return new Map(
    participants.map((participant) => {
      const input = inputs.get(participant);
      if (input !== 0 && input !== 1) {
        throw new TypeError(
          `missing or invalid one-bit input for ${participant}`,
        );
      }
      return [participant, Uint8Array.of(input)] as const;
    }),
  );
}

export function enumerateOneBitViewDistribution(
  options: EnumerateOneBitViewOptions,
): OneBitViewDistribution {
  const maxEdges = options.maxEdges ?? 16;
  if (!Number.isSafeInteger(maxEdges) || maxEdges < 0 || maxEdges > 20) {
    throw new RangeError("maxEdges must be an integer from 0 through 20");
  }
  if (options.graph.edges.length > maxEdges) {
    throw new RangeError(
      `bounded enumeration refuses ${options.graph.edges.length} edges (limit ${maxEdges})`,
    );
  }
  const coalitionSet = new Set(options.coalition);
  if (coalitionSet.size !== options.coalition.length) {
    throw new TypeError("coalition identifiers must be unique");
  }
  for (const participant of coalitionSet) {
    if (!options.graph.participants.includes(participant)) {
      throw new TypeError(
        `coalition names unknown participant: ${participant}`,
      );
    }
  }
  const byteInputs = oneBitInputsToBytes(
    options.graph.participants,
    options.inputs,
  );
  const knownEdges = options.graph.edges.filter(
    (edge) => coalitionSet.has(edge.left) || coalitionSet.has(edge.right),
  );
  const assignmentCount = 2 ** options.graph.edges.length;
  const frequencies = new Map<string, number>();

  for (let assignment = 0; assignment < assignmentCount; assignment += 1) {
    const edgeMasks = new Map(
      options.graph.edges.map(
        (edge, edgeIndex) =>
          [edge.id, Uint8Array.of((assignment >> edgeIndex) & 1)] as const,
      ),
    );
    const round = runRound({
      graph: options.graph,
      inputs: byteInputs,
      edgeMasks,
    });
    const publicBits = options.graph.participants
      .map((participant) => round.broadcasts.get(participant)![0]!)
      .join("");
    const knownMaskBits = knownEdges
      .map((edge) => round.edgeMasks.get(edge.id)![0]!)
      .join("");
    const coalitionInputBits = options.graph.participants
      .filter((participant) => coalitionSet.has(participant))
      .map((participant) => options.inputs.get(participant)!)
      .join("");
    const key = `b:${publicBits}|k:${knownMaskBits}|x:${coalitionInputBits}`;
    frequencies.set(key, (frequencies.get(key) ?? 0) + 1);
  }

  return { maskAssignmentCount: assignmentCount, frequencies };
}

export function sameViewDistribution(
  left: OneBitViewDistribution,
  right: OneBitViewDistribution,
): boolean {
  if (
    left.maskAssignmentCount !== right.maskAssignmentCount ||
    left.frequencies.size !== right.frequencies.size
  ) {
    return false;
  }
  for (const [view, count] of left.frequencies) {
    if (right.frequencies.get(view) !== count) return false;
  }
  return true;
}

export interface ExactOneCandidateEvidence {
  readonly candidates: readonly ParticipantId[];
  readonly distributions: ReadonlyMap<ParticipantId, OneBitViewDistribution>;
  readonly indistinguishable: ReadonlyMap<
    ParticipantId,
    readonly ParticipantId[]
  >;
}

export function enumerateExactOneCandidateEvidence(
  graph: RoundResult["graph"],
  coalition: readonly ParticipantId[],
  maxEdges = 16,
): ExactOneCandidateEvidence {
  const coalitionSet = new Set(coalition);
  if (coalitionSet.size !== coalition.length) {
    throw new TypeError("coalition identifiers must be unique");
  }
  for (const participant of coalitionSet) {
    if (!graph.participants.includes(participant)) {
      throw new TypeError(
        `coalition names unknown participant: ${participant}`,
      );
    }
  }
  const candidates = graph.participants.filter(
    (participant) => !coalitionSet.has(participant),
  );
  const distributions = new Map<ParticipantId, OneBitViewDistribution>();
  for (const candidate of candidates) {
    const inputs = new Map(
      graph.participants.map(
        (participant) =>
          [participant, participant === candidate ? 1 : 0] as const,
      ),
    );
    distributions.set(
      candidate,
      enumerateOneBitViewDistribution({
        graph,
        coalition,
        inputs,
        maxEdges,
      }),
    );
  }
  const indistinguishable = new Map<ParticipantId, readonly ParticipantId[]>();
  for (const candidate of candidates) {
    indistinguishable.set(
      candidate,
      candidates.filter((other) =>
        sameViewDistribution(
          distributions.get(candidate)!,
          distributions.get(other)!,
        ),
      ),
    );
  }
  return { candidates, distributions, indistinguishable };
}

export function componentTotalsFromInputs(
  components: readonly (readonly ParticipantId[])[],
  inputs: BytesById,
  width: number,
): readonly ComponentTotal[] {
  return components.map((participants) => ({
    participants,
    total:
      participants.length === 0
        ? zeroBytes(width)
        : xorBytes(
            ...participants.map((participant) => inputs.get(participant)!),
          ),
  }));
}

export function oneBitSingleSenderInputs(
  graph: RoundResult["graph"],
  sender: ParticipantId,
): BytesById {
  return makeSingleSenderInputs(graph, sender, Uint8Array.of(1));
}

export function viewDistributionSummary(
  distribution: OneBitViewDistribution,
): string {
  return [...distribution.frequencies.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([view, count]) => `${view}=${count}`)
    .join(";");
}

export function componentTotalHex(
  components: readonly ComponentTotal[],
): readonly string[] {
  return components.map((component) => bytesToHex(component.total));
}
