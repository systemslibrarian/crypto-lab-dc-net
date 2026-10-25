import { codeClaim, required, tableRegion, textClaim, verdict } from "./dom";
import type {
  CommitmentEvidence,
  ContributionCaseEvidence,
  DcNetUiModel,
  DisruptionEvidence,
  ResultKind,
} from "./types";

function caseCard(
  headingText: string,
  evidence: ContributionCaseEvidence,
  marker: string,
  kind: ResultKind,
  verdictHeading: string,
  verdictDetail: string,
): HTMLElement {
  const card = document.createElement("article");
  card.className = "evidence-card attack-card";
  const heading = document.createElement("h3");
  heading.textContent = headingText;
  const status = document.createElement("p");
  status.append(
    "Aggregator status: ",
    textClaim(`${marker}-status`, evidence.status),
    ". ",
    evidence.reason,
  );
  card.append(
    heading,
    status,
    verdict(marker, kind, verdictHeading, verdictDetail),
  );
  return card;
}

function renderDisruption(
  evidence: DisruptionEvidence,
  output: HTMLElement,
): void {
  const honest = document.createElement("p");
  honest.className = "baseline-line";
  honest.append(
    "Honest baseline aggregate: ",
    codeClaim("disruption-honest-aggregate", evidence.honestAggregate),
  );
  const malformed = caseCard(
    "Malformed contribution",
    evidence.malformed,
    "malformed-refusal",
    "reject",
    "REFUSED BEFORE AGGREGATION",
    "The wrong-width contribution is rejected and no aggregate is emitted. This validates shape, not honesty.",
  );

  const jammer = caseCard(
    "Correct-shaped jammer",
    evidence.shapedJammer,
    "shaped-jammer",
    "alarm",
    "ACCEPTED SHAPE; OUTPUT JAMMED",
    "The replacement has the expected participant label and byte width. Basic DC-net cannot tell that it violates the participant equation or attribute the disruption.",
  );
  const jammerLine = document.createElement("p");
  jammerLine.append(
    "Participant: ",
    textClaim("shaped-jammer-participant", evidence.shapedJammer.participant),
    "; changed aggregate: ",
    textClaim("shaped-jammer-changed", evidence.shapedJammer.changedAggregate),
    "; emitted aggregate: ",
    evidence.shapedJammer.aggregate
      ? codeClaim("shaped-jammer-aggregate", evidence.shapedJammer.aggregate)
      : "none",
    ".",
  );
  jammer.insertBefore(jammerLine, jammer.lastElementChild);

  const dropout = caseCard(
    "Missing participant",
    evidence.dropout,
    "dropout-abort",
    "reject",
    "ROUND ABORTED",
    "A missing contribution leaves incident masks uncancelled. The aggregator aborts instead of inventing a zero contribution.",
  );
  const dropoutLine = document.createElement("p");
  dropoutLine.append(
    "Absent participant: ",
    textClaim("dropout-participant", evidence.dropout.participant),
    "; substituted zero: ",
    textClaim("dropout-zero-substitution", evidence.dropout.substitutedZero),
    ".",
  );
  dropout.insertBefore(dropoutLine, dropout.lastElementChild);
  const dropoutEquation = document.createElement("p");
  dropoutEquation.className = "code-line";
  dropoutEquation.append(
    "Received-broadcast XOR ",
    codeClaim("dropout-partial-aggregate", evidence.dropout.partialAggregate),
    " = present-input XOR ",
    codeClaim("dropout-present-input-xor", evidence.dropout.presentInputXor),
    " ⊕ boundary-mask XOR ",
    codeClaim("dropout-boundary-mask-xor", evidence.dropout.boundaryMaskXor),
    " = ",
    codeClaim(
      "dropout-expected-partial",
      evidence.dropout.expectedPartialAggregate,
    ),
    ".",
  );
  const dropoutBoundary = document.createElement("p");
  dropoutBoundary.append(
    "Boundary edges appearing once: ",
    textClaim(
      "dropout-boundary-edges",
      evidence.dropout.boundaryEdgeIds.join(","),
      evidence.dropout.boundaryEdgeIds.join(", "),
    ),
    "; equation holds: ",
    textClaim(
      "dropout-boundary-equation-holds",
      evidence.dropout.boundaryEquationHolds,
    ),
    ".",
  );
  dropout.insertBefore(dropoutEquation, dropout.lastElementChild);
  dropout.insertBefore(dropoutBoundary, dropout.lastElementChild);

  const reformed = document.createElement("article");
  reformed.className = "evidence-card attack-card";
  const reformHeading = document.createElement("h3");
  reformHeading.textContent = "Reformed membership";
  const reformCopy = document.createElement("p");
  reformCopy.append(
    "New round ",
    textClaim("reformed-round-id", evidence.reformedRound.roundId),
    " uses members ",
    textClaim(
      "reformed-membership",
      evidence.reformedRound.graph.participants.join(","),
      `{${evidence.reformedRound.graph.participants.join(", ")}}`,
    ),
    ", a new connected key graph, and deterministic replacement masks in this checked fixture. Aggregate: ",
    codeClaim("reformed-aggregate", evidence.reformedRound.aggregate),
    ".",
  );
  const maskTable = document.createElement("table");
  maskTable.innerHTML =
    '<caption>Retained edges receive deterministic replacement masks in this checked fixture</caption><thead><tr><th scope="col">Edge</th><th scope="col">Aborted-round mask</th><th scope="col">Replacement mask</th><th scope="col">Different?</th></tr></thead><tbody></tbody>';
  for (const mask of evidence.reformedMasks) {
    const row = maskTable.tBodies[0].insertRow();
    const edge = document.createElement("th");
    edge.scope = "row";
    edge.append(textClaim("reformed-edge", mask.edgeId));
    const previous = row.insertCell();
    previous.append(codeClaim("reformed-old-mask", mask.previousMask));
    const replacement = row.insertCell();
    replacement.append(codeClaim("reformed-new-mask", mask.newMask));
    const changed = row.insertCell();
    changed.append(textClaim("reformed-mask-different", mask.different));
    row.prepend(edge);
  }
  const allReplaced = document.createElement("p");
  allReplaced.append(
    "Every retained edge value was replaced rather than repeated: ",
    textClaim("reformed-masks-replaced", evidence.reformedMasksReplaced),
    ".",
  );
  reformed.append(
    reformHeading,
    reformCopy,
    tableRegion("Reformed-round mask comparison", maskTable),
    allReplaced,
    verdict(
      "reformed-round",
      "pass",
      "REFORMED WITH NONREPEATED FIXTURE MASKS",
      "This checked fixture removes the absent member and replaces, rather than repeats, every retained-edge value. A real reformed round requires independently sampled, secret, one-use masks.",
    ),
  );
  output.replaceChildren(honest, malformed, jammer, dropout, reformed);
  output.dataset.stale = "false";
}

