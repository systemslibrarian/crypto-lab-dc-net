import { initializeCollisions } from "./collisions";
import { initializeDisruption } from "./disruption";
import { initializeReuse } from "./reuse";
import { initializeRound } from "./round";
import type { DcNetUiModel } from "./types";
import { initializeViews } from "./views";

type PanelId = "round" | "views" | "collisions" | "disruption" | "reuse";

function mountStaticLesson(): void {
  const app = document.querySelector<HTMLDivElement>("#app");
  if (!app) throw new Error("application root is missing");
  app.innerHTML = `
    <main id="main-content" tabindex="-1">
      <header class="cl-hero" role="group">
        <div class="cl-hero-main">
          <p class="eyebrow">ONE PUBLIC XOR, ONE HIDDEN SENDER</p>
          <h1 class="cl-hero-title">DC-net</h1>
          <p class="cl-hero-sub">Dining cryptographers · anonymous broadcast · XOR masks</p>
          <p class="cl-hero-desc">Give every neighboring pair one fresh shared mask, XOR each participant’s masks into one public contribution, and watch every mask cancel without naming the sender.</p>
        </div>
        <aside class="cl-hero-why" aria-label="Why it matters">
          <span class="cl-hero-why-label">WHY IT MATTERS</span>
          <p class="cl-hero-why-text">A DC-net can hide who sent a bit without hiding the bit itself. The same algebra also makes collisions ambiguous, disruption cheap, and mask reuse catastrophic.</p>
        </aside>
      </header>

      <section class="orientation" aria-labelledby="orientation-heading">
        <p class="exhibit-number">Orientation</p>
        <h2 id="orientation-heading">The masks vanish; the inputs remain</h2>
        <div class="equation" role="img" aria-label="Each broadcast is the participant input XOR every incident edge mask. XORing every broadcast cancels each edge mask twice and leaves the XOR of participant inputs.">
          <code>broadcastᵢ = inputᵢ ⊕ incident masks</code>
          <svg class="equation-arrow" aria-hidden="true" focusable="false" viewBox="0 0 24 16">
            <path d="M2 8h18M14 2l6 6-6 6"></path>
          </svg>
          <code>⊕ broadcasts = ⊕ inputs</code>
        </div>
        <p>The key graph below is a five-participant cycle: A–B–C–D–E–A. It says who shares a mask with whom; it is not a transport path. The default checked fixture gives D the byte <code>48</code> and everyone else <code>00</code>.</p>
      </section>

      <aside class="scope-banner">
        <strong>Bounded teaching model.</strong> The XOR mechanism and SHA-256 commitments execute in this browser. Information-theoretic anonymity is conditional on independent, uniformly random, secret, one-use pairwise masks. WebCrypto supplies a pseudorandom teaching stand-in, and every modeled role still runs in one JavaScript origin.
      </aside>

      <nav class="act-nav" aria-label="DC-net exhibits">
        <div class="tab-list" role="tablist" aria-label="DC-net exhibits">
          <button id="tab-round" class="tab active" type="button" role="tab" aria-selected="true" aria-controls="panel-round" data-panel="round"><span aria-hidden="true">01</span> Fresh round</button>
          <button id="tab-views" class="tab" type="button" role="tab" aria-selected="false" aria-controls="panel-views" data-panel="views" tabindex="-1"><span aria-hidden="true">02</span> Who remains possible?</button>
          <button id="tab-collisions" class="tab" type="button" role="tab" aria-selected="false" aria-controls="panel-collisions" data-panel="collisions" tabindex="-1"><span aria-hidden="true">03</span> Collision parity</button>
          <button id="tab-disruption" class="tab" type="button" role="tab" aria-selected="false" aria-controls="panel-disruption" data-panel="disruption" tabindex="-1"><span aria-hidden="true">04</span> Disruption</button>
          <button id="tab-reuse" class="tab" type="button" role="tab" aria-selected="false" aria-controls="panel-reuse" data-panel="reuse" tabindex="-1"><span aria-hidden="true">05</span> Reuse and disclosure</button>
        </div>
      </nav>

      <section id="panel-round" class="act-panel" role="tabpanel" aria-labelledby="tab-round" tabindex="0">
        <div class="section-heading">
          <p class="exhibit-number">Exhibit 1</p>
          <h2>One sender, five broadcasts</h2>
          <p>Choose one sender and one message byte. A fresh run draws one byte for every edge; the checked fixture uses fixed masks so every displayed value can also be reproduced exactly.</p>
        </div>
        <form id="round-form" class="control-panel">
          <div class="field">
            <label for="round-sender">Sender</label>
            <select id="round-sender" name="sender">
              <option value="A">A</option><option value="B">B</option><option value="C">C</option><option value="D" selected>D</option><option value="E">E</option>
            </select>
          </div>
          <div class="field">
            <label for="round-message">One-byte message, hexadecimal</label>
            <input id="round-message" name="message" value="48" inputmode="text" maxlength="4" aria-describedby="round-message-help" />
            <p id="round-message-help" class="help">Enter exactly two hexadecimal digits, from 00 through ff.</p>
          </div>
          <div class="control-actions">
            <button type="submit" class="primary">Run with fresh masks</button>
            <button id="fixture-button" type="button" class="secondary">Load checked fixture</button>
          </div>
          <p id="round-status" class="status" role="status" aria-live="polite" aria-atomic="true"></p>
        </form>
        <div id="round-output" class="output" data-stale="true" aria-live="polite"></div>
      </section>

      <section id="panel-views" class="act-panel" role="tabpanel" aria-labelledby="tab-views" tabindex="0" hidden>
        <div class="section-heading">
          <p class="exhibit-number">Exhibit 2</p>
          <h2>What a coalition can narrow</h2>
          <p>Coalition members know their own inputs and every mask on an incident edge. Removing those known edges leaves honest components; XOR within each component reveals that component’s input parity.</p>
        </div>
        <div class="graph-and-controls">
          <figure class="key-graph" role="img" aria-labelledby="graph-caption">
            <div class="ring" aria-hidden="true">
              <span class="node node-a">A</span><span class="node node-b">B</span><span class="node node-c">C</span><span class="node node-d">D</span><span class="node node-e">E</span>
              <span class="edge edge-ab"></span><span class="edge edge-bc"></span><span class="edge edge-cd"></span><span class="edge edge-de"></span><span class="edge edge-ea"></span>
            </div>
            <figcaption id="graph-caption">Five-participant key-sharing cycle with edges AB, BC, CD, DE and EA. Lines represent shared masks, not network links.</figcaption>
          </figure>
          <form id="views-form" class="control-panel compact">
            <div class="field">
              <label for="coalition">Observer or coalition</label>
              <select id="coalition">
                <option value="">External observer</option>
                <option value="A">Participant A</option>
                <option value="A,B">Coalition A + B</option>
                <option value="A,C" selected>Coalition A + C</option>
              </select>
            </div>
            <fieldset>
              <legend>Exactly-one-sender prior</legend>
              <label><input type="radio" name="prior" value="uniform" checked /> Uniform weights</label>
              <label><input type="radio" name="prior" value="skewed" /> Skewed weights B:D:E = 4:3:1</label>
            </fieldset>
            <button type="submit" class="primary">Analyze this view</button>
            <p id="views-status" class="status" role="status" aria-live="polite" aria-atomic="true"></p>
          </form>
        </div>
        <div class="table-wrap graph-table" role="region" aria-label="Key-sharing graph edge list" tabindex="0">
          <table><caption>Accessible edge list for the key-sharing graph</caption><thead><tr><th scope="col">Edge</th><th scope="col">First endpoint</th><th scope="col">Second endpoint</th></tr></thead><tbody><tr><th scope="row">AB</th><td>A</td><td>B</td></tr><tr><th scope="row">BC</th><td>B</td><td>C</td></tr><tr><th scope="row">CD</th><td>C</td><td>D</td></tr><tr><th scope="row">DE</th><td>D</td><td>E</td></tr><tr><th scope="row">EA</th><td>E</td><td>A</td></tr></tbody></table>
        </div>
        <div id="views-output" class="output" data-stale="true" aria-live="polite"></div>
      </section>

      <section id="panel-collisions" class="act-panel" role="tabpanel" aria-labelledby="tab-collisions" tabindex="0" hidden>
        <div class="section-heading">
          <p class="exhibit-number">Exhibit 3</p>
          <h2>The output is parity, not a headcount</h2>
          <p>Each selected sender contributes bit 1. The public output says whether the number of 1 inputs is odd or even; it does not say how many participants sent.</p>
        </div>
        <form id="collision-form" class="control-panel compact">
          <fieldset>
            <legend>Number of simultaneous bit-1 senders</legend>
            <div class="segmented">
              <label><input type="radio" name="sender-count" value="0" /> 0</label>
              <label><input type="radio" name="sender-count" value="1" /> 1</label>
              <label><input type="radio" name="sender-count" value="2" checked /> 2</label>
              <label><input type="radio" name="sender-count" value="3" /> 3</label>
            </div>
          </fieldset>
          <button type="submit" class="primary">Run collision round</button>
          <p id="collision-status" class="status" role="status" aria-live="polite" aria-atomic="true"></p>
        </form>
        <div id="collision-output" class="output" data-stale="true" aria-live="polite"></div>
      </section>

      <section id="panel-disruption" class="act-panel" role="tabpanel" aria-labelledby="tab-disruption" tabindex="0" hidden>
        <div class="section-heading">
          <p class="exhibit-number">Exhibit 4</p>
          <h2>Shape checks are not honesty checks</h2>
          <p>Wrong-width data is malformed and can be refused. A valid-width dishonest broadcast is just another byte: classical DC-net algebra cannot identify it as a jam.</p>
        </div>
        <button id="disruption-button" type="button" class="primary">Run malformed, jammer and dropout cases</button>
        <p id="disruption-status" class="status" role="status" aria-live="polite" aria-atomic="true"></p>
        <div id="disruption-output" class="output" data-stale="true" aria-live="polite"></div>
        <section class="commit-section" aria-labelledby="commit-heading">
          <h3 id="commit-heading">Commit before reveal</h3>
          <p>Every participant first commits to its contribution, then reveals it. Under SHA-256 collision and second-preimage resistance, this bounded teaching adaptation binds the committed byte and context before the other reveals; it does not stop a participant from choosing a dishonest byte beforehand. The 32-byte nonce raises the cost of exhaustively testing possible openings, but this lab claims no formal hiding theorem.</p>
          <p class="limits-note"><strong>Comparison only:</strong> Dissent adds accountable group-messaging machinery, while Verdict uses verifiable contributions and zero-knowledge proofs. This hash commitment implements neither system and supplies no blame mechanism.</p>
          <button id="commit-button" type="button" class="secondary">Run commit/reveal cases</button>
          <p id="commit-status" class="status" role="status" aria-live="polite" aria-atomic="true"></p>
          <div id="commit-output" class="output" data-stale="true" aria-live="polite"></div>
        </section>
      </section>

      <section id="panel-reuse" class="act-panel" role="tabpanel" aria-labelledby="tab-reuse" tabindex="0" hidden>
        <div class="section-heading">
          <p class="exhibit-number">Exhibit 5</p>
          <h2>One-use masks mean one use</h2>
          <p>Reuse the same edge masks in two rounds and each participant’s two public broadcasts cancel those masks. A known-empty round then exposes every next input; later disclosure of all masks incident to one participant exposes that participant’s past input.</p>
        </div>
        <button id="reuse-button" type="button" class="primary">Reuse masks and recover inputs</button>
        <p id="reuse-status" class="status" role="status" aria-live="polite" aria-atomic="true"></p>
        <div id="reuse-output" class="output" data-stale="true" aria-live="polite"></div>
      </section>

      <section class="limits" aria-labelledby="limits-heading">
        <p class="exhibit-number">Assumptions and nonclaims</p>
        <h2 id="limits-heading">What this round does—and does not—establish</h2>
        <div class="limits-grid">
          <article><h3>Required assumptions</h3><ul><li>Every edge mask is independent, uniform, secret and used for one round only.</li><li>The declared membership and key-sharing graph are fixed before contributions.</li><li>Participants agree on one fixed contribution width and a synchronized round.</li><li>Any posterior shown uses the explicitly displayed exactly-one-sender hypothesis and prior weights.</li></ul></article>
          <article><h3>Not provided here</h3><ul><li>No message confidentiality: the aggregate message is deliberately public.</li><li>No source authentication, receiver anonymity, Sybil resistance or membership protocol.</li><li>No transport privacy; the key-sharing graph is not a network topology.</li><li>No collision resolution, sender accountability, guaranteed delivery or protection from a valid-shaped jammer.</li><li>No proof of secure erasure, constant-time execution or separate-role isolation in JavaScript.</li></ul></article>
        </div>
        <details>
          <summary>Primary sources, adaptation and comparisons</summary>
          <div class="detail-body">
            <p>The core XOR lesson and generalized key-sharing graph follow Chaum’s construction (§§1.1 and 1.3). The bounded exhaustive observer computation and SHA-256 commit/reveal comparison are teaching adaptations.</p>
            <ul>
              <li><a href="https://ir.cwi.nl/pub/2438">Chaum, “The Dining Cryptographers Problem: Unconditional Sender and Recipient Untraceability” (Journal of Cryptology, 1988)</a>; <a href="https://doi.org/10.1007/BF00206326">DOI 10.1007/BF00206326</a>.</li>
              <li><a href="https://bford.info/pub/net/dissent-abs/">Dissent (ACM CCS 2010)</a> combines scheduled DC-net runs with accountable group-messaging machinery. That machinery is a comparison, not a property of this lab.</li>
              <li><a href="https://www.usenix.org/conference/usenixsecurity13/technical-sessions/presentation/corrigan-gibbs">Verdict (USENIX Security 2013)</a> uses proactively verifiable DC-nets and zero-knowledge proofs to reject malformed contributions. This lab’s hash commitment supplies neither proof nor blame.</li>
              <li><a href="https://csrc.nist.gov/pubs/fips/180-4/upd1/final">FIPS 180-4, Secure Hash Standard</a> — SHA-256 used only for the bounded commitment comparison.</li>
              <li><a href="https://www.w3.org/TR/2017/REC-WebCryptoAPI-20170126/">W3C Web Cryptography API (2017 Recommendation)</a> — the concrete browser randomness and digest interface, not evidence of physical entropy or secure erasure.</li>
              <li><a href="https://systemslibrarian.github.io/crypto-lab-sphinx-mix/">Sphinx Mix</a> — traffic-model anonymity and mix-network packet formatting.</li>
              <li><a href="https://systemslibrarian.github.io/crypto-lab-blind-relay/">Blind Relay</a> — a different non-collusion boundary for source and content metadata.</li>
              <li><a href="https://systemslibrarian.github.io/crypto-lab-silent-tally/">Silent Tally</a> — private aggregation rather than anonymous public broadcast.</li>
            </ul>
          </div>
        </details>
      </section>
    </main>
    <footer class="scripture-footer">
      <p>So whether you eat or drink or whatever you do, do it all for the glory of God. — 1 Corinthians 10:31</p>
    </footer>
  `;
}

