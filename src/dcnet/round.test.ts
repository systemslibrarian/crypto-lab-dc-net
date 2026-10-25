import { describe, expect, it } from "vitest";

import {
  FIVE_CYCLE_GRAPH,
  aggregateContributions,
  analyzeCollision,
  analyzeShapedJam,
  bytesToHex,
  hexToBytes,
  makeSingleSenderInputs,
  makeZeroInputs,
  runRound,
  sampleEdgeMasks,
  xorBytes,
  type BytesById,
  type RoundResult,
} from "./index.js";

function fixtureMasks(): BytesById {
  return new Map([
    ["AB", hexToBytes("3c")],
    ["BC", hexToBytes("a5")],
    ["CD", hexToBytes("7f")],
    ["DE", hexToBytes("11")],
    ["EA", hexToBytes("c2")],
  ]);
}

describe("DC-net round algebra", () => {
  it("matches the reviewed five-cycle fixture", () => {
    const round = runRound({
      graph: FIVE_CYCLE_GRAPH,
      inputs: makeSingleSenderInputs(FIVE_CYCLE_GRAPH, "D", hexToBytes("48")),
      edgeMasks: fixtureMasks(),
      roundId: "fixture",
    });
    expect(round.roundId).toBe("fixture");
    expect(
      round.contributions.map((item) => [
        item.participant,
        bytesToHex(item.broadcast),
      ]),
    ).toEqual([
      ["A", "fe"],
      ["B", "99"],
      ["C", "da"],
      ["D", "26"],
      ["E", "d3"],
    ]);
    expect(bytesToHex(round.aggregate)).toBe("48");
  });

  it("exhaustively cancels all 32 masks for all 32 one-bit input vectors", () => {
    const edges = FIVE_CYCLE_GRAPH.edges;
    const participants = FIVE_CYCLE_GRAPH.participants;
    let checked = 0;
    for (let maskBits = 0; maskBits < 32; maskBits += 1) {
      const masks = new Map(
        edges.map(
          (edge, index) =>
            [edge.id, Uint8Array.of((maskBits >> index) & 1)] as const,
        ),
      );
      for (let inputBits = 0; inputBits < 32; inputBits += 1) {
        const inputs = new Map(
          participants.map(
            (participant, index) =>
              [participant, Uint8Array.of((inputBits >> index) & 1)] as const,
          ),
        );
        const round = runRound({
          graph: FIVE_CYCLE_GRAPH,
          inputs,
          edgeMasks: masks,
        });

        // Independent reference: derive each row directly from the declared endpoints.
        const referenceBroadcasts = participants.map(
          (participant, participantIndex) => {
            let bit = (inputBits >> participantIndex) & 1;
            edges.forEach((edge, edgeIndex) => {
              if (edge.left === participant || edge.right === participant) {
                bit ^= (maskBits >> edgeIndex) & 1;
              }
            });
            return bit;
          },
        );
        expect(round.contributions.map((item) => item.broadcast[0])).toEqual(
          referenceBroadcasts,
        );
        const expectedParity = participants.reduce(
          (parity, _participant, index) => parity ^ ((inputBits >> index) & 1),
          0,
        );
        expect(round.aggregate[0]).toBe(expectedParity);
        checked += 1;
      }
    }
    expect(checked).toBe(1_024);
  });

  it("requests one independent fixed-width mask per edge and copies inputs", () => {
    let next = 0;
    const masks = sampleEdgeMasks(FIVE_CYCLE_GRAPH, 2, (length) => {
      expect(length).toBe(2);
      next += 1;
      return Uint8Array.of(next, 0xff - next);
    });
    expect([...masks.values()].map(bytesToHex)).toEqual([
      "01fe",
      "02fd",
      "03fc",
      "04fb",
      "05fa",
    ]);
    const inputs = makeZeroInputs(FIVE_CYCLE_GRAPH, 2);
    const round = runRound({
      graph: FIVE_CYCLE_GRAPH,
      inputs,
      edgeMasks: masks,
    });
    inputs.get("A")![0] = 0xff;
    expect(bytesToHex(round.inputs.get("A")!)).toBe("0000");
    expect(bytesToHex(round.aggregate)).toBe("0000");

    let generatedCount = 0;
    const generated = runRound({
      graph: FIVE_CYCLE_GRAPH,
      inputs: makeZeroInputs(FIVE_CYCLE_GRAPH, 1),
      rng: (length) => {
        expect(length).toBe(1);
        generatedCount += 1;
        return Uint8Array.of(generatedCount);
      },
    });
    expect(generatedCount).toBe(5);
    expect(generated.edgeMasks.size).toBe(5);
  });

  it("rejects missing, unknown, mismatched, or malformed assignments", () => {
    const missing = makeZeroInputs(FIVE_CYCLE_GRAPH, 1) as Map<
      string,
      Uint8Array
    >;
    missing.delete("E");
    expect(() =>
      runRound({ graph: FIVE_CYCLE_GRAPH, inputs: missing }),
    ).toThrow(/missing/);

    const unknown = new Map(makeZeroInputs(FIVE_CYCLE_GRAPH, 1));
    unknown.set("Z", Uint8Array.of(0));
    expect(() =>
      runRound({ graph: FIVE_CYCLE_GRAPH, inputs: unknown }),
    ).toThrow(/unknown/);

    const mismatched = new Map(makeZeroInputs(FIVE_CYCLE_GRAPH, 1));
    mismatched.set("C", Uint8Array.of(0, 0));
    expect(() =>
      runRound({ graph: FIVE_CYCLE_GRAPH, inputs: mismatched }),
    ).toThrow(/exactly 1/);

    const masks = new Map(fixtureMasks());
    masks.set("DE", Uint8Array.of(1, 2));
    expect(() =>
      runRound({
        graph: FIVE_CYCLE_GRAPH,
        inputs: makeZeroInputs(FIVE_CYCLE_GRAPH, 1),
        edgeMasks: masks,
      }),
    ).toThrow(/exactly 1/);

    const nonBytes = new Map(makeZeroInputs(FIVE_CYCLE_GRAPH, 1));
    nonBytes.set("B", "x" as unknown as Uint8Array);
    expect(() =>
      runRound({ graph: FIVE_CYCLE_GRAPH, inputs: nonBytes }),
    ).toThrow(/Uint8Array/);
    expect(() => makeZeroInputs(FIVE_CYCLE_GRAPH, 0)).toThrow(/positive/);
    expect(() =>
      makeSingleSenderInputs(FIVE_CYCLE_GRAPH, "Z", Uint8Array.of(1)),
    ).toThrow(/unknown sender/);
  });
});

