import {
  CommitRevealCoordinator,
  FIVE_CYCLE_GRAPH,
  FreshRoundGuard,
  aggregateContributions,
  analyzeCoalition as analyzeCoalitionCore,
  analyzeCollision,
  analyzeDropout,
  analyzeLateDisclosure,
  analyzeMaskReuse,
  analyzeShapedJam,
  createContributionCommitment,
  createGraph,
  enumerateExactOneCandidateEvidence,
  equalBytes,
  generateCommitmentNonce,
  hexToBytes,
  makeSingleSenderInputs,
  makeZeroInputs,
  reformGraphAfterDropout,
  runRound,
  sameViewDistribution,
  verifyContributionCommitment,
  type BytesById,
  type ContributionCommitmentOpening,
  type DcGraph,
  type ParticipantId as CoreParticipantId,
  type RoundResult,
} from "../dcnet/index.js";
import type {
  CoalitionEvidence,
  CommitmentEvidence,
  DcNetUiModel,
  DisruptionEvidence,
  ParticipantId,
  ReuseEvidence,
  RoundEvidence,
} from "./types";

const PARTICIPANTS = ["A", "B", "C", "D", "E"] as const;

const FIXTURE_MASKS: BytesById = new Map([
  ["AB", hexToBytes("3c")],
  ["BC", hexToBytes("a5")],
  ["CD", hexToBytes("7f")],
  ["DE", hexToBytes("11")],
  ["EA", hexToBytes("c2")],
]);

function uiParticipant(value: CoreParticipantId): ParticipantId {
  if (!PARTICIPANTS.includes(value as ParticipantId)) {
    throw new TypeError(`unexpected participant in UI scenario: ${value}`);
  }
  return value as ParticipantId;
}

function clone(value: Uint8Array): Uint8Array {
  return new Uint8Array(value);
}

function fixtureCoreRound(): RoundResult {
  return runRound({
    graph: FIVE_CYCLE_GRAPH,
    inputs: makeSingleSenderInputs(FIVE_CYCLE_GRAPH, "D", hexToBytes("48")),
    edgeMasks: FIXTURE_MASKS,
    roundId: "checked-round-48",
  });
}

function toRoundEvidence(round: RoundResult): RoundEvidence {
  return {
    roundId: round.roundId,
    graph: {
      participants: round.graph.participants.map(uiParticipant),
      edges: round.graph.edges.map((edge) => ({
        id: edge.id,
        left: uiParticipant(edge.left),
        right: uiParticipant(edge.right),
      })),
    },
    width: round.width,
    edges: round.graph.edges.map((edge) => ({
      id: edge.id,
      left: uiParticipant(edge.left),
      right: uiParticipant(edge.right),
      mask: clone(round.edgeMasks.get(edge.id)!),
    })),
    participants: round.graph.participants.map((participant) => {
      const contribution = round.contributions.find(
        (candidate) => candidate.participant === participant,
      );
      if (!contribution)
        throw new Error(`missing contribution for ${participant}`);
      return {
        id: uiParticipant(participant),
        input: clone(round.inputs.get(participant)!),
        incidentEdgeIds: [...contribution.incidentEdges],
        broadcast: clone(round.broadcasts.get(participant)!),
      };
    }),
    aggregate: clone(round.aggregate),
  };
}

function toCoreRound(evidence: RoundEvidence): RoundResult {
  const graph = createGraph(
    evidence.graph.participants,
    evidence.graph.edges.map((edge) => ({ ...edge })),
  );
  return runRound({
    graph,
    roundId: evidence.roundId,
    inputs: new Map(
      evidence.participants.map((participant) => [
        participant.id,
        clone(participant.input),
      ]),
    ),
    edgeMasks: new Map(
      evidence.edges.map((edge) => [edge.id, clone(edge.mask)]),
    ),
  });
}

function priorDenominator(
  candidates: readonly ParticipantId[],
  priors: Readonly<Record<ParticipantId, bigint>>,
): bigint {
  return candidates.reduce((sum, candidate) => sum + priors[candidate], 0n);
}

