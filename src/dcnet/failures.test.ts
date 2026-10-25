import { describe, expect, it } from "vitest";

import {
  FIVE_CYCLE_GRAPH,
  FreshRoundGuard,
  analyzeDropout,
  analyzeLateDisclosure,
  analyzeMaskReuse,
  bytesToHex,
  createGraph,
  hexToBytes,
  makeSingleSenderInputs,
  makeZeroInputs,
  reformGraphAfterDropout,
  runRound,
  type BytesById,
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

function distinctControlMasks(): BytesById {
  return new Map([
    ["AB", hexToBytes("01")],
    ["BC", hexToBytes("02")],
    ["CD", hexToBytes("04")],
    ["DE", hexToBytes("08")],
    ["EA", hexToBytes("10")],
  ]);
}

describe("one-use honest-round guard", () => {
  it("refuses a duplicate round identifier and an exactly repeated mask assignment", () => {
    const guard = new FreshRoundGuard(FIVE_CYCLE_GRAPH);
    const first = guard.run({
      roundId: "honest-1",
      inputs: makeZeroInputs(FIVE_CYCLE_GRAPH, 1),
      edgeMasks: fixtureMasks(),
    });
    expect(bytesToHex(first.aggregate)).toBe("00");
    expect(guard.acceptedRoundCount).toBe(1);

    expect(() =>
      guard.run({
        roundId: "honest-1",
        inputs: makeZeroInputs(FIVE_CYCLE_GRAPH, 1),
        edgeMasks: distinctControlMasks(),
      }),
    ).toThrow(/round identifier was already used/);
    expect(() =>
      guard.run({
        roundId: "honest-2",
        inputs: makeZeroInputs(FIVE_CYCLE_GRAPH, 1),
        edgeMasks: fixtureMasks(),
      }),
    ).toThrow(/reused edge-mask assignment/);
    expect(guard.acceptedRoundCount).toBe(1);

    expect(
      guard.run({
        roundId: "honest-2",
        inputs: makeZeroInputs(FIVE_CYCLE_GRAPH, 1),
        edgeMasks: distinctControlMasks(),
      }).roundId,
    ).toBe("honest-2");
    expect(guard.acceptedRoundCount).toBe(2);
  });

  it("keeps deliberate attack construction on the explicitly stateless path", () => {
    const first = runRound({
      graph: FIVE_CYCLE_GRAPH,
      roundId: "attack-a",
      inputs: makeZeroInputs(FIVE_CYCLE_GRAPH, 1),
      edgeMasks: fixtureMasks(),
    });
    const second = runRound({
      graph: FIVE_CYCLE_GRAPH,
      roundId: "attack-b",
      inputs: makeSingleSenderInputs(FIVE_CYCLE_GRAPH, "D", hexToBytes("48")),
      edgeMasks: fixtureMasks(),
    });
    expect(analyzeMaskReuse(first, second).allMasksReused).toBe(true);

    const defaultIds = new FreshRoundGuard(FIVE_CYCLE_GRAPH);
    defaultIds.run({
      inputs: makeZeroInputs(FIVE_CYCLE_GRAPH, 1),
      edgeMasks: fixtureMasks(),
    });
    expect(() =>
      defaultIds.run({
        inputs: makeZeroInputs(FIVE_CYCLE_GRAPH, 1),
        edgeMasks: distinctControlMasks(),
      }),
    ).toThrow(/round-1/);
  });
});

describe("mask reuse", () => {
  it("recovers every second input when a known-empty round reuses all masks", () => {
    const first = runRound({
      graph: FIVE_CYCLE_GRAPH,
      roundId: "reuse-empty",
      inputs: makeZeroInputs(FIVE_CYCLE_GRAPH, 1),
      edgeMasks: fixtureMasks(),
    });
    const second = runRound({
      graph: FIVE_CYCLE_GRAPH,
      roundId: "reuse-message",
      inputs: makeSingleSenderInputs(FIVE_CYCLE_GRAPH, "D", hexToBytes("48")),
      edgeMasks: fixtureMasks(),
    });
    const analysis = analyzeMaskReuse(first, second);

    expect(analysis.reusedEdges).toEqual(["AB", "BC", "CD", "DE", "EA"]);
    expect([...analysis.perParticipantLeakEquation.values()]).toEqual([
      true,
      true,
      true,
      true,
      true,
    ]);
    expect([...analysis.broadcastDifferences.values()].map(bytesToHex)).toEqual(
      ["00", "00", "00", "48", "00"],
    );
    expect(
      [...analysis.recoveredSecondInputs!.entries()].map(
        ([participant, input]) => [participant, bytesToHex(input)],
      ),
    ).toEqual([
      ["A", "00"],
      ["B", "00"],
      ["C", "00"],
      ["D", "48"],
      ["E", "00"],
    ]);
  });

  it("distinguishes partial reuse and a distinct-mask control from the all-mask identity", () => {
    const first = runRound({
      graph: FIVE_CYCLE_GRAPH,
      inputs: makeZeroInputs(FIVE_CYCLE_GRAPH, 1),
      edgeMasks: fixtureMasks(),
    });
    const partialMasks = new Map(fixtureMasks());
    partialMasks.set("AB", hexToBytes("3d"));
    const partial = analyzeMaskReuse(
      first,
      runRound({
        graph: FIVE_CYCLE_GRAPH,
        inputs: makeSingleSenderInputs(FIVE_CYCLE_GRAPH, "D", hexToBytes("48")),
        edgeMasks: partialMasks,
      }),
    );
    expect(partial.allMasksReused).toBe(false);
    expect(partial.reusedEdges).toEqual(["BC", "CD", "DE", "EA"]);
    expect([...partial.perParticipantLeakEquation.entries()]).toEqual([
      ["A", false],
      ["B", false],
      ["C", true],
      ["D", true],
      ["E", true],
    ]);
    expect(partial.recoveredSecondInputs).toBeNull();

    const fresh = analyzeMaskReuse(
      first,
      runRound({
        graph: FIVE_CYCLE_GRAPH,
        inputs: makeSingleSenderInputs(FIVE_CYCLE_GRAPH, "D", hexToBytes("48")),
        edgeMasks: distinctControlMasks(),
      }),
    );
    expect(fresh.reusedEdges).toEqual([]);
    expect([...fresh.perParticipantLeakEquation.values()].every(Boolean)).toBe(
      false,
    );

    const nonemptyFirst = analyzeMaskReuse(
      runRound({
        graph: FIVE_CYCLE_GRAPH,
        inputs: makeSingleSenderInputs(FIVE_CYCLE_GRAPH, "A", hexToBytes("01")),
        edgeMasks: fixtureMasks(),
      }),
      runRound({
        graph: FIVE_CYCLE_GRAPH,
        inputs: makeSingleSenderInputs(FIVE_CYCLE_GRAPH, "D", hexToBytes("48")),
        edgeMasks: fixtureMasks(),
      }),
    );
    expect(nonemptyFirst.firstRoundKnownEmpty).toBe(false);
    expect(nonemptyFirst.recoveredSecondInputs).toBeNull();
  });

  it("rejects incomparable graphs and widths", () => {
    const first = runRound({
      graph: FIVE_CYCLE_GRAPH,
      inputs: makeZeroInputs(FIVE_CYCLE_GRAPH, 1),
      edgeMasks: fixtureMasks(),
    });
    const path = createGraph(
      FIVE_CYCLE_GRAPH.participants,
      FIVE_CYCLE_GRAPH.edges.slice(0, 4),
    );
    const otherGraph = runRound({
      graph: path,
      inputs: makeZeroInputs(path, 1),
      edgeMasks: new Map([...fixtureMasks()].slice(0, 4)),
    });
    expect(() => analyzeMaskReuse(first, otherGraph)).toThrow(
      /same participant and key graph/,
    );

    const wide = runRound({
      graph: FIVE_CYCLE_GRAPH,
      inputs: makeZeroInputs(FIVE_CYCLE_GRAPH, 2),
      edgeMasks: new Map(
        FIVE_CYCLE_GRAPH.edges.map(
          (edge) => [edge.id, hexToBytes("0000")] as const,
        ),
      ),
    });
    expect(() => analyzeMaskReuse(first, wide)).toThrow(
      /equal contribution widths/,
    );
  });
});

describe("dropout, reformation, and later disclosure", () => {
  it("aborts instead of substituting zero and exposes the exact boundary term", () => {
    const round = runRound({
      graph: FIVE_CYCLE_GRAPH,
      inputs: makeZeroInputs(FIVE_CYCLE_GRAPH, 1),
      edgeMasks: fixtureMasks(),
    });
    const dropout = analyzeDropout(round, ["D"]);
    expect(dropout).toMatchObject({
      status: "aborted",
      reason: "missing-contributions",
      missingParticipants: ["D"],
      presentParticipants: ["A", "B", "C", "E"],
      boundaryEquationHolds: true,
    });
    expect(dropout.boundaryEdges.map((edge) => edge.id)).toEqual(["CD", "DE"]);
    expect(bytesToHex(dropout.partialAggregate)).toBe("6e");
    expect(bytesToHex(dropout.presentInputXor)).toBe("00");
    expect(bytesToHex(dropout.boundaryMaskXor)).toBe("6e");
    expect(bytesToHex(dropout.expectedPartialAggregate)).toBe("6e");

    expect(() => analyzeDropout(round, [])).toThrow(/one or more/);
    expect(() => analyzeDropout(round, ["D", "D"])).toThrow(/unique/);
    expect(() => analyzeDropout(round, ["Z"])).toThrow(/unknown/);

    const allMissing = analyzeDropout(round, FIVE_CYCLE_GRAPH.participants);
    expect(bytesToHex(allMissing.partialAggregate)).toBe("00");
    expect(bytesToHex(allMissing.presentInputXor)).toBe("00");
    expect(bytesToHex(allMissing.boundaryMaskXor)).toBe("00");
  });

  it("reforms the induced graph and reports whether the survivors stay connected", () => {
    const connected = reformGraphAfterDropout(FIVE_CYCLE_GRAPH, ["D"]);
    expect(connected.graph.participants).toEqual(["A", "B", "C", "E"]);
    expect(connected.graph.edges.map((edge) => edge.id)).toEqual([
      "AB",
      "BC",
      "EA",
    ]);
    expect(connected.connected).toBe(true);
    expect(connected.requiresFreshMasks).toBe(true);

    expect(
      reformGraphAfterDropout(FIVE_CYCLE_GRAPH, ["A", "C"]).connected,
    ).toBe(false);
    expect(() => reformGraphAfterDropout(FIVE_CYCLE_GRAPH, [])).toThrow(
      /one or more/,
    );
    expect(() => reformGraphAfterDropout(FIVE_CYCLE_GRAPH, ["A", "A"])).toThrow(
      /unique/,
    );
    expect(() => reformGraphAfterDropout(FIVE_CYCLE_GRAPH, ["Z"])).toThrow(
      /unknown/,
    );
    expect(() =>
      reformGraphAfterDropout(FIVE_CYCLE_GRAPH, ["A", "B", "C", "D"]),
    ).toThrow(/at least two/);
  });

  it("recovers a past input only after both incident masks are disclosed", () => {
    const round = runRound({
      graph: FIVE_CYCLE_GRAPH,
      inputs: makeSingleSenderInputs(FIVE_CYCLE_GRAPH, "D", hexToBytes("48")),
      edgeMasks: fixtureMasks(),
    });
    expect(analyzeLateDisclosure(round, ["CD"]).recoveredInputs.has("D")).toBe(
      false,
    );
    const both = analyzeLateDisclosure(round, ["CD", "DE"]);
    expect(bytesToHex(both.recoveredInputs.get("D")!)).toBe("48");
  });
});
