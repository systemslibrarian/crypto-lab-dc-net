import {
  codeClaim,
  required,
  setStale,
  tableRegion,
  textClaim,
  verdict,
} from "./dom";
import type {
  CoalitionEvidence,
  DcNetUiModel,
  ParticipantId,
  RoundEvidence,
} from "./types";

const UNIFORM_PRIORS: Readonly<Record<ParticipantId, bigint>> = {
  A: 1n,
  B: 1n,
  C: 1n,
  D: 1n,
  E: 1n,
};

const SKEWED_PRIORS: Readonly<Record<ParticipantId, bigint>> = {
  A: 1n,
  B: 4n,
  C: 1n,
  D: 3n,
  E: 1n,
};

function participantSet(ids: readonly ParticipantId[]): string {
  return ids.length === 0 ? "∅" : `{${ids.join(", ")}}`;
}

function publicView(round: RoundEvidence): HTMLElement {
  const card = document.createElement("article");
  card.className = "evidence-card public-view";
  card.dataset.view = "public";
  const heading = document.createElement("h3");
  heading.textContent = "Public observer";
  const copy = document.createElement("p");
  copy.textContent =
    "The outside observer receives the five broadcasts and the aggregate, but no edge mask or participant input.";
  const transcript = document.createElement("p");
  transcript.className = "code-line";
  round.participants.forEach((participant, index) => {
    if (index > 0) transcript.append(" · ");
    transcript.append(
      `${participant.id}=`,
      codeClaim("view-public-broadcast", participant.broadcast),
    );
  });
  const aggregate = document.createElement("p");
  aggregate.append(
    "Public aggregate: ",
    codeClaim("view-public-aggregate", round.aggregate),
  );
  card.append(heading, copy, transcript, aggregate);
  return card;
}

function coalitionKnowledge(
  round: RoundEvidence,
  evidence: CoalitionEvidence,
): HTMLElement {
  const card = document.createElement("article");
  card.className = "evidence-card coalition-view";
  card.dataset.view = "coalition";
  const heading = document.createElement("h3");
  heading.textContent = evidence.coalition.length
    ? `Coalition ${participantSet(evidence.coalition)}`
    : "External observer";
  const copy = document.createElement("p");
  copy.textContent = evidence.coalition.length
    ? "Members pool their own inputs and every mask on an incident edge. Those known terms are removed before the remaining honest components are computed."
    : "An external observer knows no input and no edge mask, so the full ring remains connected.";

  const known = document.createElement("p");
  known.append(
    "Known edge masks: ",
    textClaim(
      "coalition-known-edges",
      evidence.knownEdgeIds.join(","),
      evidence.knownEdgeIds.length ? evidence.knownEdgeIds.join(", ") : "none",
    ),
  );
  if (evidence.knownEdgeIds.length > 0) {
    const list = document.createElement("ul");
    list.className = "compact-list";
    for (const participantId of evidence.coalition) {
      const participant = round.participants.find(
        (candidate) => candidate.id === participantId,
      );
      if (!participant) continue;
      const item = document.createElement("li");
      item.dataset.secret = "coalition-known-input";
      item.append(
        `${participant.id} knows its own input = `,
        codeClaim("coalition-known-input", participant.input),
      );
      list.append(item);
    }
    for (const edgeId of evidence.knownEdgeIds) {
      const edge = round.edges.find((candidate) => candidate.id === edgeId);
      if (!edge) continue;
      const item = document.createElement("li");
      item.dataset.secret = "coalition-known-mask";
      item.append(
        `${edge.id} (${edge.left}–${edge.right}) = `,
        codeClaim("coalition-known-mask", edge.mask),
      );
      list.append(item);
    }
    card.append(heading, copy, known, list);
  } else {
    card.append(heading, copy, known);
  }
  return card;
}

function componentTable(evidence: CoalitionEvidence): HTMLElement {
  const table = document.createElement("table");
  table.innerHTML =
    '<caption>Honest components after removing coalition-known edges</caption><thead><tr><th scope="col">Component</th><th scope="col">Members</th><th scope="col">Revealed input XOR</th></tr></thead><tbody></tbody>';
  for (const [index, component] of evidence.honestComponents.entries()) {
    const row = table.tBodies[0].insertRow();
    const name = document.createElement("th");
    name.scope = "row";
    name.textContent = String(index + 1);
    const members = row.insertCell();
    members.append(
      textClaim(
        "coalition-component-members",
        component.members.join(","),
        participantSet(component.members),
      ),
    );
    const total = row.insertCell();
    total.append(codeClaim("coalition-component-total", component.aggregate));
    row.prepend(name);
  }
  return tableRegion("Honest coalition-view components", table);
}