function coalitionEvidence(
  roundEvidence: RoundEvidence,
  coalition: readonly ParticipantId[],
  priors: Readonly<Record<ParticipantId, bigint>>,
): CoalitionEvidence {
  const round = toCoreRound(roundEvidence);
  const coalitionSet = new Set<CoreParticipantId>(coalition);
  const numericPriors = new Map<CoreParticipantId, number>();
  for (const participant of round.graph.participants) {
    if (coalitionSet.has(participant)) continue;
    const weight = priors[uiParticipant(participant)];
    if (weight < 0n || weight > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new RangeError(
        `prior for ${participant} is outside the safe UI range`,
      );
    }
    numericPriors.set(participant, Number(weight));
  }
  const result = analyzeCoalitionCore({
    round,
    coalition,
    exactOnePayload: round.aggregate,
    priors: numericPriors,
  });
  if (!result.exactOne?.compatible || !result.exactOne.posterior) {
    throw new Error(
      "checked one-sender fixture became incompatible with its observer view",
    );
  }
  const candidateSet = new Set(result.exactOne.candidates);
  const candidates = round.graph.participants
    .filter((participant) => candidateSet.has(participant))
    .map(uiParticipant);
  const denominator = priorDenominator(candidates, priors);
  if (denominator === 0n)
    throw new RangeError("candidate priors need positive mass");

  const enumerated = enumerateExactOneCandidateEvidence(round.graph, coalition);
  const exhaustiveAgreement = candidates.every((left) =>
    candidates.every((right) =>
      sameViewDistribution(
        enumerated.distributions.get(left)!,
        enumerated.distributions.get(right)!,
      ),
    ),
  );
  const firstDistribution = enumerated.distributions.get(candidates[0]!);

  return {
    coalition: result.coalition.map(uiParticipant),
    knownEdgeIds: result.knownEdges.map((edge) => edge.id),
    honestComponents: result.components.map((component) => ({
      members: round.graph.participants
        .filter((participant) => component.participants.includes(participant))
        .map(uiParticipant),
      aggregate: clone(component.total),
    })),
    candidates,
    posterior: candidates.map((participant) => ({
      participant,
      priorWeight: priors[participant],
      posteriorNumerator: priors[participant],
      posteriorDenominator: denominator,
    })),
    enumeratedWorlds: firstDistribution?.maskAssignmentCount ?? 0,
    exhaustiveAgreement,
  };
}

function oneBitRound(senderCount: 0 | 1 | 2 | 3): RoundResult {
  const selected = new Set<CoreParticipantId>(
    PARTICIPANTS.slice(0, senderCount),
  );
  const inputs = new Map(
    FIVE_CYCLE_GRAPH.participants.map(
      (participant) =>
        [
          participant,
          Uint8Array.of(selected.has(participant) ? 1 : 0),
        ] as const,
    ),
  );
  return runRound({
    graph: FIVE_CYCLE_GRAPH,
    roundId: `collision-${senderCount}`,
    inputs,
    edgeMasks: new Map([
      ["AB", Uint8Array.of(0)],
      ["BC", Uint8Array.of(1)],
      ["CD", Uint8Array.of(1)],
      ["DE", Uint8Array.of(0)],
      ["EA", Uint8Array.of(1)],
    ]),
  });
}

function byteCollision(
  left: number,
  right: number,
): { left: Uint8Array; right: Uint8Array; aggregate: Uint8Array } {
  const inputs = new Map<CoreParticipantId, Uint8Array>(
    FIVE_CYCLE_GRAPH.participants.map((participant) => [
      participant,
      Uint8Array.of(
        participant === "A" ? left : participant === "B" ? right : 0,
      ),
    ]),
  );
  const result = analyzeCollision(inputs);
  return {
    left: clone(inputs.get("A")!),
    right: clone(inputs.get("B")!),
    aggregate: clone(result.aggregate),
  };
}

