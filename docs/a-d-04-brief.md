# A-D-04 implementation brief

## Roadmap target

Teach the classical dining-cryptographers network as an executable anonymous-broadcast mechanism. Compute pairwise fresh masks, participant broadcasts, cancellation, observer and coalition views, collisions, malformed and dishonest contributions, dropout, commitment limits, mask reuse, and later disclosure without collapsing those properties into one generic “anonymous” claim.

## Learner-facing identity

- **H1:** DC-net
- **Subtitle:** Dining cryptographers · anonymous broadcast · XOR masks
- **Accent:** `#65d9c5`
- **Live path:** `https://systemslibrarian.github.io/crypto-lab-dc-net/`
- **Local browser-test port:** `4231`

No visible emoji is required. The page must retain the standard Crypto Lab top bar, dark-theme contract, skip link, bounded hero, keyboard behavior, reduced-motion behavior, scripture footer, and narrow-screen reflow.

## Construction record

| Component             | Executable choice                                                                                              | Important boundary                                                                                                                                                                                                     |
| --------------------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Message space         | Equal-length byte vectors with bitwise XOR, equivalently vectors over `GF(2)`                                  | The aggregate is XOR, not an integer sum or sender count                                                                                                                                                               |
| Key graph             | Five-vertex cycle `A-B-C-D-E-A`                                                                                | This is the shared-mask graph, not the transport topology                                                                                                                                                              |
| Edge mask             | One equal-length vector shared by exactly the two endpoints                                                    | The ideal claim requires independent uniform one-use masks; browser randomness is a concrete CSPRNG-backed execution                                                                                                   |
| Participant broadcast | `b_v = x_v XOR XOR(k_e)` over all incident edges                                                               | Each honest edge mask must appear exactly twice in the complete round                                                                                                                                                  |
| Round aggregate       | XOR of every participant broadcast                                                                             | Equals XOR of participant inputs only for the complete declared membership and matching round                                                                                                                          |
| Observer view         | Remove every edge whose mask the observer knows, then compute connected components and their input parity      | Components are anonymity sets for that observer; parity is not a sender list without an exactly-one-sender assumption                                                                                                  |
| Posterior             | Retain compatible hypotheses and renormalize their declared priors                                             | Equal likelihood does not imply uniform prior or posterior                                                                                                                                                             |
| Commitment adaptation | Web Crypto SHA-256 over a domain-separated, length-framed canonical encoding plus a fresh random 32-byte nonce | Teaching layer whose binding relies on SHA-256 collision/second-preimage resistance; the secret nonce raises exhaustive-opening cost, but no formal hiding theorem, equation proof, or participant identity is claimed |
| Browser randomness    | `crypto.getRandomValues` behind an injectable byte-source boundary                                             | The browser API does not prove physical entropy, independence, erasure, or information-theoretic security                                                                                                              |

The protocol model has no runtime package dependency. SHA-256 and concrete random bytes come from Web Crypto. Tests use deterministic injected bytes and independent references; they must not test an implementation only against itself.

## Fixed honest transcript

The primary rendered fixture uses one byte so every value is independently inspectable:

| Edge or value               | Hex  |
| --------------------------- | ---- |
| `k_AB`                      | `3c` |
| `k_BC`                      | `a5` |
| `k_CD`                      | `7f` |
| `k_DE`                      | `11` |
| `k_EA`                      | `c2` |
| Inputs `x_A, x_B, x_C, x_E` | `00` |
| Sender input `x_D`          | `48` |

The implementation must derive, not hardcode, these broadcasts:

| Participant | Computation        | Broadcast |
| ----------- | ------------------ | --------- |
| `A`         | `00 XOR 3c XOR c2` | `fe`      |
| `B`         | `00 XOR 3c XOR a5` | `99`      |
| `C`         | `00 XOR a5 XOR 7f` | `da`      |
| `D`         | `48 XOR 7f XOR 11` | `26`      |
| `E`         | `00 XOR 11 XOR c2` | `d3`      |