function commitmentCases(evidence: CommitmentEvidence): HTMLElement {
  const table = document.createElement("table");
  table.innerHTML =
    '<caption>Commit/reveal acceptance and refusal cases</caption><thead><tr><th scope="col">Case</th><th scope="col">Observed result</th><th scope="col">Meaning</th></tr></thead><tbody></tbody>';
  const rows: ReadonlyArray<readonly [string, string, boolean, string]> = [
    [
      "honest-reveal",
      "Unchanged reveal",
      evidence.honestRevealAccepted,
      "The contribution and complete committed context match.",
    ],
    [
      "changed-reveal",
      "Changed contribution",
      evidence.changedRevealRejected,
      "Under the stated SHA-256 collision and second-preimage resistance assumption, a participant cannot change its byte after every commitment is collected.",
    ],
    [
      "precommitted-jam",
      "Dishonest byte chosen before commitment",
      evidence.precommittedJamAccepted,
      "Assumed hash binding is not a proof that the DC-net equation was followed.",
    ],
    [
      "withheld-reveal",
      "Withheld reveal",
      evidence.withholdingAborted,
      "A commitment cannot force availability; the round aborts.",
    ],
  ];
  for (const [marker, label, result, meaning] of rows) {
    const row = table.tBodies[0].insertRow();
    const name = document.createElement("th");
    name.scope = "row";
    name.textContent = label;
    const outcome = row.insertCell();
    outcome.append(textClaim(`commit-${marker}`, result));
    const detail = row.insertCell();
    detail.textContent = meaning;
    row.prepend(name);
  }
  return tableRegion("Commit and reveal cases", table);
}