function disruptionEvidence(): DisruptionEvidence {
  const round = fixtureCoreRound();
  const malformedContributions = round.contributions.map((contribution) => ({
    participant: contribution.participant,
    broadcast:
      contribution.participant === "B"
        ? Uint8Array.of(contribution.broadcast[0]!, 0)
        : contribution.broadcast,
  }));
  const malformed = aggregateContributions({
    graph: round.graph,
    width: round.width,
    contributions: malformedContributions,
  });
  if (malformed.status !== "malformed") {
    throw new Error("wrong-width fixture was not rejected as malformed");
  }

  const jam = analyzeShapedJam(round, "B", Uint8Array.of(0xff));
  const dropout = analyzeDropout(round, ["C"]);
  const reformed = reformGraphAfterDropout(round.graph, ["C"]);
  if (!reformed.connected)
    throw new Error("dropout fixture did not leave a connected graph");
  const reformedRound = runRound({
    graph: reformed.graph,
    roundId: "reformed-without-C",
    inputs: makeSingleSenderInputs(reformed.graph, "D", hexToBytes("48")),
    edgeMasks: new Map([
      ["AB", hexToBytes("94")],
      ["DE", hexToBytes("6b")],
      ["EA", hexToBytes("27")],
    ]),
  });

  return {
    honestAggregate: clone(round.aggregate),
    malformed: {
      status: "malformed",
      reason: malformed.issues
        .map((issue) =>
          issue.kind === "wrong-width"
            ? `${issue.participant} supplied ${issue.actual} bytes; expected ${issue.expected}.`
            : `${issue.kind}: ${issue.participant}.`,
        )
        .join(" "),
    },
    shapedJammer: {
      status: "ok",
      reason:
        "The replacement is exactly one byte and passes structural aggregation.",
      aggregate: clone(jam.jammedAggregate),
      participant: uiParticipant(jam.participant),
      changedAggregate: !equalBytes(jam.honestAggregate, jam.jammedAggregate),
    },
    dropout: {
      status: "missing",
      reason: `${dropout.missingParticipants.join(", ")} supplied no contribution; its boundary masks would remain once.`,
      participant: uiParticipant(dropout.missingParticipants[0]!),
      substitutedZero: false,
      partialAggregate: clone(dropout.partialAggregate),
      presentInputXor: clone(dropout.presentInputXor),
      boundaryEdgeIds: dropout.boundaryEdges.map((edge) => edge.id),
      boundaryMaskXor: clone(dropout.boundaryMaskXor),
      expectedPartialAggregate: clone(dropout.expectedPartialAggregate),
      boundaryEquationHolds: dropout.boundaryEquationHolds,
    },
    reformedRound: toRoundEvidence(reformedRound),
    reformedMasks: reformedRound.graph.edges.map((edge) => {
      const previousMask = round.edgeMasks.get(edge.id);
      if (!previousMask) {
        throw new Error(
          `reformed edge ${edge.id} has no prior-round comparison`,
        );
      }
      const newMask = reformedRound.edgeMasks.get(edge.id)!;
      return {
        edgeId: edge.id,
        previousMask: clone(previousMask),
        newMask: clone(newMask),
        different: !equalBytes(previousMask, newMask),
      };
    }),
    reformedMasksReplaced: reformedRound.graph.edges.every(
      (edge) =>
        !equalBytes(
          round.edgeMasks.get(edge.id)!,
          reformedRound.edgeMasks.get(edge.id)!,
        ),
    ),
  };
}

interface OpeningSet {
  readonly openings: ReadonlyMap<
    CoreParticipantId,
    ContributionCommitmentOpening
  >;
  readonly commitments: ReadonlyMap<CoreParticipantId, Uint8Array>;
}

