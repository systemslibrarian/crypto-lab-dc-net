/// <reference types="node" />

import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  COMMITMENT_DIGEST_BYTES,
  COMMITMENT_NONCE_BYTES,
  FIVE_CYCLE_GRAPH,
  CommitRevealCoordinator,
  bytesToHex,
  canonicalCommitmentPayload,
  createContributionCommitment,
  createGraph,
  generateCommitmentNonce,
  hexToBytes,
  makeSingleSenderInputs,
  runRound,
  verifyContributionCommitment,
  type ContributionCommitmentOpening,
  type DcGraph,
  type ParticipantId,
  type PublicContribution,
} from "./index.js";

const SESSION_ID = "classroom-session";
const ROUND_ID = "round-7";

function fixtureRound() {
  return runRound({
    graph: FIVE_CYCLE_GRAPH,
    roundId: ROUND_ID,
    inputs: makeSingleSenderInputs(FIVE_CYCLE_GRAPH, "D", hexToBytes("48")),
    edgeMasks: new Map([
      ["AB", hexToBytes("3c")],
      ["BC", hexToBytes("a5")],
      ["CD", hexToBytes("7f")],
      ["DE", hexToBytes("11")],
      ["EA", hexToBytes("c2")],
    ]),
  });
}

function nonce(fill: number): Uint8Array {
  return new Uint8Array(COMMITMENT_NONCE_BYTES).fill(fill);
}

function opening(
  participant: ParticipantId = "D",
  contribution = hexToBytes("26"),
  changes: Partial<ContributionCommitmentOpening> = {},
): ContributionCommitmentOpening {
  return {
    sessionId: SESSION_ID,
    roundId: ROUND_ID,
    graph: FIVE_CYCLE_GRAPH,
    participant,
    contribution,
    nonce: nonce(0x5a),
    ...changes,
  };
}

function uint32(value: number): Buffer {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32BE(value);
  return bytes;
}

function frame(value: string | Uint8Array): Buffer {
  const bytes =
    typeof value === "string" ? Buffer.from(value, "utf8") : Buffer.from(value);
  return Buffer.concat([uint32(bytes.length), bytes]);
}

function independentFixturePayload(): Buffer {
  const parts: Buffer[] = [
    frame("crypto-lab-dc-net/contribution-commitment/v1"),
    frame(SESSION_ID),
    frame(ROUND_ID),
    uint32(5),
    ...["A", "B", "C", "D", "E"].map(frame),
    uint32(5),
  ];
  for (const [id, left, right] of [
    ["AB", "A", "B"],
    ["BC", "B", "C"],
    ["CD", "C", "D"],
    ["DE", "D", "E"],
    ["EA", "A", "E"],
  ]) {
    parts.push(frame(id!), frame(left!), frame(right!));
  }
  parts.push(frame("D"), frame(hexToBytes("26")), frame(nonce(0x5a)));
  return Buffer.concat(parts);
}

function reorderedEdgeGraph(): DcGraph {
  return createGraph(
    FIVE_CYCLE_GRAPH.participants,
    [...FIVE_CYCLE_GRAPH.edges]
      .reverse()
      .map((edge) => ({ id: edge.id, left: edge.right, right: edge.left })),
  );
}

function reorderedMembershipGraph(): DcGraph {
  return createGraph(["B", "A", "C", "D", "E"], FIVE_CYCLE_GRAPH.edges);
}

async function commitmentsFor(
  contributions: readonly PublicContribution[],
  graph: DcGraph = FIVE_CYCLE_GRAPH,
) {
  const openings = new Map<ParticipantId, ContributionCommitmentOpening>();
  const commitments = new Map<ParticipantId, Uint8Array>();
  for (const [index, contribution] of contributions.entries()) {
    const item = opening(contribution.participant, contribution.broadcast, {
      graph,
      nonce: nonce(index + 1),
    });
    openings.set(contribution.participant, item);
    commitments.set(
      contribution.participant,
      await createContributionCommitment(item),
    );
  }
  return { openings, commitments };
}

function coordinator(
  graph: DcGraph = FIVE_CYCLE_GRAPH,
): CommitRevealCoordinator {
  return new CommitRevealCoordinator({
    graph,
    sessionId: SESSION_ID,
    roundId: ROUND_ID,
    width: 1,
  });
}