function renderCommitment(
  evidence: CommitmentEvidence,
  output: HTMLElement,
): void {
  const card = document.createElement("article");
  card.className = "evidence-card";
  const heading = document.createElement("h3");
  heading.textContent = "Commitment checks under stated hash assumptions";
  const digest = document.createElement("p");
  digest.className = "digest";
  digest.append(
    `Participant ${evidence.participant} commitment: `,
    codeClaim("commitment-digest", evidence.commitment),
  );
  const bound = document.createElement("p");
  bound.append(
    "Canonical encoding commits to: ",
    textClaim(
      "commitment-bound-fields",
      evidence.boundFields.join(","),
      evidence.boundFields.join(", "),
    ),
    ".",
  );
  const changed = document.createElement("p");
  changed.append(
    "Individually rejected context changes: ",
    textClaim(
      "commitment-context-rejections",
      evidence.rejectedContextChanges.join(","),
      evidence.rejectedContextChanges.join(", "),
    ),
    ".",
  );
  const limits = document.createElement("div");
  limits.className = "limits-note";
  limits.innerHTML =
    "<strong>Narrow result under the stated hash assumptions:</strong> collect-all-then-reveal blocks one adaptive last-speaker change. The 32-byte nonce raises exhaustive-opening cost; no formal hiding theorem is claimed. This does not authenticate labels, prove equation compliance, stop a precommitted jammer, force a reveal, or provide Dissent/Verdict-style blame.";
  card.append(
    heading,
    digest,
    bound,
    changed,
    commitmentCases(evidence),
    limits,
  );
  output.replaceChildren(card);
  output.dataset.stale = "false";
}

export function initializeDisruption(model: DcNetUiModel): void {
  const disruptionButton = required<HTMLButtonElement>("#disruption-button");
  const disruptionStatus = required<HTMLElement>("#disruption-status");
  const disruptionOutput = required<HTMLElement>("#disruption-output");
  const commitButton = required<HTMLButtonElement>("#commit-button");
  const commitStatus = required<HTMLElement>("#commit-status");
  const commitOutput = required<HTMLElement>("#commit-output");

  disruptionButton.addEventListener("click", () => {
    renderDisruption(model.disruption(), disruptionOutput);
    disruptionStatus.textContent =
      "Malformed, shaped-jammer, missing-participant, and reformed-round evidence is current.";
  });

  commitButton.addEventListener("click", async () => {
    commitButton.disabled = true;
    commitStatus.textContent =
      "Computing SHA-256 commitments and reveal cases…";
    commitOutput.dataset.stale = "true";
    try {
      const evidence = await model.commitments();
      renderCommitment(evidence, commitOutput);
      commitStatus.textContent =
        "Commit/reveal evidence is current; the digest and all failure cases were recomputed.";
    } catch (error) {
      commitStatus.textContent = `Commit/reveal computation failed: ${
        error instanceof Error ? error.message : "unknown error"
      }`;
    } finally {
      commitButton.disabled = false;
    }
  });

  renderDisruption(model.disruption(), disruptionOutput);
  disruptionStatus.textContent = "Disruption evidence is current.";
}