async function createOpeningSet(
  round: RoundResult,
  overrides: ReadonlyMap<CoreParticipantId, Uint8Array> = new Map(),
): Promise<OpeningSet> {
  const openings = new Map<CoreParticipantId, ContributionCommitmentOpening>();
  for (const participant of round.graph.participants) {
    openings.set(participant, {
      sessionId: "dcnet-browser-session",
      roundId: round.roundId,
      graph: round.graph,
      participant,
      contribution: clone(
        overrides.get(participant) ?? round.broadcasts.get(participant)!,
      ),
      nonce: generateCommitmentNonce(),
    });
  }
  const commitments = new Map<CoreParticipantId, Uint8Array>();
  await Promise.all(
    [...openings].map(async ([participant, opening]) => {
      commitments.set(participant, await createContributionCommitment(opening));
    }),
  );
  return { openings, commitments };
}

function prepareCoordinator(
  round: RoundResult,
  set: OpeningSet,
): CommitRevealCoordinator {
  const coordinator = new CommitRevealCoordinator({
    graph: round.graph,
    sessionId: "dcnet-browser-session",
    roundId: round.roundId,
    width: round.width,
  });
  for (const participant of round.graph.participants) {
    const action = coordinator.submitCommitment(
      participant,
      set.commitments.get(participant)!,
    );
    if (!action.accepted)
      throw new Error(`commitment for ${participant} was refused`);
  }
  const transition = coordinator.beginReveal();
  if (transition.status !== "ready")
    throw new Error("complete commitments did not open reveal");
  return coordinator;
}

async function submitOpenings(
  coordinator: CommitRevealCoordinator,
  round: RoundResult,
  set: OpeningSet,
  excluded: ReadonlySet<CoreParticipantId> = new Set(),
): Promise<boolean> {
  for (const participant of round.graph.participants) {
    if (excluded.has(participant)) continue;
    const opening = set.openings.get(participant)!;
    const action = await coordinator.submitReveal(
      participant,
      opening.contribution,
      opening.nonce,
    );
    if (!action.accepted) return false;
  }
  return true;
}

function changedGraph(): DcGraph {
  return createGraph(PARTICIPANTS, [
    { id: "AB-v2", left: "A", right: "B" },
    { id: "BC", left: "B", right: "C" },
    { id: "CD", left: "C", right: "D" },
    { id: "DE", left: "D", right: "E" },
    { id: "EA", left: "E", right: "A" },
  ]);
}

function changedMembership(): DcGraph {
  return createGraph(
    ["E", "D", "C", "B", "A"],
    [
      { id: "AB", left: "A", right: "B" },
      { id: "BC", left: "B", right: "C" },
      { id: "CD", left: "C", right: "D" },
      { id: "DE", left: "D", right: "E" },
      { id: "EA", left: "E", right: "A" },
    ],
  );
}