function wireTabs(): void {
  const tabs = Array.from(
    document.querySelectorAll<HTMLButtonElement>('[role="tab"][data-panel]'),
  );
  const select = (panel: PanelId): void => {
    for (const tab of tabs) {
      const active = tab.dataset.panel === panel;
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-selected", String(active));
      tab.tabIndex = active ? 0 : -1;
      const controlled = document.querySelector<HTMLElement>(
        `#panel-${tab.dataset.panel ?? ""}`,
      );
      if (controlled) controlled.hidden = !active;
    }
  };

  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => select(tab.dataset.panel as PanelId));
    tab.addEventListener("keydown", (event) => {
      let target: number;
      if (event.key === "ArrowRight") target = (index + 1) % tabs.length;
      else if (event.key === "ArrowLeft")
        target = (index - 1 + tabs.length) % tabs.length;
      else if (event.key === "Home") target = 0;
      else if (event.key === "End") target = tabs.length - 1;
      else return;
      event.preventDefault();
      const next = tabs[target];
      if (!next) return;
      select(next.dataset.panel as PanelId);
      next.focus();
    });
  });
}

export function initializeApp(model: DcNetUiModel): void {
  mountStaticLesson();
  wireTabs();
  initializeRound(model);
  initializeViews(model);
  initializeCollisions(model);
  initializeDisruption(model);
  initializeReuse(model);
}
