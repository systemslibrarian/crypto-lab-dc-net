import { describe, expect, it } from "vitest";

import {
  FIVE_CYCLE_GRAPH,
  analyzeCoalition,
  analyzeLateDisclosure,
  bytesToHex,
  componentTotalHex,
  componentTotalsFromInputs,
  createGraph,
  enumerateExactOneCandidateEvidence,
  enumerateOneBitViewDistribution,
  hexToBytes,
  makeSingleSenderInputs,
  oneBitSingleSenderInputs,
  priorPreservingPosterior,
  recoverInputsFromAllMasks,
  runRound,
  sameViewDistribution,
  viewDistributionSummary,
  type BytesById,
  type DcGraph,
  type ParticipantId,
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

function fixtureRound(sender = "D") {
  return runRound({
    graph: FIVE_CYCLE_GRAPH,
    inputs: makeSingleSenderInputs(FIVE_CYCLE_GRAPH, sender, hexToBytes("48")),
    edgeMasks: fixtureMasks(),
  });
}

describe("observer and coalition views", () => {
  it("derives the separating coalition's known edges and exact honest totals", () => {
    const analysis = analyzeCoalition({
      round: fixtureRound(),
      coalition: ["C", "A"],
      exactOnePayload: hexToBytes("48"),
      priors: new Map([
        ["B", 4],
        ["D", 3],
        ["E", 1],
      ]),
    });
    expect(analysis.coalition).toEqual(["A", "C"]);
    expect(analysis.knownEdges.map((edge) => edge.id)).toEqual([
      "AB",
      "BC",
      "CD",
      "EA",
    ]);
    expect(analysis.unknownEdges.map((edge) => edge.id)).toEqual(["DE"]);
    expect(
      analysis.components.map((component) => component.participants),
    ).toEqual([["B"], ["D", "E"]]);
    expect(componentTotalHex(analysis.components)).toEqual(["00", "48"]);
    expect(analysis.exactOne).toMatchObject({
      compatible: true,
      reason: "compatible",
      candidates: ["D", "E"],
    });
    expect(analysis.exactOne?.posterior).toEqual([
      { participant: "B", priorWeight: 4, normalizedPrior: 0.5, posterior: 0 },
      {
        participant: "D",
        priorWeight: 3,
        normalizedPrior: 0.375,
        posterior: 0.75,
      },
      {
        participant: "E",
        priorWeight: 1,
        normalizedPrior: 0.125,
        posterior: 0.25,
      },
    ]);
  });

  it("keeps candidates connected for individual and adjacent-coalition views", () => {
    const single = analyzeCoalition({
      round: fixtureRound(),
      coalition: ["A"],
      exactOnePayload: hexToBytes("48"),
    });
    expect(
      single.components.map((component) => component.participants),
    ).toEqual([["B", "C", "D", "E"]]);
    expect(single.exactOne?.candidates).toEqual(["B", "C", "D", "E"]);

    const adjacent = analyzeCoalition({
      round: fixtureRound(),
      coalition: ["A", "B"],
      exactOnePayload: hexToBytes("48"),
    });
    expect(
      adjacent.components.map((component) => component.participants),
    ).toEqual([["C", "D", "E"]]);
    expect(adjacent.exactOne?.candidates).toEqual(["C", "D", "E"]);
  });

  it("does not manufacture an exact-one claim for incompatible inputs", () => {
    const coalitionSender = analyzeCoalition({
      round: fixtureRound("A"),
      coalition: ["A", "C"],
      exactOnePayload: hexToBytes("48"),
    });
    expect(coalitionSender.exactOne).toMatchObject({
      compatible: false,
      reason: "coalition-input-is-nonzero",
      candidates: [],
    });

    const collisionInputs = new Map(
      makeSingleSenderInputs(FIVE_CYCLE_GRAPH, "B", hexToBytes("48")),
    );
    collisionInputs.set("D", hexToBytes("48"));
    const collision = runRound({
      graph: FIVE_CYCLE_GRAPH,
      inputs: collisionInputs,
      edgeMasks: fixtureMasks(),
    });
    expect(
      analyzeCoalition({
        round: collision,
        coalition: ["A", "C"],
        exactOnePayload: hexToBytes("48"),
      }).exactOne,
    ).toMatchObject({
      compatible: false,
      reason: "no-single-compatible-component",
    });
  });

  it("validates coalitions, payloads, and priors rather than guessing", () => {
    const round = fixtureRound();
    expect(() => analyzeCoalition({ round, coalition: ["Z"] })).toThrow(
      /unknown/,
    );
    expect(() => analyzeCoalition({ round, coalition: ["A", "A"] })).toThrow(
      /duplicate/,
    );
    expect(() =>
      analyzeCoalition({
        round,
        coalition: [],
        exactOnePayload: hexToBytes("0000"),
      }),
    ).toThrow(/exactly 1/);
    expect(() =>
      analyzeCoalition({
        round,
        coalition: [],
        exactOnePayload: hexToBytes("00"),
      }),
    ).toThrow(/nonzero/);
    expect(() =>
      analyzeCoalition({
        round,
        coalition: [],
        priors: new Map(),
      }),
    ).toThrow(/require an exact-one/);

    expect(() =>
      priorPreservingPosterior(
        ["B", "D", "E"],
        ["D", "E"],
        new Map([
          ["B", 1],
          ["D", -1],
          ["E", 1],
        ]),
      ),
    ).toThrow(/non-negative/);
    expect(() =>
      priorPreservingPosterior(
        ["B", "D", "E"],
        ["D", "E"],
        new Map([
          ["B", 1],
          ["D", 0],
          ["E", 0],
        ]),
      ),
    ).toThrow(/positive prior mass/);
    expect(() =>
      priorPreservingPosterior(
        ["B", "D", "E"],
        ["D", "D"],
        new Map([
          ["B", 1],
          ["D", 1],
          ["E", 1],
        ]),
      ),
    ).toThrow(/unique/);
    expect(() =>
      priorPreservingPosterior(
        ["B", "D", "E"],
        ["Z"],
        new Map([
          ["B", 1],
          ["D", 1],
          ["E", 1],
        ]),
      ),
    ).toThrow(/outside universe/);
    expect(() =>
      priorPreservingPosterior(
        ["B", "D", "E"],
        ["D"],
        new Map([
          ["B", 1],
          ["D", 1],
        ]),
      ),
    ).toThrow(/missing prior/);
    expect(() =>
      priorPreservingPosterior(
        ["B", "D", "E"],
        ["D"],
        new Map([
          ["B", 1],
          ["D", 1],
          ["E", 1],
          ["Z", 1],
        ]),
      ),
    ).toThrow(/unknown participant/);
    expect(() =>
      priorPreservingPosterior(
        ["B", "D", "E"],
        ["D"],
        new Map([
          ["B", 0],
          ["D", 0],
          ["E", 0],
        ]),
      ),
    ).toThrow(/positive total mass/);
  });
});

describe("late disclosure", () => {
  it("shrinks components and recovers only singleton inputs", () => {
    const partial = analyzeLateDisclosure(fixtureRound(), [
      "AB",
      "BC",
      "CD",
      "EA",
    ]);
    expect(
      partial.components.map((component) => component.participants),
    ).toEqual([["A"], ["B"], ["C"], ["D", "E"]]);
    expect([...partial.recoveredInputs.keys()]).toEqual(["A", "B", "C"]);
    expect([...partial.recoveredInputs.values()].map(bytesToHex)).toEqual([
      "00",
      "00",
      "00",
    ]);
    expect(() => analyzeLateDisclosure(fixtureRound(), ["AB", "AB"])).toThrow(
      /unique/,
    );
    expect(() => analyzeLateDisclosure(fixtureRound(), ["ZZ"])).toThrow(
      /unknown/,
    );
  });

  it("recovers every participant input after all masks are disclosed", () => {
    expect(
      [...recoverInputsFromAllMasks(fixtureRound()).entries()].map(
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
});

describe("bounded transcript evidence", () => {
  it("counts the five-cycle's exact transcript preimages", () => {
    const evidence = enumerateExactOneCandidateEvidence(FIVE_CYCLE_GRAPH, []);
    expect(evidence.candidates).toEqual(["A", "B", "C", "D", "E"]);
    const first = evidence.distributions.get("A")!;
    expect(first.maskAssignmentCount).toBe(32);
    expect(first.frequencies.size).toBe(16);
    expect(new Set(first.frequencies.values())).toEqual(new Set([2]));
    expect(evidence.indistinguishable.get("A")).toEqual([
      "A",
      "B",
      "C",
      "D",
      "E",
    ]);
    expect(viewDistributionSummary(first)).toContain("=2");

    const separating = enumerateExactOneCandidateEvidence(FIVE_CYCLE_GRAPH, [
      "A",
      "C",
    ]);
    expect(separating.indistinguishable.get("B")).toEqual(["B"]);
    expect(separating.indistinguishable.get("D")).toEqual(["D", "E"]);
    expect(separating.indistinguishable.get("E")).toEqual(["D", "E"]);
  });

  it("matches independent connected-component truth for every four-node graph and coalition", () => {
    const participants = ["A", "B", "C", "D"] as const;
    const possibleEdges = [
      ["A", "B"],
      ["A", "C"],
      ["A", "D"],
      ["B", "C"],
      ["B", "D"],
      ["C", "D"],
    ] as const;

    type Node = (typeof participants)[number];
    const independentComponents = (
      edges: readonly { readonly left: Node; readonly right: Node }[],
      coalition: ReadonlySet<Node>,
    ): Map<Node, number> => {
      const honest = participants.filter(
        (participant) => !coalition.has(participant),
      );
      const adjacency = new Map(
        honest.map((participant) => [participant, [] as Node[]]),
      );
      for (const edge of edges) {
        if (!coalition.has(edge.left) && !coalition.has(edge.right)) {
          adjacency.get(edge.left)!.push(edge.right);
          adjacency.get(edge.right)!.push(edge.left);
        }
      }
      const labels = new Map<Node, number>();
      let label = 0;
      for (const start of honest) {
        if (labels.has(start)) continue;
        const queue = [start];
        labels.set(start, label);
        for (let cursor = 0; cursor < queue.length; cursor += 1) {
          for (const neighbor of adjacency.get(queue[cursor]!)!) {
            if (!labels.has(neighbor)) {
              labels.set(neighbor, label);
              queue.push(neighbor);
            }
          }
        }
        label += 1;
      }
      return labels;
    };

    let pairChecks = 0;
    for (let graphBits = 0; graphBits < 64; graphBits += 1) {
      const edges = possibleEdges.flatMap(([left, right], index) =>
        ((graphBits >> index) & 1) === 1
          ? [{ id: `${left}${right}`, left, right }]
          : [],
      );
      const graph: DcGraph = createGraph(participants, edges);
      for (let coalitionBits = 0; coalitionBits < 16; coalitionBits += 1) {
        const coalition = participants.filter(
          (_, index) => ((coalitionBits >> index) & 1) === 1,
        );
        const coalitionSet = new Set<Node>(coalition);
        const candidates = participants.filter(
          (participant) => !coalitionSet.has(participant),
        );
        const componentLabels = independentComponents(edges, coalitionSet);
        const distributions = new Map<
          ParticipantId,
          ReturnType<typeof enumerateOneBitViewDistribution>
        >();
        for (const candidate of candidates) {
          distributions.set(
            candidate,
            enumerateOneBitViewDistribution({
              graph,
              coalition,
              inputs: new Map(
                participants.map(
                  (participant) =>
                    [participant, participant === candidate ? 1 : 0] as const,
                ),
              ),
            }),
          );
        }
        for (let left = 0; left < candidates.length; left += 1) {
          for (let right = left + 1; right < candidates.length; right += 1) {
            const leftCandidate = candidates[left]!;
            const rightCandidate = candidates[right]!;
            expect(
              sameViewDistribution(
                distributions.get(leftCandidate)!,
                distributions.get(rightCandidate)!,
              ),
            ).toBe(
              componentLabels.get(leftCandidate) ===
                componentLabels.get(rightCandidate),
            );
            pairChecks += 1;
          }
        }
      }
    }
    expect(pairChecks).toBe(1_536);
  });

  it("enforces explicit bounds and one-bit inputs", () => {
    const validInputs = new Map(
      FIVE_CYCLE_GRAPH.participants.map(
        (participant) => [participant, participant === "A" ? 1 : 0] as const,
      ),
    );
    expect(() =>
      enumerateOneBitViewDistribution({
        graph: FIVE_CYCLE_GRAPH,
        coalition: [],
        inputs: validInputs,
        maxEdges: 4,
      }),
    ).toThrow(/refuses 5 edges/);
    expect(() =>
      enumerateOneBitViewDistribution({
        graph: FIVE_CYCLE_GRAPH,
        coalition: ["A", "A"],
        inputs: validInputs,
      }),
    ).toThrow(/unique/);
    const invalidInputs = new Map(validInputs) as Map<string, 0 | 1>;
    invalidInputs.delete("E");
    expect(() =>
      enumerateOneBitViewDistribution({
        graph: FIVE_CYCLE_GRAPH,
        coalition: [],
        inputs: invalidInputs,
      }),
    ).toThrow(/missing or invalid/);

    expect(() =>
      enumerateOneBitViewDistribution({
        graph: FIVE_CYCLE_GRAPH,
        coalition: [],
        inputs: validInputs,
        maxEdges: -1,
      }),
    ).toThrow(/0 through 20/);
    expect(() =>
      enumerateOneBitViewDistribution({
        graph: FIVE_CYCLE_GRAPH,
        coalition: ["Z"],
        inputs: validInputs,
      }),
    ).toThrow(/unknown participant/);
    const unknownInputs = new Map(validInputs) as Map<string, 0 | 1>;
    unknownInputs.set("Z", 0);
    expect(() =>
      enumerateOneBitViewDistribution({
        graph: FIVE_CYCLE_GRAPH,
        coalition: [],
        inputs: unknownInputs,
      }),
    ).toThrow(/inputs name unknown/);
    expect(() =>
      enumerateExactOneCandidateEvidence(FIVE_CYCLE_GRAPH, ["A", "A"]),
    ).toThrow(/unique/);
    expect(() =>
      enumerateExactOneCandidateEvidence(FIVE_CYCLE_GRAPH, ["Z"]),
    ).toThrow(/unknown participant/);

    const one = enumerateOneBitViewDistribution({
      graph: createGraph(["A", "B"], []),
      coalition: [],
      inputs: new Map([
        ["A", 1],
        ["B", 0],
      ]),
    });
    expect(
      sameViewDistribution(one, {
        maskAssignmentCount: one.maskAssignmentCount + 1,
        frequencies: one.frequencies,
      }),
    ).toBe(false);

    expect(
      componentTotalsFromInputs(
        [[], ["A", "B"]],
        new Map([
          ["A", hexToBytes("01")],
          ["B", hexToBytes("03")],
        ]),
        1,
      ).map((component) => bytesToHex(component.total)),
    ).toEqual(["00", "02"]);
    expect(
      bytesToHex(oneBitSingleSenderInputs(FIVE_CYCLE_GRAPH, "E").get("E")!),
    ).toBe("01");
  });
});
