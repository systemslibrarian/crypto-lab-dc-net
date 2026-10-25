import { describe, expect, it } from "vitest";

import {
  FIVE_CYCLE_GRAPH,
  bytesToHex,
  connectedComponents,
  createGraph,
  equalBytes,
  hexToBytes,
  inducedGraph,
  incidentEdges,
  isConnected,
  sampleBytes,
  secureRandomBytes,
  xorBytes,
  zeroBytes,
} from "./index.js";

describe("byte-vector primitives", () => {
  it("round-trips strict hexadecimal encodings", () => {
    expect(bytesToHex(hexToBytes("00a5FF"))).toBe("00a5ff");
    for (const invalid of ["", "0", "0x00", "gg", "00 11"]) {
      expect(() => hexToBytes(invalid)).toThrow(/hex input/);
    }
  });

  it("XORs equal-width vectors without changing its inputs", () => {
    const left = hexToBytes("0fa5");
    const right = hexToBytes("f011");
    expect(bytesToHex(xorBytes(left, right))).toBe("ffb4");
    expect(bytesToHex(left)).toBe("0fa5");
    expect(() => xorBytes()).toThrow(/at least one/);
    expect(() => xorBytes(left, Uint8Array.of(1))).toThrow(/same width/);
    expect(() => zeroBytes(0)).toThrow(/positive/);
  });

  it("compares all bytes and defensively copies RNG output", () => {
    expect(equalBytes(Uint8Array.of(1, 2), Uint8Array.of(1, 2))).toBe(true);
    expect(equalBytes(Uint8Array.of(1, 2), Uint8Array.of(1, 3))).toBe(false);
    expect(equalBytes(Uint8Array.of(1), Uint8Array.of(1, 0))).toBe(false);
    const source = Uint8Array.of(7, 8);
    const sampled = sampleBytes(2, () => source);
    source[0] = 0;
    expect([...sampled]).toEqual([7, 8]);
    expect(() => sampleBytes(2, () => Uint8Array.of(1))).toThrow(/exactly 2/);
    expect(secureRandomBytes(4)).toHaveLength(4);
  });
});

describe("validated undirected key graphs", () => {
  it("declares the five-cycle in the reviewed edge order", () => {
    expect(FIVE_CYCLE_GRAPH.participants).toEqual(["A", "B", "C", "D", "E"]);
    expect(FIVE_CYCLE_GRAPH.edges.map((edge) => edge.id)).toEqual([
      "AB",
      "BC",
      "CD",
      "DE",
      "EA",
    ]);
    expect(isConnected(FIVE_CYCLE_GRAPH)).toBe(true);
    expect(incidentEdges(FIVE_CYCLE_GRAPH, "D").map((edge) => edge.id)).toEqual(
      ["CD", "DE"],
    );
  });

  it("finds the exact honest components behind coalition examples", () => {
    expect(
      connectedComponents(FIVE_CYCLE_GRAPH, {
        excludedParticipants: new Set(["A"]),
      }),
    ).toEqual([["B", "C", "D", "E"]]);
    expect(
      connectedComponents(FIVE_CYCLE_GRAPH, {
        excludedParticipants: new Set(["A", "B"]),
      }),
    ).toEqual([["C", "D", "E"]]);
    expect(
      connectedComponents(FIVE_CYCLE_GRAPH, {
        excludedParticipants: new Set(["A", "C"]),
      }),
    ).toEqual([["B"], ["D", "E"]]);
    expect(
      connectedComponents(FIVE_CYCLE_GRAPH, {
        excludedEdges: new Set(["AB", "CD"]),
      }),
    ).toEqual([
      ["A", "E", "D"],
      ["B", "C"],
    ]);
  });

  it("rejects ambiguous or malformed graph declarations", () => {
    expect(() => createGraph(["A"], [])).toThrow(/at least two/);
    expect(() => createGraph(["A", "A"], [])).toThrow(/duplicate participant/);
    expect(() =>
      createGraph(["A", "B"], [{ id: "AA", left: "A", right: "A" }]),
    ).toThrow(/self-loop/);
    expect(() =>
      createGraph(["A", "B"], [{ id: "AC", left: "A", right: "C" }]),
    ).toThrow(/unknown participant/);
    expect(() =>
      createGraph(
        ["A", "B"],
        [
          { id: "one", left: "A", right: "B" },
          { id: "two", left: "B", right: "A" },
        ],
      ),
    ).toThrow(/duplicate undirected edge/);
    expect(() =>
      createGraph(
        ["A", "B", "C"],
        [
          { id: "edge", left: "A", right: "B" },
          { id: "edge", left: "B", right: "C" },
        ],
      ),
    ).toThrow(/duplicate edge identifier/);
    expect(() => createGraph(["\ud800", "B"], [])).toThrow(
      /well-formed Unicode/,
    );
    expect(() => createGraph(["\udc00", "B"], [])).toThrow(
      /well-formed Unicode/,
    );
    expect(() => createGraph(["", "B"], [])).toThrow(/must not be empty/);
    expect(createGraph(["😀", "B"], []).participants).toEqual(["😀", "B"]);
  });

  it("rejects unknown component exclusions", () => {
    expect(() =>
      connectedComponents(FIVE_CYCLE_GRAPH, {
        excludedParticipants: new Set(["Z"]),
      }),
    ).toThrow(/unknown participant/);
    expect(() =>
      connectedComponents(FIVE_CYCLE_GRAPH, {
        excludedEdges: new Set(["ZZ"]),
      }),
    ).toThrow(/unknown edge/);
    expect(() => incidentEdges(FIVE_CYCLE_GRAPH, "Z")).toThrow(
      /unknown participant/,
    );
    expect(() => inducedGraph(FIVE_CYCLE_GRAPH, new Set(["Z"]))).toThrow(
      /unknown participant/,
    );
  });
});