describe("strict contribution aggregation", () => {
  const honest = () =>
    runRound({
      graph: FIVE_CYCLE_GRAPH,
      inputs: makeSingleSenderInputs(FIVE_CYCLE_GRAPH, "D", hexToBytes("48")),
      edgeMasks: fixtureMasks(),
    });

  it("accepts every correct-width share without claiming it is honest", () => {
    const round = honest();
    const result = aggregateContributions({
      graph: round.graph,
      width: round.width,
      contributions: round.contributions,
    });
    expect(result.status).toBe("ok");
    if (result.status === "ok") expect(bytesToHex(result.aggregate)).toBe("48");

    const jam = analyzeShapedJam(round, "B", hexToBytes("fb"));
    expect(jam.structurallyAccepted).toBe(true);
    expect(bytesToHex(jam.delta)).toBe("62");
    expect(bytesToHex(jam.jammedAggregate)).toBe("2a");
  });

  it("distinguishes structural malformation from missing-share abort", () => {
    const round = honest();
    const publicShares = round.contributions.map(
      ({ participant, broadcast }) => ({
        participant,
        broadcast,
      }),
    );
    const missing = aggregateContributions({
      graph: round.graph,
      width: 1,
      contributions: publicShares.slice(0, -1),
    });
    expect(missing).toMatchObject({
      status: "aborted",
      reason: "missing-contributions",
      missing: ["E"],
    });

    const malformed = aggregateContributions({
      graph: round.graph,
      width: 1,
      contributions: [
        ...publicShares.filter(({ participant }) => participant !== "C"),
        { participant: "A", broadcast: Uint8Array.of(0) },
        { participant: "Z", broadcast: Uint8Array.of(0) },
        { participant: "C", broadcast: Uint8Array.of(0, 1) },
      ],
    });
    expect(malformed.status).toBe("malformed");
    if (malformed.status === "malformed") {
      expect(malformed.issues.map((issue) => issue.kind)).toEqual([
        "duplicate-participant",
        "unknown-participant",
        "wrong-width",
      ]);
    }

    const notBytes = aggregateContributions({
      graph: round.graph,
      width: 1,
      contributions: publicShares.map((share) =>
        share.participant === "C"
          ? ({ participant: "C", broadcast: "x" } as unknown as typeof share)
          : share,
      ),
    });
    expect(notBytes.status).toBe("malformed");
    if (notBytes.status === "malformed") {
      expect(notBytes.issues).toEqual([
        { kind: "not-byte-vector", participant: "C" },
      ]);
    }
    expect(() =>
      aggregateContributions({
        graph: round.graph,
        width: 0,
        contributions: [],
      }),
    ).toThrow(/positive/);
  });
});

