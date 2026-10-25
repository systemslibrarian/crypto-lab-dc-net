import {
  bytesToHex,
  codeClaim,
  equalBytes,
  parseOneByte,
  required,
  setStale,
  tableRegion,
  textClaim,
  verdict,
  xor,
} from "./dom";
import type { DcNetUiModel, ParticipantId, RoundEvidence } from "./types";

function publicTranscript(round: RoundEvidence): HTMLElement {
  const section = document.createElement("section");
  section.className = "evidence-card public-view";
  section.dataset.view = "public";
  section.setAttribute("aria-labelledby", "public-transcript-heading");

  const heading = document.createElement("h3");
  heading.id = "public-transcript-heading";
  heading.textContent = "Public transcript";
  const explanation = document.createElement("p");
  explanation.textContent =
    "Anyone sees these five broadcasts and their XOR. This view contains no edge masks and no per-participant input bytes.";
  const roundLine = document.createElement("p");
  roundLine.append("Round context: ", textClaim("round-id", round.roundId));

  const table = document.createElement("table");
  table.innerHTML =
    '<caption>One public fixed-width contribution per participant</caption><thead><tr><th scope="col">Participant label</th><th scope="col">Broadcast byte</th></tr></thead><tbody></tbody>';
  const body = table.tBodies[0];
  for (const participant of round.participants) {
    const row = body.insertRow();
    const name = document.createElement("th");
    name.scope = "row";
    name.textContent = participant.id;
    const broadcast = row.insertCell();
    broadcast.append(codeClaim("round-broadcast", participant.broadcast));
    row.prepend(name);
  }

  const expected = xor(round.participants.map(({ input }) => input));
  const aggregateLine = document.createElement("p");
  aggregateLine.className = "headline-result";
  aggregateLine.append(
    "XOR of all broadcasts: ",
    codeClaim("round-aggregate", round.aggregate),
  );
  const outcome = equalBytes(expected, round.aggregate)
    ? verdict(
        "round-cancellation",
        "pass",
        "MASKS CANCELLED",
        "The public aggregate equals the independently recomputed XOR of participant inputs; the transcript does not name which participant supplied the nonzero byte.",
      )
    : verdict(
        "round-cancellation",
        "alarm",
        "CANCELLATION FAILED",
        "The public aggregate differs from the XOR of participant inputs.",
      );

  section.append(
    heading,
    explanation,
    roundLine,
    tableRegion("Public DC-net contributions", table),
    aggregateLine,
    outcome,
  );
  return section;
}

function omniscientTrace(round: RoundEvidence): HTMLElement {
  const section = document.createElement("section");
  section.className = "evidence-card omniscient-view";
  section.dataset.view = "omniscient";
  section.setAttribute("aria-labelledby", "omniscient-heading");

  const heading = document.createElement("h3");
  heading.id = "omniscient-heading";
  heading.textContent = "Omniscient teaching trace";
  const warning = document.createElement("p");
  warning.className = "view-warning";
  warning.textContent =
    "This panel deliberately reveals every input and mask so the algebra can be checked. No protocol participant receives this combined view.";

  const maskTable = document.createElement("table");
  maskTable.innerHTML =
    '<caption>Secret edge masks generated for this round</caption><thead><tr><th scope="col">Edge</th><th scope="col">Endpoints</th><th scope="col">Mask</th><th scope="col">Occurrences</th></tr></thead><tbody></tbody>';
  for (const edge of round.edges) {
    const row = maskTable.tBodies[0].insertRow();
    const name = document.createElement("th");
    name.scope = "row";
    name.textContent = edge.id;
    const endpoints = row.insertCell();
    endpoints.textContent = `${edge.left} and ${edge.right}`;
    const mask = row.insertCell();
    mask.dataset.secret = "edge-mask";
    mask.append(codeClaim("edge-mask", edge.mask));
    const occurrences = round.participants.filter(({ incidentEdgeIds }) =>
      incidentEdgeIds.includes(edge.id),
    ).length;
    const count = row.insertCell();
    count.append(textClaim("mask-occurrences", occurrences));
    row.prepend(name);
  }

  const participantTable = document.createElement("table");
  participantTable.innerHTML =
    '<caption>Input XOR incident masks equals the public broadcast</caption><thead><tr><th scope="col">Participant</th><th scope="col">Private input</th><th scope="col">Incident masks</th><th scope="col">Computed broadcast</th></tr></thead><tbody></tbody>';
  for (const participant of round.participants) {
    const row = participantTable.tBodies[0].insertRow();
    const name = document.createElement("th");
    name.scope = "row";
    name.textContent = participant.id;
    const input = row.insertCell();
    input.dataset.secret = "participant-input";
    input.append(codeClaim("round-input", participant.input));
    const incident = row.insertCell();
    incident.textContent = participant.incidentEdgeIds
      .map((id) => {
        const edge = round.edges.find((candidate) => candidate.id === id);
        return `${id}:${edge ? bytesToHex(edge.mask) : "?"}`;
      })
      .join(" ⊕ ");
    incident.dataset.secret = "incident-masks";
    const broadcast = row.insertCell();
    broadcast.append(codeClaim("computed-broadcast", participant.broadcast));
    row.prepend(name);
  }

  section.append(
    heading,
    warning,
    tableRegion("Secret edge-mask cancellation trace", maskTable),
    tableRegion("Per-participant DC-net equations", participantTable),
  );
  return section;
}

function render(round: RoundEvidence, output: HTMLElement): void {
  output.replaceChildren(publicTranscript(round), omniscientTrace(round));
  output.dataset.stale = "false";
}

export function initializeRound(model: DcNetUiModel): void {
  const form = required<HTMLFormElement>("#round-form");
  const sender = required<HTMLSelectElement>("#round-sender");
  const message = required<HTMLInputElement>("#round-message");
  const fixture = required<HTMLButtonElement>("#fixture-button");
  const status = required<HTMLElement>("#round-status");
  const output = required<HTMLElement>("#round-output");
  let lastSignature = "D:48";

  const signature = (): string =>
    `${sender.value}:${message.value.trim().toLowerCase().replace(/^0x/, "")}`;
  const retire = (): void =>
    setStale(output, status, signature() !== lastSignature);

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const parsed = parseOneByte(message.value);
    if (!parsed) {
      output.dataset.stale = "true";
      status.textContent =
        "Enter exactly one byte as two hexadecimal digits. Prior evidence remains stale.";
      return;
    }
    try {
      const result = model.freshRound(sender.value as ParticipantId, parsed);
      render(result, output);
      lastSignature = signature();
      status.textContent = `Fresh one-byte evidence computed for round ${result.roundId}.`;
    } catch (error) {
      output.dataset.stale = "true";
      status.textContent = `Fresh round refused: ${
        error instanceof Error ? error.message : "unknown computation error"
      }. Prior evidence remains stale.`;
    }
  });

  fixture.addEventListener("click", () => {
    sender.value = "D";
    message.value = "48";
    const result = model.fixtureRound();
    render(result, output);
    lastSignature = "D:48";
    status.textContent =
      "Checked fixture loaded: AB=3c, BC=a5, CD=7f, DE=11, EA=c2; aggregate 48.";
  });

  sender.addEventListener("change", retire);
  message.addEventListener("input", retire);

  render(model.fixtureRound(), output);
  status.textContent = "Checked fixture evidence is current.";
}
