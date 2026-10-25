import {
  codeClaim,
  equalBytes,
  required,
  tableRegion,
  textClaim,
  verdict,
  xor,
} from "./dom";
import type { DcNetUiModel, ReuseEvidence } from "./types";

function render(evidence: ReuseEvidence, output: HTMLElement): void {
  const reuse = document.createElement("section");
  reuse.className = "evidence-card attack-card";
  const heading = document.createElement("h3");
  heading.textContent = "Deliberately unsafe repeated masks";
  const warning = document.createElement("p");
  warning.className = "view-warning";
  warning.textContent =
    "This attack helper bypasses the honest duplicate-round and exact-assignment-replay guard. The first round has known-empty inputs; the second round reuses exactly the same edge masks.";
  const reuseMaskTable = document.createElement("table");
  reuseMaskTable.innerHTML =
    '<caption>Omniscient attack-fixture evidence: masks in both rounds</caption><thead><tr><th scope="col">Edge</th><th scope="col">Round 0 mask</th><th scope="col">Round 1 mask</th><th scope="col">Equal?</th></tr></thead><tbody></tbody>';
  for (const firstEdge of evidence.firstRound.edges) {
    const secondEdge = evidence.secondRound.edges.find(
      (candidate) => candidate.id === firstEdge.id,
    );
    if (!secondEdge) continue;
    const row = reuseMaskTable.tBodies[0].insertRow();
    const edge = document.createElement("th");
    edge.scope = "row";
    edge.append(textClaim("reuse-edge", firstEdge.id));
    const firstMask = row.insertCell();
    firstMask.append(codeClaim("reuse-first-mask", firstEdge.mask));
    const secondMask = row.insertCell();
    secondMask.append(codeClaim("reuse-second-mask", secondEdge.mask));
    const same = row.insertCell();
    same.append(
      textClaim(
        "reuse-mask-equal",
        equalBytes(firstEdge.mask, secondEdge.mask),
      ),
    );
    row.prepend(edge);
  }
  const table = document.createElement("table");
  table.innerHTML =
    '<caption>Per-participant cancellation across reused-mask rounds</caption><thead><tr><th scope="col">Participant</th><th scope="col">Input 0</th><th scope="col">Input 1</th><th scope="col">Broadcast 0</th><th scope="col">Broadcast 1</th><th scope="col">Broadcast XOR</th><th scope="col">Input XOR</th><th scope="col">Equal?</th><th scope="col">Recovered next input</th></tr></thead><tbody></tbody>';
  let independentlyRecovered = true;
  for (const evidenceRow of evidence.rows) {
    const row = table.tBodies[0].insertRow();
    const participant = document.createElement("th");
    participant.scope = "row";
    participant.textContent = evidenceRow.participant;
    const firstInput = row.insertCell();
    firstInput.append(codeClaim("reuse-first-input", evidenceRow.firstInput));
    const secondInput = row.insertCell();
    secondInput.append(
      codeClaim("reuse-second-input", evidenceRow.secondInput),
    );
    const first = row.insertCell();
    first.append(
      codeClaim("reuse-first-broadcast", evidenceRow.firstBroadcast),
    );
    const second = row.insertCell();
    second.append(
      codeClaim("reuse-second-broadcast", evidenceRow.secondBroadcast),
    );
    const broadcastXor = row.insertCell();
    broadcastXor.append(
      codeClaim("reuse-broadcast-xor", evidenceRow.broadcastXor),
    );
    const inputXor = row.insertCell();
    inputXor.append(codeClaim("reuse-input-xor", evidenceRow.inputXor));
    const independentBroadcastXor = xor([
      evidenceRow.firstBroadcast,
      evidenceRow.secondBroadcast,
    ]);
    const matches =
      equalBytes(independentBroadcastXor, evidenceRow.broadcastXor) &&
      equalBytes(evidenceRow.broadcastXor, evidenceRow.inputXor) &&
      evidenceRow.equal;
    const check = row.insertCell();
    check.append(textClaim("reuse-identity-match", matches));
    const recovered = row.insertCell();
    recovered.append(
      codeClaim(
        "reuse-known-empty-recovery",
        evidenceRow.recoveredFromKnownEmpty,
      ),
    );
    independentlyRecovered &&=
      matches &&
      equalBytes(evidenceRow.recoveredFromKnownEmpty, evidenceRow.secondInput);
    row.prepend(participant);
  }
  const exposed =
    evidence.everyInputRecovered && independentlyRecovered
      ? verdict(
          "mask-reuse",
          "alarm",
          "MASK REUSE EXPOSED EVERY INPUT",
          "Because round 0 was known empty, each participant’s two public broadcasts directly recover that participant’s round-1 input.",
        )
      : verdict(
          "mask-reuse",
          "info",
          "RECOVERY INCOMPLETE",
          "The supplied evidence did not recover every second-round input.",
        );
  const control = evidence.distinctControlRetainsReuseIdentity
    ? verdict(
        "distinct-mask-control",
        "alarm",
        "DISTINCT-MASK FIXTURE DID NOT BREAK THE IDENTITY",
        "The displayed deterministic replacement masks exhibited the same per-participant cancellation identity in this instance.",
      )
    : verdict(
        "distinct-mask-control",
        "pass",
        "THIS DISTINCT-MASK FIXTURE BREAKS THE REUSE IDENTITY",
        "For these displayed deterministic replacement masks, per-participant broadcast XOR differs from input XOR. This single fixture illustrates the contrast with exact reuse; it does not establish an all-distinct theorem or validate randomness.",
      );
  const controlTable = document.createElement("table");
  controlTable.innerHTML =
    '<caption>Distinct-mask deterministic control: this fixture breaks the per-participant identity</caption><thead><tr><th scope="col">Participant</th><th scope="col">Round 0 input</th><th scope="col">Control input</th><th scope="col">Round 0 broadcast</th><th scope="col">Control broadcast</th><th scope="col">Broadcast XOR</th><th scope="col">Input XOR</th><th scope="col">Equal?</th></tr></thead><tbody></tbody>';
  for (const controlRow of evidence.distinctControlRows) {
    const row = controlTable.tBodies[0].insertRow();
    const participant = document.createElement("th");
    participant.scope = "row";
    participant.textContent = controlRow.participant;
    const firstInput = row.insertCell();
    firstInput.append(
      codeClaim("distinct-control-first-input", controlRow.firstInput),
    );
    const controlInput = row.insertCell();
    controlInput.append(
      codeClaim("distinct-control-next-input", controlRow.controlInput),
    );
    const firstBroadcast = row.insertCell();
    firstBroadcast.append(
      codeClaim("distinct-control-first-broadcast", controlRow.firstBroadcast),
    );
    const controlBroadcast = row.insertCell();
    controlBroadcast.append(
      codeClaim("distinct-control-next-broadcast", controlRow.controlBroadcast),
    );
    const broadcastXor = row.insertCell();
    broadcastXor.append(
      codeClaim("distinct-control-broadcast-xor", controlRow.broadcastXor),
    );
    const inputXor = row.insertCell();
    inputXor.append(
      codeClaim("distinct-control-input-xor", controlRow.inputXor),
    );
    const equal = row.insertCell();
    equal.append(
      textClaim("distinct-control-identity-match", controlRow.equal),
    );
    row.prepend(participant);
  }
  reuse.append(
    heading,
    warning,
    tableRegion("Repeated edge-mask comparison", reuseMaskTable),
    tableRegion("Reused-mask input recovery", table),
    exposed,
    tableRegion("Distinct-mask deterministic control comparison", controlTable),
    control,
  );

  const disclosure = document.createElement("section");
  disclosure.className = "evidence-card attack-card";
  const disclosureHeading = document.createElement("h3");
  disclosureHeading.textContent = "Recorded transcript, masks disclosed later";
  const disclosureCopy = document.createElement("p");
  disclosureCopy.append(
    "For participant ",
    textClaim("disclosure-participant", evidence.disclosure.participant),
    ", public broadcast ",
    codeClaim("disclosure-broadcast", evidence.disclosure.broadcast),
    " plus later-disclosed incident masks ",
    textClaim(
      "disclosure-edge-ids",
      evidence.disclosure.disclosedEdgeIds.join(","),
      evidence.disclosure.disclosedEdgeIds.join(" and "),
    ),
    " recovers input ",
    codeClaim("disclosure-recovered-input", evidence.disclosure.recoveredInput),
    ".",
  );
  const disclosureMaskTable = document.createElement("table");
  disclosureMaskTable.innerHTML =
    '<caption>Incident masks disclosed after the recorded round</caption><thead><tr><th scope="col">Edge</th><th scope="col">Disclosed mask</th></tr></thead><tbody></tbody>';
  for (const disclosed of evidence.disclosure.disclosedMasks) {
    const row = disclosureMaskTable.tBodies[0].insertRow();
    const edge = document.createElement("th");
    edge.scope = "row";
    edge.append(textClaim("disclosure-edge", disclosed.edgeId));
    const mask = row.insertCell();
    mask.append(codeClaim("disclosure-mask", disclosed.mask));
    row.prepend(edge);
  }
  const matches = equalBytes(
    evidence.disclosure.recoveredInput,
    evidence.disclosure.actualInput,
  );
  const disclosureVerdict = verdict(
    "late-disclosure",
    matches ? "alarm" : "info",
    matches ? "PAST INPUT RECOVERED" : "RECOVERY DID NOT MATCH",
    matches
      ? "All masks incident to this participant were retained and disclosed, shrinking its recorded-round component to a singleton."
      : "The supplied disclosed masks were insufficient to recover the participant’s actual input.",
  );
  const erasure = document.createElement("p");
  erasure.className = "limits-note";
  erasure.innerHTML =
    "<strong>Erasure boundary:</strong> JavaScript cannot prove that a mask was erased. Retention or later disclosure violates the theorem’s one-time-secret assumption.";
  disclosure.append(
    disclosureHeading,
    disclosureCopy,
    tableRegion("Late-disclosed incident masks", disclosureMaskTable),
    disclosureVerdict,
    erasure,
  );
  output.replaceChildren(reuse, disclosure);
  output.dataset.stale = "false";
}

export function initializeReuse(model: DcNetUiModel): void {
  const button = required<HTMLButtonElement>("#reuse-button");
  const status = required<HTMLElement>("#reuse-status");
  const output = required<HTMLElement>("#reuse-output");
  button.addEventListener("click", () => {
    render(model.reuse(), output);
    status.textContent =
      "Mask-reuse, known-empty recovery, distinct-mask deterministic control, and late-disclosure evidence is current.";
  });
  render(model.reuse(), output);
  status.textContent = "Reuse and disclosure evidence is current.";
}
