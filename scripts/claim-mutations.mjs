#!/usr/bin/env node
/**
 * Source-mutation gate for DC-net's central learner-visible claims.
 *
 * Run only from a clean commit. The runner proves the unmodified unit/browser
 * baseline first, changes exactly one source file at a time, requires the
 * owning assertion to fail normally, restores the exact saved bytes, and
 * re-proves that assertion. Evidence is written below ignored test-results/.
 */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RESULT_ROOT = path.join(ROOT, "test-results", "claim-mutations");
const HEAD = git(["rev-parse", "HEAD"]).trim();
const CHILD_ENV = { ...process.env, CI: "1", FORCE_COLOR: "0" };

const unit = (file, id) => ({
  program: "npx",
  args: ["--no-install", "vitest", "run", file, "-t", id, "--reporter=verbose"],
  assertion: id,
});
const browser = (id) => ({
  program: "npx",
  args: [
    "--no-install",
    "playwright",
    "test",
    "claims.spec.ts",
    "--grep",
    id,
    "--workers=1",
    "--retries=0",
    "--reporter=line",
  ],
  assertion: id,
});

const MUTATIONS = [
  {
    id: "AD04-M01",
    finding:
      "Every participant broadcast must include every incident edge mask.",
    file: "src/dcnet/round.ts",
    anchor: "      ...edges.map((edge) => edgeMasks.get(edge.id)!),",
    replacement:
      "      ...edges.slice(0, 1).map((edge) => edgeMasks.get(edge.id)!),",
    target: unit(
      "src/dcnet/round.test.ts",
      "exhaustively cancels all 32 masks for all 32 one-bit input vectors",
    ),
  },
  {
    id: "AD04-M02",
    finding: "The public aggregate must include every declared participant.",
    file: "src/dcnet/round.ts",
    anchor:
      "    ...graph.participants.map((participant) => broadcasts.get(participant)!),",
    replacement:
      "    ...graph.participants.slice(0, -1).map((participant) => broadcasts.get(participant)!),",
    target: unit(
      "src/dcnet/round.test.ts",
      "matches the reviewed five-cycle fixture",
    ),
  },
  {
    id: "AD04-M03",
    finding:
      "A coalition knows every edge incident to either coalition member.",
    file: "src/dcnet/view.ts",
    anchor: `  const knownEdges = round.graph.edges.filter(
    (edge) => coalitionSet.has(edge.left) || coalitionSet.has(edge.right),
  );`,
    replacement: `  const knownEdges = round.graph.edges.filter(
    (edge) => coalitionSet.has(edge.left) && coalitionSet.has(edge.right),
  );`,
    target: unit(
      "src/dcnet/view.test.ts",
      "derives the separating coalition's known edges and exact honest totals",
    ),
  },
  {
    id: "AD04-M04",
    finding:
      "Compatible sender posteriors must renormalize candidate prior mass, not assume the original total remains possible.",
    file: "src/dcnet/view.ts",
    anchor:
      "      posterior: candidateSet.has(participant) ? weight / candidateMass : 0,",
    replacement:
      "      posterior: candidateSet.has(participant) ? weight / totalPrior : 0,",
    target: unit(
      "src/dcnet/view.test.ts",
      "derives the separating coalition's known edges and exact honest totals",
    ),
  },
  {
    id: "AD04-M05",
    finding: "The one-bit output is sender parity, not an off-by-one count.",
    file: "src/dcnet/round.ts",
    anchor:
      "    oneBitParity: isOneBitModel ? ((senderIds.length % 2) as 0 | 1) : null,",
    replacement:
      "    oneBitParity: isOneBitModel ? (((senderIds.length + 1) % 2) as 0 | 1) : null,",
    target: unit(
      "src/dcnet/round.test.ts",
      "reports parity rather than pretending to learn the sender count",
    ),
  },
  {
    id: "AD04-M06",
    finding:
      "The honest path must remember accepted mask assignments and refuse exact reuse.",
    file: "src/dcnet/round.ts",
    anchor: "    this.#maskAssignments.add(fingerprint);",
    replacement: "    void fingerprint;",
    target: unit(
      "src/dcnet/failures.test.ts",
      "refuses a duplicate round identifier and an exactly repeated mask assignment",
    ),
  },
  {
    id: "AD04-M07",
    finding:
      "Known-empty recovery is valid only when every edge mask was reused.",
    file: "src/dcnet/failures.ts",
    anchor: "    allMasksReused && firstRoundKnownEmpty",
    replacement: "    firstRoundKnownEmpty",
    target: unit(
      "src/dcnet/failures.test.ts",
      "distinguishes partial reuse and a distinct-mask control from the all-mask identity",
    ),
  },
  {
    id: "AD04-M08",
    finding:
      "A dropout boundary contains edges with exactly one missing endpoint.",
    file: "src/dcnet/failures.ts",
    anchor:
      "    (edge) => missingSet.has(edge.left) !== missingSet.has(edge.right),",
    replacement:
      "    (edge) => missingSet.has(edge.left) === missingSet.has(edge.right),",
    target: unit(
      "src/dcnet/failures.test.ts",
      "aborts instead of substituting zero and exposes the exact boundary term",
    ),
  },
  {
    id: "AD04-M09",
    finding:
      "The commitment's independently checked versioned domain separator must remain bound.",
    file: "src/dcnet/commitment.ts",
    anchor:
      'const COMMITMENT_DOMAIN = "crypto-lab-dc-net/contribution-commitment/v1";',
    replacement:
      'const COMMITMENT_DOMAIN = "crypto-lab-dc-net/contribution-commitment/v0";',
    target: unit(
      "src/dcnet/commitment.test.ts",
      "matches an independently framed Node SHA-256 reference",
    ),
  },
  {
    id: "AD04-M10",
    finding:
      "Commitment verification must recompute and compare the complete opening.",
    file: "src/dcnet/commitment.ts",
    anchor: "  return equalBytes(commitment, await sha256(payload));",
    replacement: "  return commitment.length === COMMITMENT_DIGEST_BYTES;",
    target: unit(
      "src/dcnet/commitment.test.ts",
      "binds every session, round, graph, participant, contribution, length, and nonce field",
    ),
  },
  {
    id: "AD04-M11",
    finding: "No reveal phase may begin until every commitment is present.",
    file: "src/dcnet/commitment.ts",
    anchor: `    const missing = this.#missingFrom(this.#commitments);
    if (missing.length > 0) {
      this.#abort("missing-commitments", missing);
      return { status: "aborted", reason: "missing-commitments", missing };
    }`,
    replacement: `    const missing = this.#missingFrom(this.#commitments);
    if (missing.length < 0) {
      this.#abort("missing-commitments", missing);
      return { status: "aborted", reason: "missing-commitments", missing };
    }`,
    target: unit(
      "src/dcnet/commitment.test.ts",
      "rejects missing, duplicate, unknown, and malformed commitments",
    ),
  },
  {
    id: "AD04-M12",
    finding: "A reveal submitted during the commit phase must abort as early.",
    file: "src/dcnet/commitment.ts",
    anchor:
      '    if (this.#phase === "commit") return this.#abort("early-reveal");',
    replacement:
      '    if (this.#phase === "complete") return this.#abort("early-reveal");',
    target: unit(
      "src/dcnet/commitment.test.ts",
      "rejects early, unknown, duplicate, wrong-width, and invalid reveals",
    ),
  },
  {
    id: "AD04-M13",
    finding:
      "Later disclosure recovers an individual input only for a singleton residual component.",
    file: "src/dcnet/view.ts",
    anchor: "    if (component.participants.length === 1) {",
    replacement: "    if (component.participants.length > 1) {",
    target: unit(
      "src/dcnet/view.test.ts",
      "shrinks components and recovers only singleton inputs",
    ),
  },
  {
    id: "AD04-M14",
    finding:
      "The core shaped-jam result must expose the changed aggregate rather than the honest aggregate.",
    file: "src/dcnet/round.ts",
    anchor: "    jammedAggregate: aggregation.aggregate,",
    replacement: "    jammedAggregate: copyBytes(round.aggregate),",
    target: unit(
      "src/dcnet/round.test.ts",
      "accepts every correct-width share without claiming it is honest",
    ),
  },
  {
    id: "AD04-M15",
    finding:
      "Restoring the last computed round input must restore current evidence instead of leaving it falsely stale.",
    file: "src/ui/round.ts",
    anchor: "    setStale(output, status, signature() !== lastSignature);",
    replacement: "    setStale(output, status, true);",
    target: browser(
      "input freshness distinguishes changes, no-ops, restoration, and rejection",
    ),
  },
  {
    id: "AD04-M16",
    finding:
      "The learner-visible shaped-jammer evidence must report the changed aggregate.",
    file: "src/ui/model-adapter.ts",
    anchor:
      "      changedAggregate: !equalBytes(jam.honestAggregate, jam.jammedAggregate),",
    replacement: "      changedAggregate: false,",
    target: browser(
      "malformation, shaped jamming, dropout, and reformation stay distinct",
    ),
  },
  {
    id: "AD04-M17",
    finding:
      "The deterministic reformation fixture must verify that every retained-edge value was replaced rather than replayed.",
    file: "src/ui/model-adapter.ts",
    anchor: `    reformedMasksReplaced: reformedRound.graph.edges.every(
      (edge) =>
        !equalBytes(
          round.edgeMasks.get(edge.id)!,
          reformedRound.edgeMasks.get(edge.id)!,
        ),
    ),`,
    replacement: "    reformedMasksReplaced: false,",
    target: browser(
      "malformation, shaped jamming, dropout, and reformation stay distinct",
    ),
  },
  {
    id: "AD04-M18",
    finding:
      "The repeated-mask table must expose actual equality across both attack rounds.",
    file: "src/ui/reuse.ts",
    anchor: "        equalBytes(firstEdge.mask, secondEdge.mask),",
    replacement: "        false,",
    target: browser(
      "mask reuse and later disclosure independently recover the displayed inputs",
    ),
  },
  {
    id: "AD04-M19",
    finding:
      "The learner UI must retain the complete source-authentication and membership nonclaim.",
    file: "src/ui/app.ts",
    anchor:
      "<li>No source authentication, receiver anonymity, Sybil resistance or membership protocol.</li>",
    replacement: "<li>No source authentication.</li>",
    target: browser(
      "visible limits and primary comparisons do not overstate the model",
    ),
  },
  {
    id: "AD04-M20",
    finding:
      "The learner source list must retain the reviewed dated 2017 W3C Recommendation URL.",
    file: "src/ui/app.ts",
    anchor: "https://www.w3.org/TR/2017/REC-WebCryptoAPI-20170126/",
    replacement: "https://www.w3.org/TR/WebCryptoAPI/",
    target: browser(
      "visible limits and primary comparisons do not overstate the model",
    ),
  },
  {
    id: "AD04-M21",
    finding:
      "The learner-visible commitment context must include ordered membership.",
    file: "src/ui/model-adapter.ts",
    anchor: '      "ordered membership",',
    replacement: '      "membership",',
    target: browser(
      "commitments bind the complete stated context but not honest behavior",
    ),
  },
  {
    id: "AD04-M22",
    finding:
      "Commitments must bind the declared participant order rather than silently treating membership as a sorted set.",
    file: "src/dcnet/commitment.ts",
    anchor: "  const participants = graph.participants;",
    replacement:
      "  const participants = [...graph.participants].sort(compareText);",
    target: unit(
      "src/dcnet/commitment.test.ts",
      "canonicalizes edge order and orientation but binds ordered membership",
    ),
  },
];

