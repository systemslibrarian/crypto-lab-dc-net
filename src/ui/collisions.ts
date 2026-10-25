import {
  codeClaim,
  equalBytes,
  required,
  setStale,
  tableRegion,
  textClaim,
  verdict,
  xor,
} from "./dom";
import type { CollisionEvidence, DcNetUiModel } from "./types";

function render(evidence: CollisionEvidence, output: HTMLElement): void {
  const publicCard = document.createElement("section");
  publicCard.className = "evidence-card public-view";
  publicCard.dataset.view = "public";
  const publicHeading = document.createElement("h3");
  publicHeading.textContent = "Public transcript";
  const table = document.createElement("table");
  table.innerHTML =
    '<caption>One-bit collision-round public broadcasts</caption><thead><tr><th scope="col">Participant</th><th scope="col">Broadcast bit</th></tr></thead><tbody></tbody>';
  for (const participant of evidence.round.participants) {
    const row = table.tBodies[0].insertRow();
    const name = document.createElement("th");
    name.scope = "row";
    name.textContent = participant.id;
    const broadcast = row.insertCell();
    broadcast.append(codeClaim("collision-broadcast", participant.broadcast));
    row.prepend(name);
  }
  const aggregate = document.createElement("p");
  aggregate.className = "headline-result";
  aggregate.append(
    "Public aggregate parity: ",
    textClaim("collision-parity", evidence.parity),
  );
  const parityCopy =
    evidence.parity === 0
      ? "In this fixed five-participant round, zero, two, or four bit-1 inputs remain compatible with this public parity."
      : "In this fixed five-participant round, one, three, or five bit-1 inputs remain compatible with this public parity.";
  const parityVerdict = verdict(
    "collision-ambiguity",
    evidence.senderCount === 2 ? "alarm" : "info",
    evidence.parity === 0
      ? "EVEN PARITY — DOES NOT PROVE SILENCE"
      : "ODD PARITY — DOES NOT PROVE ONE SENDER",
    parityCopy,
  );
  publicCard.append(
    publicHeading,
    tableRegion("Collision public contributions", table),
    aggregate,
    parityVerdict,
  );

  const trace = document.createElement("section");
  trace.className = "evidence-card omniscient-view";
  trace.dataset.view = "omniscient";
  const traceHeading = document.createElement("h3");
  traceHeading.textContent = "Omniscient collision trace";
  const warning = document.createElement("p");
  warning.className = "view-warning";
  warning.textContent =
    "The sender count and input column are simulator truth, not facts available from the public aggregate.";
  const truth = document.createElement("p");
  truth.append(
    "Simulator sender count: ",
    textClaim("collision-sender-count", evidence.senderCount),
    "; selected senders: ",
    textClaim(
      "collision-sender-ids",
      evidence.senderIds.join(","),
      evidence.senderIds.length ? `{${evidence.senderIds.join(", ")}}` : "∅",
    ),
    ".",
  );
  const inputTable = document.createElement("table");
  inputTable.innerHTML =
    '<caption>Private one-bit inputs in this simulator run</caption><thead><tr><th scope="col">Participant</th><th scope="col">Input bit</th></tr></thead><tbody></tbody>';
  for (const participant of evidence.round.participants) {
    const row = inputTable.tBodies[0].insertRow();
    const name = document.createElement("th");
    name.scope = "row";
    name.textContent = participant.id;
    const input = row.insertCell();
    input.dataset.secret = "collision-input";
    input.append(codeClaim("collision-input", participant.input));
    row.prepend(name);
  }
  trace.append(
    traceHeading,
    warning,
    truth,
    tableRegion("Private collision inputs", inputTable),
  );

  const byteCard = document.createElement("section");
  byteCard.className = "evidence-card";
  const byteHeading = document.createElement("h3");
  byteHeading.textContent = "Byte collisions are XOR, too";
  const byteCopy = document.createElement("p");
  byteCopy.textContent =
    "Longer simultaneous payloads are not reliably marked as collisions: identical values can cancel, while distinct values can produce a structurally valid, plausible one-byte output.";
  const byteTable = document.createElement("table");
  byteTable.innerHTML =
    '<caption>Executable two-sender byte examples</caption><thead><tr><th scope="col">Case</th><th scope="col">First input</th><th scope="col">Second input</th><th scope="col">Aggregate XOR</th><th scope="col">Independent check</th></tr></thead><tbody></tbody>';
  for (const example of evidence.byteExamples) {
    const row = byteTable.tBodies[0].insertRow();
    const label = document.createElement("th");
    label.scope = "row";
    label.textContent =
      example.kind === "identical-cancel"
        ? "Identical messages cancel"
        : "Distinct inputs yield a plausible byte";
    const left = row.insertCell();
    left.append(codeClaim("collision-byte-left", example.left));
    const right = row.insertCell();
    right.append(codeClaim("collision-byte-right", example.right));
    const aggregateCell = row.insertCell();
    aggregateCell.append(
      codeClaim("collision-byte-aggregate", example.aggregate),
    );
    const independent = xor([example.left, example.right]);
    const check = row.insertCell();
    check.append(
      textClaim(
        "collision-byte-check",
        equalBytes(independent, example.aggregate) ? "match" : "mismatch",
      ),
    );
    row.prepend(label);
  }
  byteCard.append(
    byteHeading,
    byteCopy,
    tableRegion("Byte collision examples", byteTable),
  );

  output.replaceChildren(publicCard, trace, byteCard);
  output.dataset.stale = "false";
}

export function initializeCollisions(model: DcNetUiModel): void {
  const form = required<HTMLFormElement>("#collision-form");
  const status = required<HTMLElement>("#collision-status");
  const output = required<HTMLElement>("#collision-output");
  let lastSignature = "2";
  const selected = (): 0 | 1 | 2 | 3 => {
    const checked = required<HTMLInputElement>(
      'input[name="sender-count"]:checked',
    );
    return Number(checked.value) as 0 | 1 | 2 | 3;
  };
  const run = (): void => {
    const evidence = model.collision(selected());
    render(evidence, output);
    lastSignature = String(evidence.senderCount);
    status.textContent = `Current evidence: ${evidence.senderCount} simulator sender${
      evidence.senderCount === 1 ? "" : "s"
    }, public parity ${evidence.parity}.`;
  };
  const retire = (): void =>
    setStale(output, status, String(selected()) !== lastSignature);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    run();
  });
  for (const input of form.querySelectorAll<HTMLInputElement>(
    'input[name="sender-count"]',
  )) {
    input.addEventListener("change", retire);
  }
  run();
}