describe("canonical contribution commitment", () => {
  it("matches an independently framed Node SHA-256 reference", async () => {
    const expectedPayload = independentFixturePayload();
    const actualPayload = canonicalCommitmentPayload(opening());
    expect(Buffer.from(actualPayload).equals(expectedPayload)).toBe(true);

    const independentDigest = createHash("sha256")
      .update(expectedPayload)
      .digest("hex");
    const webCryptoDigest = bytesToHex(
      await createContributionCommitment(opening()),
    );
    expect(webCryptoDigest).toBe(independentDigest);
    expect(webCryptoDigest).toHaveLength(COMMITMENT_DIGEST_BYTES * 2);
  });

  it("canonicalizes edge order and orientation but binds ordered membership", async () => {
    const commitment = await createContributionCommitment(opening());
    expect(
      await verifyContributionCommitment(
        commitment,
        opening("D", hexToBytes("26"), { graph: reorderedEdgeGraph() }),
      ),
    ).toBe(true);
    expect(
      await verifyContributionCommitment(
        commitment,
        opening("D", hexToBytes("26"), { graph: reorderedMembershipGraph() }),
      ),
    ).toBe(false);
  });

  it("binds every session, round, graph, participant, contribution, length, and nonce field", async () => {
    const base = opening();
    const commitment = await createContributionCommitment(base);
    const changedGraph = createGraph(FIVE_CYCLE_GRAPH.participants, [
      ...FIVE_CYCLE_GRAPH.edges.slice(0, -1),
      { id: "AE", left: "E", right: "A" },
    ]);
    const variants: ContributionCommitmentOpening[] = [
      opening("D", hexToBytes("26"), { sessionId: "other-session" }),
      opening("D", hexToBytes("26"), { roundId: "round-8" }),
      opening("D", hexToBytes("26"), { graph: changedGraph }),
      opening("C", hexToBytes("26")),
      opening("D", hexToBytes("27")),
      opening("D", hexToBytes("0026")),
      opening("D", hexToBytes("26"), { nonce: nonce(0x5b) }),
    ];
    for (const variant of variants) {
      expect(await verifyContributionCommitment(commitment, variant)).toBe(
        false,
      );
    }
    expect(await verifyContributionCommitment(commitment, base)).toBe(true);
  });

  it("requires a nonempty contribution and exactly 32 nonce bytes", async () => {
    expect(() =>
      canonicalCommitmentPayload(opening("D", new Uint8Array())),
    ).toThrow(/non-empty/);
    expect(() =>
      canonicalCommitmentPayload(
        opening("D", hexToBytes("26"), { nonce: nonce(0).slice(1) }),
      ),
    ).toThrow(/exactly 32/);
    expect(
      await verifyContributionCommitment(
        new Uint8Array(COMMITMENT_DIGEST_BYTES),
        opening("D", hexToBytes("26"), { nonce: nonce(0).slice(1) }),
      ),
    ).toBe(false);
    expect(
      await verifyContributionCommitment(
        new Uint8Array(COMMITMENT_DIGEST_BYTES - 1),
        opening(),
      ),
    ).toBe(false);

    expect(
      bytesToHex(
        generateCommitmentNonce((length) => new Uint8Array(length).fill(0xa5)),
      ),
    ).toBe("a5".repeat(32));
    expect(() => generateCommitmentNonce(() => new Uint8Array(31))).toThrow(
      /exactly 32/,
    );

    expect(() => canonicalCommitmentPayload(opening("Z"))).toThrow(
      /not in the graph/,
    );
    expect(() =>
      canonicalCommitmentPayload(
        opening("D", hexToBytes("26"), { sessionId: "" }),
      ),
    ).toThrow(/must not be empty/);
    expect(() =>
      canonicalCommitmentPayload(
        opening("D", hexToBytes("26"), { roundId: "\ud800" }),
      ),
    ).toThrow(/well-formed Unicode/);
    expect(() =>
      canonicalCommitmentPayload(
        opening("D", hexToBytes("26"), { roundId: "\udc00" }),
      ),
    ).toThrow(/well-formed Unicode/);
    expect(
      canonicalCommitmentPayload(
        opening("D", hexToBytes("26"), { roundId: "😀" }),
      ),
    ).not.toHaveLength(0);

    const prefixIds = createGraph(
      ["A", "B", "C"],
      [
        { id: "e", left: "A", right: "B" },
        { id: "edge", left: "B", right: "C" },
      ],
    );
    expect(
      canonicalCommitmentPayload(
        opening("A", hexToBytes("00"), { graph: prefixIds }),
      ).length,
    ).toBeGreaterThan(0);
  });
});