The XOR of `fe,99,da,26,d3` is `48`, equal to the XOR of all five inputs. Tests must recompute both sides independently.

## Observer fixtures

The page keeps simulator state and observer knowledge separate.

1. **Outside observer:** knows no edge masks. The cycle remains connected, so `{A,B,C,D,E}` is one component whose input XOR is `48`.
2. **Participant A:** knows its own input plus `k_AB` and `k_EA`. Removing `AB` and `EA` isolates `A` and leaves path `B-C-D-E`; under the explicit one-sender-and-A-is-not-sender condition, the compatible set is `{B,C,D,E}`.
3. **Coalition `{A,C}`:** pools its inputs and masks on `AB,EA,BC,CD`. Removing those edges makes `B` a singleton and leaves the unknown edge `DE`. The coalition learns that `B` has even/zero input and that `{D,E}` has XOR `48`. Under exactly one sender, its compatible set is exactly `{D,E}`.
4. **Prior control:** assign unequal positive priors to `D` and `E`, then show that their equal transcript likelihoods preserve the prior ratio after normalization. Show 50/50 only in a separate uniform-prior control.

An exhaustive one-bit reference enumerates all `2^5` assignments of the ring's five unknown edge masks. For sender hypotheses with the same revealed component parity, their complete public-transcript histograms must be identical. A candidate in a different component-parity class must not be treated as indistinguishable.

## Required executable cases

### Honest cancellation

- Validate unique participant identifiers, unique undirected edges, no self-loop, known endpoints, connected default graph, equal input and mask lengths, exactly one mask per declared edge, and exactly one contribution per declared participant.
- Derive contributions from inputs and incident masks, then aggregate the actual contributions.
- Compare the aggregate with an independent direct XOR of inputs.
- Keep fresh generated masks and fixed audited fixtures as separate paths.

### Collisions

- Execute zero, one, two, and three simultaneous one-bit senders to produce parity `0,1,0,1`.
- Execute longer distinct payloads and show their bitwise XOR.
- Include identical-message cancellation and a distinct collision that produces a plausible byte, so the lesson never claims collisions are reliably detectable.
- Do not infer the sender count from aggregate parity.

### Malformation, jamming, and dropout

- Reject missing, duplicate, unknown-participant, and wrong-length contributions before producing an aggregate.
- Distinguish those malformed shapes from an arbitrary contribution with the correct participant label and length. Basic DC-net accepts the latter shape and its output is jammed without attribution.
- Abort on a missing participant. Never synthesize an absent zero contribution.
- Reform the membership/key graph and draw fresh masks before a later round; do not carry incident masks across a dropout.

### Commit before reveal

- Use a versioned domain separator and unambiguous length framing.
- Require exactly 32 bytes of fresh nonce material for each commitment.
- Bind the participant identifier, ordered membership, canonically ordered undirected key graph, session identifier, round identifier, contribution length, contribution, and fresh nonce.
- Collect every commitment before accepting any reveal.
- Reject changed contribution, nonce, participant, graph, membership, round, and length context.
- Show that a party that has not yet committed cannot use earlier reveals to choose a final contribution in the protected flow.
- Also execute a correctly opened but dishonest precommitted contribution and a withheld reveal. The first still jams; the second aborts. The commitment neither authenticates the participant label nor proves equation compliance.

### Mask reuse and later disclosure

- Deliberately bypass the honest round guard in a separately named attack helper; the guard detects duplicate round identifiers and exact complete-assignment replay, while the honest execution path separately requests new random draws.
- For each participant, compute `b_v[r] XOR b_v[s] = x_v[r] XOR x_v[s]` when the same incident masks are reused.
- Include a known-empty input in one round and recover that participant's other input directly.
- On the honest path, request a new random draw per edge, refuse duplicate round identifiers, and reject exact replay of a complete mask assignment. Describe that replay check precisely: comparing output bytes cannot prove that a random draw was independent.
- Starting from a recorded transcript, disclose masks after the round and recompute the observer graph. If every incident mask for one participant is disclosed, recover that participant's past input as `b_v XOR XOR(incident masks)`.
- State that JavaScript cannot prove key erasure and that retaining/disclosing masks is outside the theorem's one-time-secret assumption.