function git(args) {
  const result = spawnSync("git", ["-C", ROOT, ...args], {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  }
  return result.stdout;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function occurrences(text, anchor) {
  return text.split(anchor).length - 1;
}

function assertClean() {
  if (git(["rev-parse", "HEAD"]).trim() !== HEAD) {
    throw new Error("HEAD moved during the mutation run");
  }
  const status = git(["status", "--porcelain=v1", "--untracked-files=all"]);
  if (status !== "")
    throw new Error(`working tree is not clean: ${status.trim()}`);
}

function run(label, program, args, timeout = 300_000) {
  const startedAt = new Date().toISOString();
  const result = spawnSync(program, args, {
    cwd: ROOT,
    env: CHILD_ENV,
    encoding: "utf8",
    maxBuffer: 40 * 1024 * 1024,
    timeout,
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  return {
    label,
    program,
    args,
    startedAt,
    finishedAt: new Date().toISOString(),
    status: result.status,
    signal: result.signal,
    error: result.error?.message,
    output,
  };
}

function mustPass(result) {
  if (result.status !== 0 || result.signal || result.error) {
    throw new Error(`${result.label} failed\n${result.output}`);
  }
}

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function bundleDigest() {
  const directory = path.join(ROOT, "dist", "assets");
  const files = fs
    .readdirSync(directory)
    .filter((name) => name.endsWith(".js"))
    .sort();
  if (files.length === 0)
    throw new Error("build produced no JavaScript bundle");
  return sha256(
    files
      .map((name) => fs.readFileSync(path.join(directory, name)))
      .reduce(
        (joined, bytes) => Buffer.concat([joined, bytes]),
        Buffer.alloc(0),
      ),
  );
}

function build(label) {
  const result = run(label, "npm", ["run", "build"]);
  mustPass(result);
  return { command: result, digest: bundleDigest() };
}

function targetFailureIsOwned(result, mutation) {
  const { id, target } = mutation;
  if (result.status === 0) return false;
  if (result.status !== 1 || result.signal || result.error) {
    throw new Error(
      `${id}: target did not end in an ordinary test failure\n${result.output}`,
    );
  }
  if (
    /browserType\.launch|Executable doesn't exist|ERR_CONNECTION|ECONNREFUSED|EADDRINUSE|Target page, context or browser has been closed|Test timeout/i.test(
      result.output,
    )
  ) {
    throw new Error(
      `${id}: infrastructure failure is not a caught mutation\n${result.output}`,
    );
  }
  if (
    !result.output.includes(target.assertion) ||
    !/AssertionError|expect\(|Expected:|Received:|Assertion/i.test(
      result.output,
    )
  ) {
    throw new Error(
      `${id}: failure was not owned by the named assertion\n${result.output}`,
    );
  }
  return true;
}

function compact(result) {
  return {
    label: result.label,
    program: result.program,
    args: result.args,
    startedAt: result.startedAt,
    finishedAt: result.finishedAt,
    status: result.status,
    signal: result.signal,
    error: result.error,
    outputSha256: sha256(result.output),
    outputTail: result.output.slice(-4000),
  };
}

function main() {
  if (process.argv.length !== 2) {
    throw new Error(
      "Usage: node scripts/claim-mutations.mjs (commit real work first)",
    );
  }
  if (
    fs.realpathSync(git(["rev-parse", "--show-toplevel"]).trim()) !==
    fs.realpathSync(ROOT)
  ) {
    throw new Error("run this script from its own repository");
  }
  assertClean();
  fs.mkdirSync(RESULT_ROOT, { recursive: true });
  const runDirectory = path.join(
    RESULT_ROOT,
    `${new Date().toISOString().replaceAll(/[:.]/g, "-")}-${process.pid}`,
  );
  fs.mkdirSync(runDirectory);
  const report = {
    schemaVersion: 1,
    head: HEAD,
    startedAt: new Date().toISOString(),
    baseline: {},
    mutations: [],
    status: "RUNNING",
  };
  const save = () => {
    fs.mkdirSync(runDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(runDirectory, "report.json"),
      `${JSON.stringify(report, null, 2)}\n`,
    );
  };

  for (const mutation of MUTATIONS) {
    const bytes = fs.readFileSync(path.join(ROOT, mutation.file));
    const text = bytes.toString("utf8");
    if (
      occurrences(text, mutation.anchor) !== 1 ||
      mutation.anchor === mutation.replacement
    ) {
      throw new Error(
        `${mutation.id}: anchor must occur exactly once in ${mutation.file}`,
      );
    }
    const committed = git(["show", `HEAD:${mutation.file}`]);
    if (!Buffer.from(committed).equals(bytes)) {
      throw new Error(`${mutation.file} differs from the committed baseline`);
    }
  }

  try {
    const baselineBuild = build("baseline build");
    const baselineUnit = run("baseline unit", "npm", ["test"]);
    mustPass(baselineUnit);
    const baselineBrowser = run(
      "baseline browser claims",
      "npm",
      ["run", "test:claims"],
      600_000,
    );
    mustPass(baselineBrowser);
    assertClean();
    report.baseline = {
      bundleSha256: baselineBuild.digest,
      build: compact(baselineBuild.command),
      unit: compact(baselineUnit),
      browser: compact(baselineBrowser),
      passed: true,
    };
    console.info("baseline: unmutated copy PASSES");
    save();

    for (const mutation of MUTATIONS) {
      const targetPath = path.join(ROOT, mutation.file);
      const original = fs.readFileSync(targetPath);
      const changed = Buffer.from(
        original
          .toString("utf8")
          .replace(mutation.anchor, mutation.replacement),
      );
      const evidence = {
        id: mutation.id,
        finding: mutation.finding,
        file: mutation.file,
        originalSha256: sha256(original),
        mutantSha256: sha256(changed),
        status: "RUNNING",
      };
      report.mutations.push(evidence);
      save();
      let mutationError;
      let restorationError;
      try {
        fs.writeFileSync(targetPath, changed);
        const dirty = git([
          "status",
          "--porcelain=v1",
          "--untracked-files=all",
        ]);
        if (dirty !== ` M ${mutation.file}\n`) {
          throw new Error(
            `${mutation.id}: mutation did not produce exactly one modified file: ${dirty}`,
          );
        }
        const mutantBuild = build(`${mutation.id} mutant build`);
        if (mutantBuild.digest === report.baseline.bundleSha256) {
          throw new Error(
            `${mutation.id}: source mutation did not change the browser bundle`,
          );
        }
        const result = run(
          `${mutation.id} owning test`,
          mutation.target.program,
          mutation.target.args,
          mutation.target.program === "npx" &&
            mutation.target.args.includes("playwright")
            ? 600_000
            : 300_000,
        );
        requireCondition(
          targetFailureIsOwned(result, mutation),
          `${mutation.id}: mutant survived its owning assertion`,
        );
        evidence.mutantBundleSha256 = mutantBuild.digest;
        evidence.build = compact(mutantBuild.command);
        evidence.owningTest = compact(result);
      } catch (error) {
        mutationError = error;
        evidence.error = error.message;
      } finally {
        try {
          fs.writeFileSync(targetPath, original);
          requireCondition(
            fs.readFileSync(targetPath).equals(original),
            `${mutation.id}: exact source restoration failed`,
          );
          const restoredBuild = build(`${mutation.id} restored build`);
          requireCondition(
            restoredBuild.digest === report.baseline.bundleSha256,
            `${mutation.id}: restored bundle differs from baseline`,
          );
          const restoredTarget = run(
            `${mutation.id} restored owning test`,
            mutation.target.program,
            mutation.target.args,
            mutation.target.program === "npx" &&
              mutation.target.args.includes("playwright")
              ? 600_000
              : 300_000,
          );
          mustPass(restoredTarget);
          assertClean();
          evidence.restoration = {
            sourceSha256: sha256(fs.readFileSync(targetPath)),
            bundleSha256: restoredBuild.digest,
            build: compact(restoredBuild.command),
            owningTest: compact(restoredTarget),
            passed: true,
          };
        } catch (error) {
          restorationError = error;
          evidence.restoration = { passed: false, error: error.message };
        }
      }
      if (restorationError) throw restorationError;
      if (mutationError) {
        evidence.status = "FAILED";
        save();
        throw mutationError;
      }
      evidence.status = "CAUGHT";
      console.info(`${mutation.id}: caught`);
      save();
    }

    report.status = "PASSED";
    report.finishedAt = new Date().toISOString();
    save();
    console.info(`all ${MUTATIONS.length} mutation(s) caught`);
    console.info(`evidence: ${path.join(runDirectory, "report.json")}`);
  } catch (error) {
    report.status = "FAILED";
    report.finishedAt = new Date().toISOString();
    report.error = error.message;
    save();
    console.error(`mutation gate FAILED: ${error.message}`);
    console.error(`evidence: ${path.join(runDirectory, "report.json")}`);
    process.exitCode = 1;
  }
}

main();