describe("commit-before-reveal coordinator", () => {
  it("completes the checked transcript and returns defensive copies", async () => {
    const round = fixtureRound();
    const { openings, commitments } = await commitmentsFor(round.contributions);
    const protocol = coordinator();
    expect(protocol.phase).toBe("commit");
    for (const participant of FIVE_CYCLE_GRAPH.participants) {
      const digest = commitments.get(participant)!;
      expect(protocol.submitCommitment(participant, digest)).toEqual({
        accepted: true,
      });
      digest.fill(0);
    }
    const commitmentSnapshot = protocol.commitments.get("A")!;
    commitmentSnapshot.fill(0);
    expect(bytesToHex(protocol.commitments.get("A")!)).not.toBe(
      "00".repeat(32),
    );
    expect(protocol.beginReveal()).toEqual({ status: "ready" });
    expect(protocol.phase).toBe("reveal");
    expect(protocol.beginReveal()).toEqual({ status: "ready" });
    expect(protocol.submitCommitment("A", commitments.get("A")!)).toEqual({
      accepted: false,
      reason: "phase-closed",
    });

    for (const participant of FIVE_CYCLE_GRAPH.participants) {
      const item = openings.get(participant)!;
      const contribution = new Uint8Array(item.contribution);
      const openingNonce = new Uint8Array(item.nonce);
      const pending = protocol.submitReveal(
        participant,
        contribution,
        openingNonce,
      );
      contribution.fill(0xff);
      openingNonce.fill(0xff);
      expect(await pending).toEqual({ accepted: true });
    }
    const revealSnapshot = protocol.reveals.get("D")!;
    revealSnapshot.fill(0);
    expect(bytesToHex(protocol.reveals.get("D")!)).toBe("26");

    const result = protocol.finalize();
    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("expected completed protocol");
    expect(bytesToHex(result.aggregate)).toBe("48");
    result.aggregate.fill(0);
    result.contributions[0]!.broadcast.fill(0);
    const repeated = protocol.finalize();
    expect(repeated.status).toBe("ok");
    if (repeated.status === "ok") {
      expect(bytesToHex(repeated.aggregate)).toBe("48");
      expect(bytesToHex(repeated.contributions[0]!.broadcast)).toBe("fe");
    }
    expect(protocol.beginReveal()).toEqual({
      status: "closed",
      phase: "complete",
    });
    expect(protocol.phase).toBe("complete");
    expect(
      await protocol.submitReveal(
        "A",
        openings.get("A")!.contribution,
        openings.get("A")!.nonce,
      ),
    ).toEqual({ accepted: false, reason: "phase-closed" });
  });

  it("rejects missing, duplicate, unknown, and malformed commitments", async () => {
    const round = fixtureRound();
    const { commitments } = await commitmentsFor(round.contributions);

    const missing = coordinator();
    missing.submitCommitment("A", commitments.get("A")!);
    expect(missing.beginReveal()).toEqual({
      status: "aborted",
      reason: "missing-commitments",
      missing: ["B", "C", "D", "E"],
    });
    expect(missing.beginReveal()).toEqual({
      status: "aborted",
      reason: "missing-commitments",
      missing: ["B", "C", "D", "E"],
    });

    const duplicate = coordinator();
    expect(duplicate.submitCommitment("A", commitments.get("A")!)).toEqual({
      accepted: true,
    });
    expect(duplicate.submitCommitment("A", commitments.get("A")!)).toEqual({
      accepted: false,
      reason: "duplicate-commitment",
    });

    expect(coordinator().submitCommitment("Z", commitments.get("A")!)).toEqual({
      accepted: false,
      reason: "unknown-participant",
    });
    expect(coordinator().submitCommitment("A", new Uint8Array(31))).toEqual({
      accepted: false,
      reason: "invalid-commitment-length",
    });
    expect(
      coordinator().submitCommitment("A", "not bytes" as unknown as Uint8Array),
    ).toEqual({ accepted: false, reason: "invalid-commitment-length" });
  });

  it("validates coordinator context and width", () => {
    expect(
      () =>
        new CommitRevealCoordinator({
          graph: FIVE_CYCLE_GRAPH,
          sessionId: "",
          roundId: ROUND_ID,
          width: 1,
        }),
    ).toThrow(/must not be empty/);
    expect(
      () =>
        new CommitRevealCoordinator({
          graph: FIVE_CYCLE_GRAPH,
          sessionId: SESSION_ID,
          roundId: ROUND_ID,
          width: 0,
        }),
    ).toThrow(/positive safe integer/);
  });

  it("rejects early, unknown, duplicate, wrong-width, and invalid reveals", async () => {
    const round = fixtureRound();
    const prepared = await commitmentsFor(round.contributions);

    const early = coordinator();
    expect(await early.submitReveal("A", hexToBytes("fe"), nonce(1))).toEqual({
      accepted: false,
      reason: "early-reveal",
    });

    const ready = async () => {
      const protocol = coordinator();
      for (const participant of FIVE_CYCLE_GRAPH.participants) {
        protocol.submitCommitment(
          participant,
          prepared.commitments.get(participant)!,
        );
      }
      expect(protocol.beginReveal()).toEqual({ status: "ready" });
      return protocol;
    };

    const unknown = await ready();
    expect(await unknown.submitReveal("Z", hexToBytes("00"), nonce(1))).toEqual(
      {
        accepted: false,
        reason: "unknown-participant",
      },
    );

    const wrongWidth = await ready();
    expect(
      await wrongWidth.submitReveal("A", hexToBytes("0000"), nonce(1)),
    ).toEqual({
      accepted: false,
      reason: "wrong-contribution-width",
    });

    const invalid = await ready();
    const a = prepared.openings.get("A")!;
    expect(await invalid.submitReveal("A", a.contribution, nonce(99))).toEqual({
      accepted: false,
      reason: "invalid-opening",
    });

    const malformedNonce = await ready();
    expect(
      await malformedNonce.submitReveal(
        "A",
        a.contribution,
        new Uint8Array(31),
      ),
    ).toEqual({
      accepted: false,
      reason: "invalid-opening",
    });

    const duplicate = await ready();
    expect(await duplicate.submitReveal("A", a.contribution, a.nonce)).toEqual({
      accepted: true,
    });
    expect(await duplicate.submitReveal("A", a.contribution, a.nonce)).toEqual({
      accepted: false,
      reason: "duplicate-reveal",
    });
  });

  it("reports missing commitments and missing reveals truthfully at finalization", async () => {
    const round = fixtureRound();
    const prepared = await commitmentsFor(round.contributions);
    expect(coordinator().finalize()).toEqual({
      status: "aborted",
      reason: "missing-commitments",
      missing: ["A", "B", "C", "D", "E"],
    });

    const neverBeganReveal = coordinator();
    for (const participant of FIVE_CYCLE_GRAPH.participants) {
      neverBeganReveal.submitCommitment(
        participant,
        prepared.commitments.get(participant)!,
      );
    }
    expect(neverBeganReveal.finalize()).toEqual({
      status: "aborted",
      reason: "missing-reveals",
      missing: ["A", "B", "C", "D", "E"],
    });

    const withheld = coordinator();
    for (const participant of FIVE_CYCLE_GRAPH.participants) {
      withheld.submitCommitment(
        participant,
        prepared.commitments.get(participant)!,
      );
    }
    withheld.beginReveal();
    const a = prepared.openings.get("A")!;
    await withheld.submitReveal("A", a.contribution, a.nonce);
    expect(withheld.finalize()).toEqual({
      status: "aborted",
      reason: "missing-reveals",
      missing: ["B", "C", "D", "E"],
    });
  });

  it("still accepts a correctly opened precommitted jammer", async () => {
    const round = fixtureRound();
    const jammed = round.contributions.map(({ participant, broadcast }) => ({
      participant,
      broadcast: participant === "B" ? hexToBytes("fb") : broadcast,
    }));
    const prepared = await commitmentsFor(jammed);
    const protocol = coordinator();
    for (const participant of FIVE_CYCLE_GRAPH.participants) {
      protocol.submitCommitment(
        participant,
        prepared.commitments.get(participant)!,
      );
    }
    protocol.beginReveal();
    for (const participant of FIVE_CYCLE_GRAPH.participants) {
      const item = prepared.openings.get(participant)!;
      expect(
        await protocol.submitReveal(participant, item.contribution, item.nonce),
      ).toEqual({
        accepted: true,
      });
    }
    const result = protocol.finalize();
    expect(result.status).toBe("ok");
    if (result.status === "ok") expect(bytesToHex(result.aggregate)).toBe("2a");
  });

  it("aborts racing duplicate reveals without accepting either after the abort", async () => {
    const round = fixtureRound();
    const prepared = await commitmentsFor(round.contributions);
    const protocol = coordinator();
    for (const participant of FIVE_CYCLE_GRAPH.participants) {
      protocol.submitCommitment(
        participant,
        prepared.commitments.get(participant)!,
      );
    }
    protocol.beginReveal();
    const a = prepared.openings.get("A")!;
    const first = protocol.submitReveal("A", a.contribution, a.nonce);
    const second = protocol.submitReveal("A", a.contribution, a.nonce);
    expect(await second).toEqual({
      accepted: false,
      reason: "duplicate-reveal",
    });
    expect(await first).toEqual({ accepted: false, reason: "phase-closed" });
    expect(protocol.reveals.size).toBe(0);
    expect(protocol.finalize()).toMatchObject({
      status: "aborted",
      reason: "duplicate-reveal",
    });
  });
});