## Learner-visible nonclaims

The page and README must keep these statements visible:

- one-sender DC-net reveals the message and protects only compatible sender identity;
- no receiver anonymity or content encryption is provided;
- anonymity is relative to a declared key graph, observer knowledge, collusion, honest execution, and sender-count assumption;
- the key-sharing graph is not the transport topology;
- a browser CSPRNG execution is not empirical proof of ideal independent uniform masks;
- basic DC-net offers no collision resolution or disruption accountability;
- commit/reveal does not provide Dissent/Verdict's verifiable contributions or blame machinery;
- no source authentication, production membership, Sybil resistance, transport privacy, availability, durable erasure, persistent state, or side-channel resistance is implemented;
- all logical roles execute in one JavaScript origin with no isolation boundary.

## Acceptance evidence

- Unit tests cover all validators and negative cases, exact fixed-transcript values, direct input/contribution agreement, 0/1/2/3 sender parity, block collisions, exhaustive transcript histograms, observer/participant/coalition components and parity, nonuniform priors, correct-shaped jamming, dropout and reformation, commitment context binding, precommitted jamming, withholding, reuse, known-empty recovery, and later disclosure.
- Browser claim tests parse the rendered inputs, masks, contributions, aggregates, component memberships, component parities, compatible senders, posterior weights, commitments, and attack results and independently recompute them.
- Input changes retire every dependent result. A no-op does not falsely retire matching evidence, and rejected input never freshens older evidence.
- Accessibility checks drive every honest, attack, refusal, and disclosure state; fail on axe incomplete results as well as violations; check text and non-text contrast; preserve keyboard focus and live regions; honor reduced motion; and cover phone through desktop reflow.
- Coverage is enforced specifically for `src/dcnet/**` at 95% statements, 90% branches, 95% functions, and 95% lines.
- The clean-baseline mutation gate proves named assertions own mutations of the central cancellation, view, posterior, collision, commitment, reuse, dropout, retirement, and visible-limit claims, then restores exact source and bundle bytes.

## Primary anchors

- David Chaum, [The Dining Cryptographers Problem: Unconditional Sender and Recipient Untraceability](https://ir.cwi.nl/pub/2438), _Journal of Cryptology_ 1(1), 1988, pp. 65–75; [DOI 10.1007/BF00206326](https://doi.org/10.1007/BF00206326). Sections 1.1–1.4 anchor the graph, component, collusion, parity, and linear-system model; sections 2.1–2.4 anchor one-time versus pseudorandom keys, transport independence, and collision limits, while section 2.5 discusses commitment and disruption.
- Henry Corrigan-Gibbs and Bryan Ford, [Dissent: Accountable Anonymous Group Messaging](https://bford.info/pub/net/dissent-abs/), ACM CCS 2010. Comparison only.
- Henry Corrigan-Gibbs, David Isaac Wolinsky, and Bryan Ford, [Proactively Accountable Anonymous Messaging in Verdict](https://www.usenix.org/conference/usenixsecurity13/technical-sessions/presentation/corrigan-gibbs), USENIX Security 2013. Comparison only.
- NIST, [FIPS 180-4: Secure Hash Standard](https://csrc.nist.gov/pubs/fips/180-4/upd1/final). SHA-256 definition for the bounded commitment adaptation only.
- W3C, [Web Cryptography API, 2017 Recommendation](https://www.w3.org/TR/2017/REC-WebCryptoAPI-20170126/). Concrete browser interface, not a claim about physical randomness or erasure.

## Retained limitations

This is a static, all-in-one browser lesson with a five-person teaching graph and finite exhaustive checks. It does not establish an asymptotic security theorem by testing, implement Chaum's complete practical extensions, or transfer Dissent/Verdict accountability to the commitment adaptation. Its simulator can inspect all secrets solely to build evidence; learner-visible observer objects must contain only their declared knowledge. No real identity, network, authentication, secure storage, erasure, or adversarial process boundary exists.
