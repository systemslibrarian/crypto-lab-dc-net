export type ParticipantId = string;

export interface DcEdge {
  readonly id: string;
  readonly left: ParticipantId;
  readonly right: ParticipantId;
}

export interface DcGraph {
  readonly participants: readonly ParticipantId[];
  readonly edges: readonly DcEdge[];
}

export interface ComponentOptions {
  readonly excludedParticipants?: ReadonlySet<ParticipantId>;
  readonly excludedEdges?: ReadonlySet<string>;
}

function assertWellFormedText(value: string, label: string): void {
  if (value.length === 0) throw new TypeError(`${label} must not be empty`);

  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new TypeError(`${label} must be well-formed Unicode`);
      }
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new TypeError(`${label} must be well-formed Unicode`);
    }
  }
}

export function createGraph(
  participants: readonly ParticipantId[],
  edges: readonly DcEdge[],
): DcGraph {
  if (participants.length < 2) {
    throw new RangeError("a DC-net graph needs at least two participants");
  }

  const participantSet = new Set<ParticipantId>();
  for (const participant of participants) {
    assertWellFormedText(participant, "participant identifier");
    if (participantSet.has(participant)) {
      throw new TypeError(`duplicate participant: ${participant}`);
    }
    participantSet.add(participant);
  }

  const edgeIds = new Set<string>();
  const endpointPairs = new Set<string>();
  const participantIndex = new Map(
    participants.map((participant, index) => [participant, index] as const),
  );

  const copiedEdges = edges.map((edge) => {
    assertWellFormedText(edge.id, "edge identifier");
    if (edgeIds.has(edge.id))
      throw new TypeError(`duplicate edge identifier: ${edge.id}`);
    edgeIds.add(edge.id);

    if (!participantSet.has(edge.left) || !participantSet.has(edge.right)) {
      throw new TypeError(`edge ${edge.id} names an unknown participant`);
    }
    if (edge.left === edge.right)
      throw new TypeError(`edge ${edge.id} is a self-loop`);

    const leftIndex = participantIndex.get(edge.left)!;
    const rightIndex = participantIndex.get(edge.right)!;
    const pair =
      leftIndex < rightIndex
        ? `${leftIndex}:${rightIndex}`
        : `${rightIndex}:${leftIndex}`;
    if (endpointPairs.has(pair)) {
      throw new TypeError(
        `duplicate undirected edge between ${edge.left} and ${edge.right}`,
      );
    }
    endpointPairs.add(pair);

    return Object.freeze({ id: edge.id, left: edge.left, right: edge.right });
  });

  return Object.freeze({
    participants: Object.freeze([...participants]),
    edges: Object.freeze(copiedEdges),
  });
}

export const FIVE_CYCLE_GRAPH: DcGraph = createGraph(
  ["A", "B", "C", "D", "E"],
  [
    { id: "AB", left: "A", right: "B" },
    { id: "BC", left: "B", right: "C" },
    { id: "CD", left: "C", right: "D" },
    { id: "DE", left: "D", right: "E" },
    { id: "EA", left: "E", right: "A" },
  ],
);

export function incidentEdges(
  graph: DcGraph,
  participant: ParticipantId,
): readonly DcEdge[] {
  if (!graph.participants.includes(participant)) {
    throw new TypeError(`unknown participant: ${participant}`);
  }
  return graph.edges.filter(
    (edge) => edge.left === participant || edge.right === participant,
  );
}

export function connectedComponents(
  graph: DcGraph,
  options: ComponentOptions = {},
): readonly (readonly ParticipantId[])[] {
  const excludedParticipants =
    options.excludedParticipants ?? new Set<ParticipantId>();
  const excludedEdges = options.excludedEdges ?? new Set<string>();
  for (const participant of excludedParticipants) {
    if (!graph.participants.includes(participant)) {
      throw new TypeError(`cannot exclude unknown participant: ${participant}`);
    }
  }
  for (const edgeId of excludedEdges) {
    if (!graph.edges.some((edge) => edge.id === edgeId)) {
      throw new TypeError(`cannot exclude unknown edge: ${edgeId}`);
    }
  }

  const included = graph.participants.filter(
    (participant) => !excludedParticipants.has(participant),
  );
  const adjacency = new Map(
    included.map((participant) => [participant, [] as string[]]),
  );
  for (const edge of graph.edges) {
    if (
      excludedEdges.has(edge.id) ||
      excludedParticipants.has(edge.left) ||
      excludedParticipants.has(edge.right)
    ) {
      continue;
    }
    adjacency.get(edge.left)!.push(edge.right);
    adjacency.get(edge.right)!.push(edge.left);
  }

  const visited = new Set<ParticipantId>();
  const components: ParticipantId[][] = [];
  for (const start of included) {
    if (visited.has(start)) continue;
    const component: ParticipantId[] = [];
    const queue = [start];
    visited.add(start);
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const current = queue[cursor]!;
      component.push(current);
      for (const neighbor of adjacency.get(current)!) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }
    components.push(component);
  }
  return components;
}

export function isConnected(graph: DcGraph): boolean {
  return connectedComponents(graph).length === 1;
}

export function graphIdentity(graph: DcGraph): string {
  const participants = [...graph.participants].sort();
  const edges = graph.edges
    .map((edge) => {
      const endpoints = [edge.left, edge.right].sort();
      return [edge.id, ...endpoints];
    })
    .sort((left, right) =>
      JSON.stringify(left).localeCompare(JSON.stringify(right)),
    );
  return JSON.stringify({ participants, edges });
}

export function inducedGraph(
  graph: DcGraph,
  removedParticipants: ReadonlySet<ParticipantId>,
): DcGraph {
  for (const participant of removedParticipants) {
    if (!graph.participants.includes(participant)) {
      throw new TypeError(`cannot remove unknown participant: ${participant}`);
    }
  }
  const participants = graph.participants.filter(
    (participant) => !removedParticipants.has(participant),
  );
  const edges = graph.edges.filter(
    (edge) =>
      !removedParticipants.has(edge.left) &&
      !removedParticipants.has(edge.right),
  );
  return createGraph(participants, edges);
}

export function assertValidGraph(graph: DcGraph): DcGraph {
  return createGraph(graph.participants, graph.edges);
}