async function commitmentEvidence(): Promise<CommitmentEvidence> {
  const round = fixtureCoreRound();
  const honestSet = await createOpeningSet(round);
  const target = honestSet.openings.get("D")!;
  const commitment = honestSet.commitments.get("D")!;
  const honestRevealAccepted = await verifyContributionCommitment(
    commitment,
    target,
  );

  const changedContribution = clone(target.contribution);
  changedContribution[0] ^= 1;
  const changedNonce = clone(target.nonce);
  changedNonce[0] ^= 1;
  const changes: ReadonlyArray<
    readonly [string, ContributionCommitmentOpening]
  > = [
    ["contribution", { ...target, contribution: changedContribution }],
    ["nonce", { ...target, nonce: changedNonce }],
    ["participant", { ...target, participant: "C" }],
    ["key graph", { ...target, graph: changedGraph() }],
    ["membership", { ...target, graph: changedMembership(), participant: "D" }],
    ["round identifier", { ...target, roundId: `${target.roundId}-changed` }],
    [
      "session identifier",
      { ...target, sessionId: `${target.sessionId}-changed` },
    ],
    [
      "contribution length",
      { ...target, contribution: Uint8Array.of(target.contribution[0]!, 0) },
    ],
  ];
  const rejectedContextChanges: string[] = [];
  for (const [label, opening] of changes) {
    if (!(await verifyContributionCommitment(commitment, opening))) {
      rejectedContextChanges.push(label);
    }
  }

  const changedCoordinator = prepareCoordinator(round, honestSet);
  const changedAction = await changedCoordinator.submitReveal(
    "D",
    changedContribution,
    target.nonce,
  );
  const changedRevealRejected = !changedAction.accepted;

  const honestCoordinator = prepareCoordinator(round, honestSet);
  const honestSubmitted = await submitOpenings(
    honestCoordinator,
    round,
    honestSet,
  );
  const honestFinal = honestCoordinator.finalize();

  const jammedBroadcast = new Map<CoreParticipantId, Uint8Array>([
    ["B", Uint8Array.of(0xff)],
  ]);
  const jamSet = await createOpeningSet(round, jammedBroadcast);
  const jamCoordinator = prepareCoordinator(round, jamSet);
  const jamSubmitted = await submitOpenings(jamCoordinator, round, jamSet);
  const jamFinal = jamCoordinator.finalize();
  const precommittedJamAccepted =
    jamSubmitted &&
    jamFinal.status === "ok" &&
    !equalBytes(jamFinal.aggregate, round.aggregate);

  const withheldCoordinator = prepareCoordinator(round, honestSet);
  const revealsAccepted = await submitOpenings(
    withheldCoordinator,
    round,
    honestSet,
    new Set(["E"]),
  );
  const withheldFinal = withheldCoordinator.finalize();
  const withholdingAborted =
    revealsAccepted &&
    withheldFinal.status === "aborted" &&
    withheldFinal.reason === "missing-reveals" &&
    withheldFinal.missing.includes("E");

  return {
    participant: "D",
    commitment: clone(commitment),
    honestRevealAccepted:
      honestRevealAccepted && honestSubmitted && honestFinal.status === "ok",
    changedRevealRejected,
    rejectedContextChanges,
    precommittedJamAccepted,
    withholdingAborted,
    boundFields: [
      "versioned domain separator",
      "session identifier",
      "round identifier",
      "ordered membership",
      "canonical undirected key graph",
      "participant identifier",
      "contribution length and bytes",
      "fresh 32-byte nonce",
    ],
  };
}