function posteriorTable(evidence: CoalitionEvidence): HTMLElement {
  const table = document.createElement("table");
  table.innerHTML =
    '<caption>Posterior under the displayed exactly-one-sender prior</caption><thead><tr><th scope="col">Compatible sender</th><th scope="col">Prior weight</th><th scope="col">Posterior</th></tr></thead><tbody></tbody>';
  for (const entry of evidence.posterior) {
    const row = table.tBodies[0].insertRow();
    const participant = document.createElement("th");
    participant.scope = "row";
    participant.append(textClaim("coalition-candidate", entry.participant));
    const prior = row.insertCell();
    prior.append(textClaim("coalition-prior-weight", entry.priorWeight));
    const posterior = row.insertCell();
    const percentage =
      Number(
        (entry.posteriorNumerator * 10_000n) / entry.posteriorDenominator,
      ) / 100;
    posterior.append(
      textClaim(
        "coalition-posterior",
        `${entry.posteriorNumerator}/${entry.posteriorDenominator}`,
        `${entry.posteriorNumerator}/${entry.posteriorDenominator} (${percentage.toFixed(2)}%)`,
      ),
    );
    row.prepend(participant);
  }
  return tableRegion("Exactly-one-sender posterior", table);
}

function render(
  round: RoundEvidence,
  evidence: CoalitionEvidence,
  output: HTMLElement,
): void {
  const inference = document.createElement("section");
  inference.className = "evidence-card inference-view";
  const heading = document.createElement("h3");
  heading.textContent = "Component inference";
  const condition = document.createElement("p");
  condition.className = "assumption-callout";
  const conditionHeading = document.createElement("strong");
  conditionHeading.textContent = "Conditional question: ";
  condition.append(
    conditionHeading,
    "assume exactly one non-coalition participant supplied the nonzero byte ",
    codeClaim("coalition-exact-one-payload", round.aggregate),
    ". Without this assumption, the component XORs below are not a sender list.",
  );
  const candidateLine = document.createElement("p");
  candidateLine.append(
    "Compatible senders: ",
    textClaim(
      "coalition-candidates",
      evidence.candidates.join(","),
      participantSet(evidence.candidates),
    ),
  );
  const enumeration = document.createElement("p");
  enumeration.append(
    "Exhaustive one-bit masks checked per candidate view: ",
    textClaim("coalition-enumerated-worlds", evidence.enumeratedWorlds),
    ".",
  );
  const checked = evidence.exhaustiveAgreement
    ? verdict(
        "coalition-exhaustive-agreement",
        "pass",
        "VIEW DISTRIBUTIONS AGREE",
        "Every compatible sender hypothesis produced the same bounded public-and-coalition view distribution over all one-bit edge masks.",
      )
    : verdict(
        "coalition-exhaustive-agreement",
        "alarm",
        "VIEW DISTRIBUTIONS DIFFER",
        "At least one claimed-compatible sender hypothesis produced a different observer-view distribution.",
      );
  inference.append(
    heading,
    condition,
    componentTable(evidence),
    candidateLine,
    posteriorTable(evidence),
    enumeration,
    checked,
  );
  output.replaceChildren(
    publicView(round),
    coalitionKnowledge(round, evidence),
    inference,
  );
  output.dataset.stale = "false";
}

export function initializeViews(model: DcNetUiModel): void {
  const form = required<HTMLFormElement>("#views-form");
  const coalition = required<HTMLSelectElement>("#coalition");
  const status = required<HTMLElement>("#views-status");
  const output = required<HTMLElement>("#views-output");
  const round = model.fixtureRound();
  let lastSignature = "A,C:uniform";

  const signature = (): string => {
    const prior = form.querySelector<HTMLInputElement>(
      'input[name="prior"]:checked',
    );
    return `${coalition.value}:${prior?.value ?? ""}`;
  };
  const selectedCoalition = (): ParticipantId[] =>
    coalition.value === ""
      ? []
      : (coalition.value.split(",") as ParticipantId[]);
  const selectedPriors = (): Readonly<Record<ParticipantId, bigint>> =>
    form.querySelector<HTMLInputElement>('input[name="prior"]:checked')
      ?.value === "skewed"
      ? SKEWED_PRIORS
      : UNIFORM_PRIORS;
  const run = (): void => {
    const evidence = model.analyzeCoalition(
      round,
      selectedCoalition(),
      selectedPriors(),
    );
    render(round, evidence, output);
    lastSignature = signature();
    status.textContent = `Current view: ${
      evidence.coalition.length
        ? `coalition ${participantSet(evidence.coalition)}`
        : "external observer"
    }; ${evidence.honestComponents.length} honest component${
      evidence.honestComponents.length === 1 ? "" : "s"
    }.`;
  };
  const retire = (): void =>
    setStale(output, status, signature() !== lastSignature);

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    run();
  });
  coalition.addEventListener("change", retire);
  for (const input of form.querySelectorAll<HTMLInputElement>(
    'input[name="prior"]',
  )) {
    input.addEventListener("change", retire);
  }

  run();
}
