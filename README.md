# DC-net

## What It Is

DC-net is an executable lesson about the dining-cryptographers anonymous-broadcast protocol. Five participants share pairwise masks along a declared ring, publish one masked contribution each, and recover the XOR of their input messages without revealing which compatible participant supplied a lone nonzero message. The page computes every mask, contribution, aggregate, observer view, coalition view, collision, disruption, and mask-reuse result from the TypeScript implementation. An optional SHA-256 commit/reveal exercise is a separately labeled teaching adaptation for one narrow last-speaker problem; it is not a disruption-accountability protocol. This is a bounded browser model, not an anonymous messaging service.

### One DC-net round

For participant `v`, input bit vector `x_v`, and every pairwise mask `k_e` on an edge incident to `v`, the broadcast is:

```text
b_v = x_v XOR XOR(k_e for every edge e incident to v)
```

Every edge mask appears at both endpoints. XORing all broadcasts therefore cancels every mask twice:

```text
XOR(b_v for every v) = XOR(x_v for every v)
```

The honest path requires each edge mask to be independent, fresh, uniformly distributed in the ideal model, the same length as the message, and used for one round only. The browser obtains concrete masks from Web Crypto's cryptographically strong random source. That is a practical CSPRNG-backed execution, not experimental proof of the information-theoretic theorem. Unit tests separately enumerate every mask assignment in small fixtures and compare complete transcript distributions.

The output hides the sender under the stated graph and observer knowledge; it does not hide the message. With exactly one sender, the aggregate is that sender's message. With multiple simultaneous senders, the aggregate is their bitwise XOR.

### What an observer can infer

The key-sharing graph is public and is not the transport topology. To model an observer or coalition, remove the edges whose masks that observer knows. Each remaining connected component is an anonymity set, and the transcript reveals the XOR parity of the inputs in that component. Participants also know their own inputs, while coalition members pool their inputs and incident masks.

The default five-participant ring makes those distinctions executable:

- an outside observer that knows no masks sees one connected component containing all five participants;
- a single non-sender knows their own input and incident masks but cannot distinguish the other four connected participants; and
- coalition `{A, C}` removes its incident edges, isolates `B`, and leaves `D` connected to `E`; when `D` is the one sender, the compatible set is exactly `{D, E}`.

A “possible sender” result always depends on the declared exactly-one-sender assumption. With multiple senders, component parity is not a sender list. Equal transcript likelihoods also do not manufacture equal prior probabilities: the posterior renormalizes the priors supplied to the model and is uniform only when those priors were uniform.

## Exhibits

1. **Fresh masks cancel** runs a complete ring round, displays every input, edge mask, participant broadcast, and the independently checked aggregate.
2. **Who remains possible?** compares the outside observer, one participant, and a coalition by removing exactly the masks each view knows and deriving the remaining connected components and component parities.
3. **Collision and disruption** contrasts zero, one, two, and three simultaneous senders; malformed encodings; a correctly shaped arbitrary contribution; and a missing participant.
4. **Reuse and later disclosure** shows that reusing the same masks makes two public participant transcripts cancel to the XOR of that participant's two inputs, and that later disclosure of recorded-round masks can shrink or destroy past anonymity.
5. **Commit before reveal** hashes a canonically encoded session, round, participant, membership, graph, contribution length, contribution, and fresh 32-byte nonce before reveals begin, then tests changed and withheld reveals without claiming accountability.

## When to Use It

- Use it to inspect the classical DC-net cancellation mechanism, because the page exposes the real inputs, pairwise masks, participant broadcasts, and XOR aggregate.
- Use it for reasoning about observer and coalition knowledge, because anonymity sets are recomputed from the declared key graph rather than asserted in prose.
- Use it to study collisions, disruption, dropout, commitments, and mask reuse, because each limitation changes an executable result under a named assumption.
- Do not use it to carry real anonymous messages, because it is a demo app and does not provide hardened operational controls.

## Live Demo

