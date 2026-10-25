export type ParticipantId = "A" | "B" | "C" | "D" | "E";

export type ResultKind = "pass" | "reject" | "alarm" | "info";

export interface EdgeEvidence {
  id: string;
  left: ParticipantId;
  right: ParticipantId;
  mask: Uint8Array;
}

export interface ParticipantEvidence {
  id: ParticipantId;
  input: Uint8Array;
  incidentEdgeIds: readonly string[];
  broadcast: Uint8Array;
}

export interface GraphEvidence {
  participants: readonly ParticipantId[];
  edges: readonly Pick<EdgeEvidence, "id" | "left" | "right">[];
}

export interface RoundEvidence {
  roundId: string;
  graph: GraphEvidence;
  width: number;
  edges: readonly EdgeEvidence[];
  participants: readonly ParticipantEvidence[];
  aggregate: Uint8Array;
}

export interface ComponentEvidence {
  members: readonly ParticipantId[];
  aggregate: Uint8Array;
}

export interface PosteriorEvidence {
  participant: ParticipantId;
  priorWeight: bigint;
  posteriorNumerator: bigint;
  posteriorDenominator: bigint;
}

export interface CoalitionEvidence {
  coalition: readonly ParticipantId[];
  knownEdgeIds: readonly string[];
  honestComponents: readonly ComponentEvidence[];
  candidates: readonly ParticipantId[];
  posterior: readonly PosteriorEvidence[];
  enumeratedWorlds: number;
  exhaustiveAgreement: boolean;
}

export interface CollisionEvidence {
  senderCount: 0 | 1 | 2 | 3;
  senderIds: readonly ParticipantId[];
  round: RoundEvidence;
  parity: 0 | 1;
  byteExamples: readonly CollisionByteExample[];
}

export interface CollisionByteExample {
  kind: "identical-cancel" | "plausible-byte";
  left: Uint8Array;
  right: Uint8Array;
  aggregate: Uint8Array;
}

export interface ContributionCaseEvidence {
  status: "ok" | "malformed" | "missing";
  reason: string;
  aggregate?: Uint8Array;
}

export interface DisruptionEvidence {
  honestAggregate: Uint8Array;
  malformed: ContributionCaseEvidence;
  shapedJammer: ContributionCaseEvidence & {
    participant: ParticipantId;
    changedAggregate: boolean;
  };
  dropout: ContributionCaseEvidence & {
    participant: ParticipantId;
    substitutedZero: boolean;
    partialAggregate: Uint8Array;
    presentInputXor: Uint8Array;
    boundaryEdgeIds: readonly string[];
    boundaryMaskXor: Uint8Array;
    expectedPartialAggregate: Uint8Array;
    boundaryEquationHolds: boolean;
  };
  reformedRound: RoundEvidence;
  reformedMasks: readonly ReformedMaskEvidence[];
  reformedMasksReplaced: boolean;
}

export interface ReformedMaskEvidence {
  edgeId: string;
  previousMask: Uint8Array;
  newMask: Uint8Array;
  different: boolean;
}

export interface CommitmentEvidence {
  participant: ParticipantId;
  commitment: Uint8Array;
  honestRevealAccepted: boolean;
  changedRevealRejected: boolean;
  rejectedContextChanges: readonly string[];
  precommittedJamAccepted: boolean;
  withholdingAborted: boolean;
  boundFields: readonly string[];
}

export interface ReuseRowEvidence {
  participant: ParticipantId;
  firstBroadcast: Uint8Array;
  secondBroadcast: Uint8Array;
  broadcastXor: Uint8Array;
  firstInput: Uint8Array;
  secondInput: Uint8Array;
  inputXor: Uint8Array;
  equal: boolean;
  recoveredFromKnownEmpty: Uint8Array;
}

export interface DisclosureEvidence {
  participant: ParticipantId;
  broadcast: Uint8Array;
  disclosedEdgeIds: readonly string[];
  disclosedMasks: readonly {
    edgeId: string;
    mask: Uint8Array;
  }[];
  recoveredInput: Uint8Array;
  actualInput: Uint8Array;
}

export interface ReuseEvidence {
  firstRound: RoundEvidence;
  secondRound: RoundEvidence;
  rows: readonly ReuseRowEvidence[];
  everyInputRecovered: boolean;
  distinctControlRows: readonly DistinctControlRowEvidence[];
  distinctControlRetainsReuseIdentity: boolean;
  disclosure: DisclosureEvidence;
}

export interface DistinctControlRowEvidence {
  participant: ParticipantId;
  firstBroadcast: Uint8Array;
  controlBroadcast: Uint8Array;
  broadcastXor: Uint8Array;
  firstInput: Uint8Array;
  controlInput: Uint8Array;
  inputXor: Uint8Array;
  equal: boolean;
}

export interface DcNetUiModel {
  fixtureRound(): RoundEvidence;
  freshRound(sender: ParticipantId, message: Uint8Array): RoundEvidence;
  analyzeCoalition(
    round: RoundEvidence,
    coalition: readonly ParticipantId[],
    priors: Readonly<Record<ParticipantId, bigint>>,
  ): CoalitionEvidence;
  collision(senderCount: 0 | 1 | 2 | 3): CollisionEvidence;
  disruption(): DisruptionEvidence;
  commitments(): Promise<CommitmentEvidence>;
  reuse(): ReuseEvidence;
}