describe("collision semantics", () => {
  it("reports parity rather than pretending to learn the sender count", () => {
    for (let senderCount = 0; senderCount <= 5; senderCount += 1) {
      const inputs = new Map(
        FIVE_CYCLE_GRAPH.participants.map(
          (participant, index) =>
            [participant, Uint8Array.of(index < senderCount ? 1 : 0)] as const,
        ),
      );
      const analysis = analyzeCollision(inputs);
      expect(analysis.senderCount).toBe(senderCount);
      expect(analysis.oneBitParity).toBe(senderCount % 2);
      expect(analysis.aggregate[0]).toBe(senderCount % 2);
      expect(analysis.outputDeterminesSenderCount).toBe(false);
    }
  });

  it("shows cancellation and a collision that remains in a valid codebook", () => {
    const identical = new Map([
      ["A", hexToBytes("5a")],
      ["B", hexToBytes("5a")],
      ["C", hexToBytes("00")],
    ]);
    expect(bytesToHex(analyzeCollision(identical).aggregate)).toBe("00");

    const validCodebookCollision = xorBytes(hexToBytes("01"), hexToBytes("02"));
    expect(bytesToHex(validCodebookCollision)).toBe("03");
    expect(
      new Set(["01", "02", "03"]).has(bytesToHex(validCodebookCollision)),
    ).toBe(true);

    expect(
      analyzeCollision(new Map([["A", hexToBytes("ff")]])).oneBitParity,
    ).toBeNull();
    expect(() => analyzeCollision(new Map())).toThrow(/needs participants/);
    expect(() =>
      analyzeCollision(
        new Map([
          ["A", hexToBytes("00")],
          ["B", hexToBytes("0000")],
        ]),
      ),
    ).toThrow(/same width/);
  });

  it("rejects invalid jam targets and detects corrupt round evidence", () => {
    const round = runRound({
      graph: FIVE_CYCLE_GRAPH,
      inputs: makeZeroInputs(FIVE_CYCLE_GRAPH, 1),
      edgeMasks: fixtureMasks(),
    });
    expect(() => analyzeShapedJam(round, "Z", hexToBytes("00"))).toThrow(
      /unknown/,
    );
    expect(() => analyzeShapedJam(round, "A", hexToBytes("0000"))).toThrow(
      /exactly 1/,
    );

    const malformed = {
      ...round,
      contributions: round.contributions.map((item) =>
        item.participant === "C"
          ? ({ ...item, broadcast: "x" } as unknown as typeof item)
          : item,
      ),
    } satisfies RoundResult;
    expect(() => analyzeShapedJam(malformed, "A", hexToBytes("00"))).toThrow(
      /became malformed/,
    );

    const inconsistent = {
      ...round,
      aggregate: hexToBytes("ff"),
    } satisfies RoundResult;
    expect(() => analyzeShapedJam(inconsistent, "A", hexToBytes("00"))).toThrow(
      /delta did not transfer/,
    );
  });
});