Open [DC-net on GitHub Pages](https://systemslibrarian.github.io/crypto-lab-dc-net/). Run the honest round first, inspect the observer views, then compare collision, jammer, dropout, commitment, reuse, and disclosure cases.

## What Can Go Wrong

- A one-sender round reveals the message to everyone. DC-net protects compatible sender identity under its assumptions; it is not message encryption or receiver anonymity.
- An even number of `1` inputs aggregates to `0`, and an odd number aggregates to `1`. For longer messages, concurrent payloads XOR and can cancel, look corrupted, or accidentally look valid. Basic DC-net does not count senders or reliably detect collisions.
- A contribution with an unknown or duplicate participant label or the wrong length is malformed and is rejected by this lesson. A malicious participant can instead publish arbitrary bytes of the correct shape and jam the result without being identified by the basic protocol.
- Under SHA-256 collision and second-preimage resistance, the modeled commitment binds a participant label to the contribution and context encoded here. A fresh unpredictable 32-byte nonce raises the cost of enumerating the one-byte contribution before reveal; this lesson does not claim a formal hiding theorem. With all commitments collected before any reveal, it blocks one adaptive last-speaker strategy. It does not prove that the contribution follows the DC-net equation, stop a precommitted jammer, force a reveal, authenticate a participant, or provide Dissent/Verdict-style accountability.
- A missing participant makes incident masks appear only once, so the current round must abort. To continue without that participant, reform the membership and key graph and draw new masks; treating the absent contribution as zero corrupts the algebra.
- Reusing every mask incident to a participant exposes that participant's input XOR across the two transcripts. If one input is known to be empty, the other input is recovered directly.
- Recorded broadcasts can become more revealing if supposedly erased masks are disclosed later. JavaScript cannot prove erasure or prevent a participant from retaining key material.
- Coalition knowledge is graph-dependent. A cut set can split honest participants into smaller components, and a singleton component has no sender anonymity from that observer.
- All participants, observers, randomness, commitments, and attacks execute in one browser origin. The roles are views over one model, not process, hardware, transport, or trust isolation.
- The model supplies no production membership, Sybil defense, source authentication, transport privacy, availability, collision resolution, disruption accountability, durable state, or side-channel resistance.

See [SECURITY.md](SECURITY.md) and [docs/a-d-04-brief.md](docs/a-d-04-brief.md) for the precise model and acceptance mapping.

## Real-World Context

David Chaum's original construction uses one-time shared key bits for unconditional sender untraceability under its graph and observer assumptions, and discusses pseudorandom expansion as a computational alternative. The lesson keeps those cases distinct: its exhaustive finite model reasons about uniform one-use masks, while its interactive browser run uses Web Crypto randomness.

Dissent and Verdict address operational problems beyond this lesson. Dissent combines scheduled DC-net runs with accountable group messaging machinery; Verdict uses proactively verifiable DC-nets and zero-knowledge proofs to reject malformed contributions before disruption. They are comparisons here, not implemented protocols or properties inherited by the SHA-256 commitment exercise.

Primary sources:

- David Chaum, [The Dining Cryptographers Problem: Unconditional Sender and Recipient Untraceability](https://ir.cwi.nl/pub/2438), _Journal of Cryptology_ 1(1), 1988, pp. 65–75; [DOI 10.1007/BF00206326](https://doi.org/10.1007/BF00206326).
- Henry Corrigan-Gibbs and Bryan Ford, [Dissent: Accountable Anonymous Group Messaging](https://bford.info/pub/net/dissent-abs/), ACM CCS 2010.
- Henry Corrigan-Gibbs, David Isaac Wolinsky, and Bryan Ford, [Proactively Accountable Anonymous Messaging in Verdict](https://www.usenix.org/conference/usenixsecurity13/technical-sessions/presentation/corrigan-gibbs), USENIX Security 2013.
- NIST, [FIPS 180-4: Secure Hash Standard](https://csrc.nist.gov/pubs/fips/180-4/upd1/final), the SHA-256 definition used by the bounded commitment adaptation.
- W3C, [Web Cryptography API, 2017 Recommendation](https://www.w3.org/TR/2017/REC-WebCryptoAPI-20170126/), the browser interface used for random generation and SHA-256.

## How to Run Locally

Use Node.js 22.13 or newer within the 22.x line, Node.js 24.x, or Node.js 26 or newer. The lab has no runtime package dependency; its cryptographic random generation and SHA-256 commitment use the browser's Web Crypto implementation.

```sh
npm ci
npm run dev
```

The application is a static browser lesson with no backend, accounts, network peers, or persistent secrets.

## Related Demos

- [Sphinx Mix](https://systemslibrarian.github.io/crypto-lab-sphinx-mix/) executes packet construction and peeling under a different anonymity and traffic model.
- [Blind Relay](https://systemslibrarian.github.io/crypto-lab-blind-relay/) separates source identity and HTTP content across operators rather than using a DC-net key graph.
- [Silent Tally](https://systemslibrarian.github.io/crypto-lab-silent-tally/) privately aggregates Shamir-shared counts; its threshold and output goals are different from anonymous broadcast.

## Build & Verify

The unit suite covers graph validation, exact XOR cancellation, exhaustive small-graph transcript distributions, participant and coalition views, component parity, prior-preserving posteriors, collision parity, malformed and correctly shaped dishonest contributions, dropout, new-draw handling, exact full-assignment replay refusal, reuse, later disclosure, and commitment context/reveal failures. Browser claim tests independently parse and recompute learner-visible masks, broadcasts, aggregates, connected components, candidate sets, posteriors, and refusal states rather than trusting application labels.

Accessibility checks traverse the honest and adversarial states, fail on axe violations or incomplete results, verify text and non-text contrast, keyboard and live-region behavior, reduced motion, dark-theme behavior under both operating-system preferences, and 320/380/390/768/1440-pixel reflow. The mutation runner starts from a clean committed baseline, requires each concrete source mutation to change the production bundle and fail its named owning assertion, restores the exact source bytes, and proves the restored assertion again.

```sh
npm run format:check
npm run typecheck
npm run lint
npm run test:coverage
npm run build
npm audit --audit-level=high
npx playwright install chromium
npm run test:claims
npm run test:a11y
npm run test:mutations
```

`npm run ci` runs the static, unit, coverage, and production-build portion. The mutation command intentionally requires a clean committed tree. GitHub Actions requires both the application/browser gate and the independent clean-baseline mutation job before its least-privilege deployment jobs can publish GitHub Pages.

The lab is MIT licensed; see [LICENSE](LICENSE).

---

_One of the browser demos in the [Crypto Lab](https://crypto-lab.systemslibrarian.dev/) suite._

_"So whether you eat or drink or whatever you do, do it all for the glory of God." — 1 Corinthians 10:31_