function reuseEvidence(): ReuseEvidence {
  const first = runRound({
    graph: FIVE_CYCLE_GRAPH,
    roundId: "known-empty-round",
    inputs: makeZeroInputs(FIVE_CYCLE_GRAPH, 1),
    edgeMasks: FIXTURE_MASKS,
  });
  const secondInputs: BytesById = new Map([
    ["A", hexToBytes("10")],
    ["B", hexToBytes("20")],
    ["C", hexToBytes("30")],
    ["D", hexToBytes("48")],
    ["E", hexToBytes("50")],
  ]);
  const second = runRound({
    graph: FIVE_CYCLE_GRAPH,
    roundId: "unsafe-reused-mask-round",
    inputs: secondInputs,
    edgeMasks: FIXTURE_MASKS,
  });
  const reuse = analyzeMaskReuse(first, second);
  if (!reuse.recoveredSecondInputs) {
    throw new Error(
      "known-empty repeated-mask fixture did not recover second inputs",
    );
  }
  const distinctControl = runRound({
    graph: FIVE_CYCLE_GRAPH,
    roundId: "distinct-mask-deterministic-control",
    inputs: secondInputs,
    edgeMasks: new Map([
      ["AB", hexToBytes("01")],
      ["BC", hexToBytes("02")],
      ["CD", hexToBytes("04")],
      ["DE", hexToBytes("08")],
      ["EA", hexToBytes("10")],
    ]),
  });
  const distinctAnalysis = analyzeMaskReuse(first, distinctControl);
  const distinctControlRetainsReuseIdentity = [
    ...distinctAnalysis.perParticipantLeakEquation.values(),
  ].every(Boolean);

  const disclosureRound = fixtureCoreRound();
  const disclosure = analyzeLateDisclosure(disclosureRound, ["CD", "DE"]);
  const recovered = disclosure.recoveredInputs.get("D");
  if (!recovered)
    throw new Error("full incident-mask disclosure did not isolate D");

  return {
    firstRound: toRoundEvidence(first),
    secondRound: toRoundEvidence(second),
    rows: FIVE_CYCLE_GRAPH.participants.map((participant) => ({
      participant: uiParticipant(participant),
      firstBroadcast: clone(first.broadcasts.get(participant)!),
      secondBroadcast: clone(second.broadcasts.get(participant)!),
      broadcastXor: clone(reuse.broadcastDifferences.get(participant)!),
      firstInput: clone(first.inputs.get(participant)!),
      secondInput: clone(second.inputs.get(participant)!),
      inputXor: clone(reuse.inputDifferences.get(participant)!),
      equal: reuse.perParticipantLeakEquation.get(participant) ?? false,
      recoveredFromKnownEmpty: clone(
        reuse.recoveredSecondInputs!.get(participant)!,
      ),
    })),
    everyInputRecovered: FIVE_CYCLE_GRAPH.participants.every((participant) =>
      equalBytes(
        reuse.recoveredSecondInputs!.get(participant)!,
        second.inputs.get(participant)!,
      ),
    ),
    distinctControlRows: FIVE_CYCLE_GRAPH.participants.map((participant) => ({
      participant: uiParticipant(participant),
      firstBroadcast: clone(first.broadcasts.get(participant)!),
      controlBroadcast: clone(distinctControl.broadcasts.get(participant)!),
      broadcastXor: clone(
        distinctAnalysis.broadcastDifferences.get(participant)!,
      ),
      firstInput: clone(first.inputs.get(participant)!),
      controlInput: clone(distinctControl.inputs.get(participant)!),
      inputXor: clone(distinctAnalysis.inputDifferences.get(participant)!),
      equal:
        distinctAnalysis.perParticipantLeakEquation.get(participant) ?? false,
    })),
    distinctControlRetainsReuseIdentity,
    disclosure: {
      participant: "D",
      broadcast: clone(disclosureRound.broadcasts.get("D")!),
      disclosedEdgeIds: disclosure.disclosedEdges.map((edge) => edge.id),
      disclosedMasks: disclosure.disclosedEdges.map((edge) => ({
        edgeId: edge.id,
        mask: clone(disclosureRound.edgeMasks.get(edge.id)!),
      })),
      recoveredInput: clone(recovered),
      actualInput: clone(disclosureRound.inputs.get("D")!),
    },
  };
}

export function createUiModel(): DcNetUiModel {
  let freshCounter = 0;
  const freshRounds = new FreshRoundGuard(FIVE_CYCLE_GRAPH);
  return {
    fixtureRound: () => toRoundEvidence(fixtureCoreRound()),
    freshRound: (sender, message) => {
      freshCounter += 1;
      return toRoundEvidence(
        freshRounds.run({
          inputs: makeSingleSenderInputs(FIVE_CYCLE_GRAPH, sender, message),
          roundId: `fresh-browser-round-${freshCounter}`,
        }),
      );
    },
    analyzeCoalition: coalitionEvidence,
    collision: (senderCount) => {
      const round = oneBitRound(senderCount);
      const analysis = analyzeCollision(round.inputs);
      if (analysis.oneBitParity === null) {
        throw new Error("one-bit collision fixture did not produce a parity");
      }
      const identical = byteCollision(0x33, 0x33);
      const plausible = byteCollision(0x01, 0x02);
      return {
        senderCount,
        senderIds: analysis.senderIds.map(uiParticipant),
        round: toRoundEvidence(round),
        parity: analysis.oneBitParity,
        byteExamples: [
          { kind: "identical-cancel", ...identical },
          { kind: "plausible-byte", ...plausible },
        ],
      };
    },
    disruption: disruptionEvidence,
    commitments: commitmentEvidence,
    reuse: reuseEvidence,
  };
}
