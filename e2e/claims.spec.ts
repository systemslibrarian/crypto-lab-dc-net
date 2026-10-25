import { expect, test, type Locator, type Page } from "@playwright/test";

const PARTICIPANTS = ["A", "B", "C", "D", "E"] as const;
const EDGES = [
  ["AB", "A", "B"],
  ["BC", "B", "C"],
  ["CD", "C", "D"],
  ["DE", "D", "E"],
  ["EA", "E", "A"],
] as const;
const FIXTURE_MASKS: Readonly<Record<string, number>> = {
  AB: 0x3c,
  BC: 0xa5,
  CD: 0x7f,
  DE: 0x11,
  EA: 0xc2,
};
const FIXTURE_BROADCASTS: Readonly<Record<string, number>> = {
  A: 0xfe,
  B: 0x99,
  C: 0xda,
  D: 0x26,
  E: 0xd3,
};

type ClaimRow = {
  heading: string;
  text: string;
  claims: Record<string, string[]>;
};

const pageErrors = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  pageErrors.set(page, errors);
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(`console.error: ${message.text()}`);
    }
  });
});

test.afterEach(async ({ page }) => {
  const errors = pageErrors.get(page) ?? [];
  expect(errors, errors.join("\n")).toEqual([]);
});

async function load(page: Page): Promise<void> {
  await page.goto(".");
  await expect(page).toHaveTitle("DC-net — crypto-lab");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("DC-net");
  await expect(page.locator("#round-output")).toHaveAttribute(
    "data-stale",
    "false",
  );
}

async function openPanel(page: Page, name: string): Promise<void> {
  const tab = page.locator(`#tab-${name}`);
  await tab.click();
  await expect(tab).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(`#panel-${name}`)).toBeVisible();
}

async function claimValues(root: Locator, marker: string): Promise<string[]> {
  return root
    .locator(`[data-claim="${marker}"]`)
    .evaluateAll((nodes) =>
      nodes.map((node) => (node as HTMLElement).dataset.value ?? ""),
    );
}

async function oneClaim(root: Locator, marker: string): Promise<string> {
  const values = await claimValues(root, marker);
  expect(values, `exactly one ${marker} claim`).toHaveLength(1);
  return values[0]!;
}

async function claimRows(table: Locator): Promise<ClaimRow[]> {
  return table.locator("tbody > tr").evaluateAll((rows) =>
    rows.map((row) => {
      const claims: Record<string, string[]> = {};
      for (const node of row.querySelectorAll<HTMLElement>("[data-claim]")) {
        const marker = node.dataset.claim ?? "";
        (claims[marker] ??= []).push(node.dataset.value ?? "");
      }
      return {
        heading: row.querySelector("th")?.textContent?.trim() ?? "",
        text: row.textContent?.replace(/\s+/g, " ").trim() ?? "",
        claims,
      };
    }),
  );
}

function parseByte(hex: string): number {
  expect(hex).toMatch(/^[0-9a-f]{2}$/);
  return Number.parseInt(hex, 16);
}

function xor(values: readonly number[]): number {
  return values.reduce((total, value) => total ^ value, 0);
}

function single(values: readonly string[] | undefined, marker: string): string {
  expect(values ?? [], `one ${marker} value in row`).toHaveLength(1);
  return values![0]!;
}

async function readRound(page: Page): Promise<{
  masks: Record<string, number>;
  inputs: Record<string, number>;
  broadcasts: Record<string, number>;
  computed: Record<string, number>;
  aggregate: number;
}> {
  const output = page.locator("#round-output");
  const publicRows = await claimRows(
    page.getByRole("table", {
      name: "One public fixed-width contribution per participant",
    }),
  );
  const maskRows = await claimRows(
    page.getByRole("table", {
      name: "Secret edge masks generated for this round",
    }),
  );
  const inputRows = await claimRows(
    page.getByRole("table", {
      name: "Input XOR incident masks equals the public broadcast",
    }),
  );
  const masks: Record<string, number> = {};
  const inputs: Record<string, number> = {};
  const broadcasts: Record<string, number> = {};
  const computed: Record<string, number> = {};

  for (const row of publicRows) {
    broadcasts[row.heading] = parseByte(
      single(row.claims["round-broadcast"], "round-broadcast"),
    );
  }
  for (const row of maskRows) {
    masks[row.heading] = parseByte(
      single(row.claims["edge-mask"], "edge-mask"),
    );
    expect(single(row.claims["mask-occurrences"], "mask-occurrences")).toBe(
      "2",
    );
  }
  for (const row of inputRows) {
    inputs[row.heading] = parseByte(
      single(row.claims["round-input"], "round-input"),
    );
    computed[row.heading] = parseByte(
      single(row.claims["computed-broadcast"], "computed-broadcast"),
    );
  }
  return {
    masks,
    inputs,
    broadcasts,
    computed,
    aggregate: parseByte(await oneClaim(output, "round-aggregate")),
  };
}

function independentlyCheckRound(
  round: Awaited<ReturnType<typeof readRound>>,
): void {
  expect(Object.keys(round.masks)).toEqual(EDGES.map(([id]) => id));
  expect(Object.keys(round.inputs)).toEqual(PARTICIPANTS);
  expect(Object.keys(round.broadcasts)).toEqual(PARTICIPANTS);

  for (const participant of PARTICIPANTS) {
    const incident = EDGES.filter(
      ([, left, right]) => left === participant || right === participant,
    ).map(([id]) => round.masks[id]!);
    const expected = xor([round.inputs[participant]!, ...incident]);
    expect(round.computed[participant]).toBe(expected);
    expect(round.broadcasts[participant]).toBe(expected);
  }
  expect(round.aggregate).toBe(
    xor(PARTICIPANTS.map((participant) => round.broadcasts[participant]!)),
  );
  expect(round.aggregate).toBe(
    xor(PARTICIPANTS.map((participant) => round.inputs[participant]!)),
  );
}

test.describe("DC-net learner-visible claims", () => {
  test("fixed transcript derives every mask, broadcast, and aggregate", async ({
    page,
  }) => {
    await load(page);
    const round = await readRound(page);

    expect(round.masks).toEqual(FIXTURE_MASKS);
    expect(round.inputs).toEqual({ A: 0, B: 0, C: 0, D: 0x48, E: 0 });
    expect(round.broadcasts).toEqual(FIXTURE_BROADCASTS);
    expect(round.computed).toEqual(FIXTURE_BROADCASTS);
    expect(round.aggregate).toBe(0x48);
    independentlyCheckRound(round);

    await expect(
      page.locator('[data-verdict="round-cancellation"]'),
    ).toHaveAttribute("data-result", "pass");
    await expect(page.locator('[data-claim="round-id"]')).toHaveAttribute(
      "data-value",
      "checked-round-48",
    );
  });

  test("public transcripts expose contributions but not simulator secrets", async ({
    page,
  }) => {
    await load(page);
    const publicRound = page.locator("#round-output [data-view=public]");
    await expect(publicRound).toHaveCount(1);
    await expect(publicRound.locator("[data-secret]")).toHaveCount(0);
    expect(
      await publicRound
        .locator("[data-claim]")
        .evaluateAll((nodes) =>
          nodes.map((node) => (node as HTMLElement).dataset.claim),
        ),
    ).toEqual([
      "round-id",
      "round-broadcast",
      "round-broadcast",
      "round-broadcast",
      "round-broadcast",
      "round-broadcast",
      "round-aggregate",
    ]);
    await expect(publicRound).toContainText(
      "This view contains no edge masks and no per-participant input bytes",
    );

    await openPanel(page, "views");
    const publicView = page.locator("#views-output [data-view=public]");
    await expect(publicView.locator("[data-secret]")).toHaveCount(0);
    await expect(
      publicView.locator('[data-claim="coalition-known-mask"]'),
    ).toHaveCount(0);

    await openPanel(page, "collisions");
    const publicCollision = page.locator(
      "#collision-output [data-view=public]",
    );
    await expect(publicCollision.locator("[data-secret]")).toHaveCount(0);
    await expect(
      publicCollision.locator('[data-claim="collision-input"]'),
    ).toHaveCount(0);
  });

  test("fresh browser rounds still satisfy independently recomputed equations", async ({
    page,
  }) => {
    await load(page);
    await page.locator("#round-sender").selectOption("B");
    await page.locator("#round-message").fill("a7");
    await page.getByRole("button", { name: "Run with fresh masks" }).click();
    await expect(page.locator("#round-output")).toHaveAttribute(
      "data-stale",
      "false",
    );

    const round = await readRound(page);
    expect(round.inputs).toEqual({ A: 0, B: 0xa7, C: 0, D: 0, E: 0 });
    expect(round.aggregate).toBe(0xa7);
    independentlyCheckRound(round);
    await expect(page.locator('[data-claim="round-id"]')).toHaveAttribute(
      "data-value",
      "fresh-browser-round-1",
    );
    await expect(page.locator("#round-status")).toContainText(
      "Fresh one-byte evidence computed",
    );
  });

  test("input freshness distinguishes changes, no-ops, restoration, and rejection", async ({
    page,
  }) => {
    await load(page);
    const output = page.locator("#round-output");
    const message = page.locator("#round-message");
    const originalAggregate = await oneClaim(output, "round-aggregate");

    await message.dispatchEvent("input");
    await expect(output).toHaveAttribute("data-stale", "false");
    await expect(page.locator("#round-status")).toContainText(
      "Inputs match the displayed evidence",
    );

    await message.fill("49");
    await expect(output).toHaveAttribute("data-stale", "true");
    await expect(page.locator("#round-status")).toContainText(
      "Displayed evidence is stale",
    );

    await message.fill("48");
    await expect(output).toHaveAttribute("data-stale", "false");

    await message.fill("gg");
    await page.getByRole("button", { name: "Run with fresh masks" }).click();
    await expect(output).toHaveAttribute("data-stale", "true");
    await expect(page.locator("#round-status")).toContainText(
      "Prior evidence remains stale",
    );
    expect(await oneClaim(output, "round-aggregate")).toBe(originalAggregate);

    await message.fill("48");
    await page.locator("#round-sender").dispatchEvent("change");
    await expect(output).toHaveAttribute("data-stale", "false");
    expect(await oneClaim(output, "round-aggregate")).toBe(originalAggregate);

    await openPanel(page, "views");
    const viewOutput = page.locator("#views-output");
    await page.locator("#coalition").dispatchEvent("change");
    await expect(viewOutput).toHaveAttribute("data-stale", "false");
    await page.locator("#coalition").selectOption("A");
    await expect(viewOutput).toHaveAttribute("data-stale", "true");
    await page.locator("#coalition").selectOption("A,C");
    await expect(viewOutput).toHaveAttribute("data-stale", "false");

    await openPanel(page, "collisions");
    const collisionOutput = page.locator("#collision-output");
    await page
      .locator('input[name="sender-count"][value="2"]')
      .dispatchEvent("change");
    await expect(collisionOutput).toHaveAttribute("data-stale", "false");
    await page.locator('input[name="sender-count"][value="3"]').check();
    await expect(collisionOutput).toHaveAttribute("data-stale", "true");
    await page.locator('input[name="sender-count"][value="2"]').check();
    await expect(collisionOutput).toHaveAttribute("data-stale", "false");
  });

  test("observer components, candidates, and priors match the five-cycle algebra", async ({
    page,
  }) => {
    await load(page);
    await openPanel(page, "views");
    const form = page.locator("#views-form");
    const output = page.locator("#views-output");

    const cases = [
      {
        coalition: "",
        known: "",
        components: [["A,B,C,D,E", "48"]],
        candidates: "A,B,C,D,E",
        denominator: "5",
      },
      {
        coalition: "A",
        known: "AB,EA",
        components: [["B,C,D,E", "48"]],
        candidates: "B,C,D,E",
        denominator: "4",
      },
      {
        coalition: "A,B",
        known: "AB,BC,EA",
        components: [["C,D,E", "48"]],
        candidates: "C,D,E",
        denominator: "3",
      },
      {
        coalition: "A,C",
        known: "AB,BC,CD,EA",
        components: [
          ["B", "00"],
          ["D,E", "48"],
        ],
        candidates: "D,E",
        denominator: "2",
      },
    ] as const;

    for (const scenario of cases) {
      await page.locator("#coalition").selectOption(scenario.coalition);
      await page.locator('input[name="prior"][value="uniform"]').check();
      await form.getByRole("button", { name: "Analyze this view" }).click();
      await expect(output).toHaveAttribute("data-stale", "false");
      expect(await oneClaim(output, "coalition-known-edges")).toBe(
        scenario.known,
      );
      expect(await oneClaim(output, "coalition-candidates")).toBe(
        scenario.candidates,
      );

      const componentRows = await claimRows(
        page.getByRole("table", {
          name: "Honest components after removing coalition-known edges",
        }),
      );
      expect(
        componentRows.map((row) => [
          single(
            row.claims["coalition-component-members"],
            "component members",
          ),
          single(row.claims["coalition-component-total"], "component total"),
        ]),
      ).toEqual(scenario.components);

      const posteriorRows = await claimRows(
        page.getByRole("table", {
          name: "Posterior under the displayed exactly-one-sender prior",
        }),
      );
      expect(posteriorRows.map((row) => row.heading).join(",")).toBe(
        scenario.candidates,
      );
      for (const row of posteriorRows) {
        expect(
          single(row.claims["coalition-prior-weight"], "prior weight"),
        ).toBe("1");
        expect(single(row.claims["coalition-posterior"], "posterior")).toBe(
          `1/${scenario.denominator}`,
        );
      }
      expect(await oneClaim(output, "coalition-enumerated-worlds")).toBe("32");
      await expect(
        output.locator('[data-verdict="coalition-exhaustive-agreement"]'),
      ).toHaveAttribute("data-result", "pass");
    }

    await page.locator("#coalition").selectOption("A,C");
    await page.locator('input[name="prior"][value="skewed"]').check();
    await expect(output).toHaveAttribute("data-stale", "true");
    await form.getByRole("button", { name: "Analyze this view" }).click();
    const skewed = await claimRows(
      page.getByRole("table", {
        name: "Posterior under the displayed exactly-one-sender prior",
      }),
    );
    expect(
      skewed.map((row) => ({
        participant: row.heading,
        weight: single(row.claims["coalition-prior-weight"], "prior weight"),
        posterior: single(row.claims["coalition-posterior"], "posterior"),
      })),
    ).toEqual([
      { participant: "D", weight: "3", posterior: "3/4" },
      { participant: "E", weight: "1", posterior: "1/4" },
    ]);

    const knownMasks = await claimValues(output, "coalition-known-mask");
    expect(knownMasks.map(parseByte)).toEqual([
      FIXTURE_MASKS.AB,
      FIXTURE_MASKS.BC,
      FIXTURE_MASKS.CD,
      FIXTURE_MASKS.EA,
    ]);
  });

  test("the exhaustive one-bit marker agrees with an independent 32-world oracle", async ({
    page,
  }) => {
    await load(page);
    await openPanel(page, "views");

    const histogram = (candidate: string): [string, number][] => {
      const frequencies = new Map<string, number>();
      for (
        let assignment = 0;
        assignment < 2 ** EDGES.length;
        assignment += 1
      ) {
        const masks = Object.fromEntries(
          EDGES.map(([id], index) => [id, (assignment >> index) & 1]),
        ) as Record<string, number>;
        const publicBits = PARTICIPANTS.map((participant) => {
          const incident = EDGES.filter(
            ([, left, right]) => left === participant || right === participant,
          ).map(([id]) => masks[id]!);
          return xor([participant === candidate ? 1 : 0, ...incident]);
        });
        const knownMaskBits = EDGES.filter(
          ([, left, right]) =>
            ["A", "C"].includes(left) || ["A", "C"].includes(right),
        ).map(([id]) => masks[id]);
        const key = JSON.stringify([publicBits, knownMaskBits, [0, 0]]);
        frequencies.set(key, (frequencies.get(key) ?? 0) + 1);
      }
      return [...frequencies.entries()].sort(([left], [right]) =>
        left.localeCompare(right),
      );
    };

    const d = histogram("D");
    const e = histogram("E");
    const b = histogram("B");
    expect(d.reduce((sum, [, count]) => sum + count, 0)).toBe(32);
    expect(e).toEqual(d);
    expect(b).not.toEqual(d);
    expect(
      await oneClaim(
        page.locator("#views-output"),
        "coalition-enumerated-worlds",
      ),
    ).toBe("32");
    await expect(
      page.locator('[data-verdict="coalition-exhaustive-agreement"]'),
    ).toHaveAttribute("data-result", "pass");
  });

  test("zero through three senders reveal parity, not a sender count", async ({
    page,
  }) => {
    await load(page);
    await openPanel(page, "collisions");
    const output = page.locator("#collision-output");
    const form = page.locator("#collision-form");

    for (const count of [0, 1, 2, 3] as const) {
      await page
        .locator(`input[name="sender-count"][value="${count}"]`)
        .check();
      await form.getByRole("button", { name: "Run collision round" }).click();
      const inputRows = await claimRows(
        page.getByRole("table", {
          name: "Private one-bit inputs in this simulator run",
        }),
      );
      const broadcastRows = await claimRows(
        page.getByRole("table", {
          name: "One-bit collision-round public broadcasts",
        }),
      );
      const inputs = inputRows.map((row) =>
        parseByte(single(row.claims["collision-input"], "collision input")),
      );
      const broadcasts = broadcastRows.map((row) =>
        parseByte(
          single(row.claims["collision-broadcast"], "collision broadcast"),
        ),
      );
      const parity = Number(await oneClaim(output, "collision-parity"));

      expect(inputs.filter((value) => value === 1)).toHaveLength(count);
      expect(parity).toBe(count % 2);
      expect(xor(inputs)).toBe(parity);
      expect(xor(broadcasts)).toBe(parity);
      expect(await oneClaim(output, "collision-sender-count")).toBe(
        String(count),
      );
      expect(await oneClaim(output, "collision-sender-ids")).toBe(
        PARTICIPANTS.slice(0, count).join(","),
      );
      const ambiguity = output.locator('[data-verdict="collision-ambiguity"]');
      await expect(ambiguity).toContainText(
        count % 2 === 0
          ? "EVEN PARITY — DOES NOT PROVE SILENCE"
          : "ODD PARITY — DOES NOT PROVE ONE SENDER",
      );
      await expect(ambiguity).toContainText(
        count % 2 === 0
          ? "zero, two, or four bit-1 inputs remain compatible"
          : "one, three, or five bit-1 inputs remain compatible",
      );
    }

    const byteRows = await claimRows(
      page.getByRole("table", { name: "Executable two-sender byte examples" }),
    );
    expect(byteRows).toHaveLength(2);
    const byteEvidence = byteRows.map((row) => ({
      name: row.heading,
      left: parseByte(single(row.claims["collision-byte-left"], "left byte")),
      right: parseByte(
        single(row.claims["collision-byte-right"], "right byte"),
      ),
      aggregate: parseByte(
        single(row.claims["collision-byte-aggregate"], "aggregate byte"),
      ),
      check: single(row.claims["collision-byte-check"], "byte check"),
    }));
    expect(byteEvidence[0]!.left).toBe(byteEvidence[0]!.right);
    expect(byteEvidence[0]!.aggregate).toBe(0);
    expect(byteEvidence[1]).toMatchObject({
      left: 0x01,
      right: 0x02,
      aggregate: 0x03,
    });
    for (const row of byteEvidence) {
      expect(row.aggregate).toBe(row.left ^ row.right);
      expect(row.check).toBe("match");
    }
  });

  test("malformation, shaped jamming, dropout, and reformation stay distinct", async ({
    page,
  }) => {
    await load(page);
    await openPanel(page, "disruption");
    await page.locator("#disruption-button").click();
    const output = page.locator("#disruption-output");

    expect(await oneClaim(output, "disruption-honest-aggregate")).toBe("48");
    expect(await oneClaim(output, "malformed-refusal-status")).toBe(
      "malformed",
    );
    await expect(
      output.locator('[data-verdict="malformed-refusal"]'),
    ).toHaveAttribute("data-result", "reject");

    expect(await oneClaim(output, "shaped-jammer-status")).toBe("ok");
    expect(await oneClaim(output, "shaped-jammer-participant")).toBe("B");
    expect(await oneClaim(output, "shaped-jammer-changed")).toBe("true");
    const jammed = parseByte(await oneClaim(output, "shaped-jammer-aggregate"));
    expect(jammed).toBe(0x48 ^ FIXTURE_BROADCASTS.B! ^ 0xff);
    await expect(
      output.locator('[data-verdict="shaped-jammer"]'),
    ).toHaveAttribute("data-result", "alarm");

    expect(await oneClaim(output, "dropout-abort-status")).toBe("missing");
    expect(await oneClaim(output, "dropout-participant")).toBe("C");
    expect(await oneClaim(output, "dropout-zero-substitution")).toBe("false");
    const partialAggregate = parseByte(
      await oneClaim(output, "dropout-partial-aggregate"),
    );
    const presentInputXor = parseByte(
      await oneClaim(output, "dropout-present-input-xor"),
    );
    const boundaryMaskXor = parseByte(
      await oneClaim(output, "dropout-boundary-mask-xor"),
    );
    const expectedPartial = parseByte(
      await oneClaim(output, "dropout-expected-partial"),
    );
    expect(await oneClaim(output, "dropout-boundary-edges")).toBe("BC,CD");
    expect(partialAggregate).toBe(
      xor(
        PARTICIPANTS.filter((participant) => participant !== "C").map(
          (participant) => FIXTURE_BROADCASTS[participant]!,
        ),
      ),
    );
    expect(presentInputXor).toBe(0x48);
    expect(boundaryMaskXor).toBe(FIXTURE_MASKS.BC! ^ FIXTURE_MASKS.CD!);
    expect(expectedPartial).toBe(presentInputXor ^ boundaryMaskXor);
    expect(partialAggregate).toBe(expectedPartial);
    expect(await oneClaim(output, "dropout-boundary-equation-holds")).toBe(
      "true",
    );
    await expect(
      output.locator('[data-verdict="dropout-abort"]'),
    ).toHaveAttribute("data-result", "reject");

    expect(await oneClaim(output, "reformed-round-id")).toBe(
      "reformed-without-C",
    );
    expect(await oneClaim(output, "reformed-membership")).toBe("A,B,D,E");
    expect(await oneClaim(output, "reformed-aggregate")).toBe("48");
    const replacementRows = await claimRows(
      page.getByRole("table", {
        name: "Retained edges receive deterministic replacement masks in this checked fixture",
      }),
    );
    const replacements = replacementRows.map((row) => ({
      edge: single(row.claims["reformed-edge"], "reformed edge"),
      previous: parseByte(
        single(row.claims["reformed-old-mask"], "aborted-round mask"),
      ),
      replacement: parseByte(
        single(row.claims["reformed-new-mask"], "replacement mask"),
      ),
      different: single(
        row.claims["reformed-mask-different"],
        "replacement differs",
      ),
    }));
    expect(replacements).toEqual([
      {
        edge: "AB",
        previous: FIXTURE_MASKS.AB,
        replacement: 0x94,
        different: "true",
      },
      {
        edge: "DE",
        previous: FIXTURE_MASKS.DE,
        replacement: 0x6b,
        different: "true",
      },
      {
        edge: "EA",
        previous: FIXTURE_MASKS.EA,
        replacement: 0x27,
        different: "true",
      },
    ]);
    for (const row of replacements) {
      expect(row.replacement).not.toBe(row.previous);
    }
    expect(await oneClaim(output, "reformed-masks-replaced")).toBe("true");
    await expect(output).toContainText(
      "deterministic replacement masks in this checked fixture",
    );
    await expect(output).toContainText(
      "A real reformed round requires independently sampled, secret, one-use masks",
    );
    await expect(
      output.locator('[data-verdict="reformed-round"]'),
    ).toHaveAttribute("data-result", "pass");
  });

  test("commitments bind the complete stated context but not honest behavior", async ({
    page,
  }) => {
    await load(page);
    await openPanel(page, "disruption");
    const output = page.locator("#commit-output");
    await page.locator("#commit-button").click();
    await expect(output).toHaveAttribute("data-stale", "false");

    const firstDigest = await oneClaim(output, "commitment-digest");
    expect(firstDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(await oneClaim(output, "commitment-bound-fields")).toBe(
      [
        "versioned domain separator",
        "session identifier",
        "round identifier",
        "ordered membership",
        "canonical undirected key graph",
        "participant identifier",
        "contribution length and bytes",
        "fresh 32-byte nonce",
      ].join(","),
    );
    expect(await oneClaim(output, "commitment-context-rejections")).toBe(
      [
        "contribution",
        "nonce",
        "participant",
        "key graph",
        "membership",
        "round identifier",
        "session identifier",
        "contribution length",
      ].join(","),
    );
    for (const marker of [
      "commit-honest-reveal",
      "commit-changed-reveal",
      "commit-precommitted-jam",
      "commit-withheld-reveal",
    ]) {
      expect(await oneClaim(output, marker)).toBe("true");
    }
    await expect(output).toContainText("does not authenticate labels");
    await expect(output).toContainText("Dissent/Verdict-style blame");
    await expect(output).toContainText(
      "Under the stated SHA-256 collision and second-preimage resistance assumption",
    );
    await expect(output).toContainText("no formal hiding theorem is claimed");

    await page.locator("#commit-button").click();
    await expect(output).toHaveAttribute("data-stale", "false");
    const secondDigest = await oneClaim(output, "commitment-digest");
    expect(secondDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(secondDigest).not.toBe(firstDigest);
  });

  test("mask reuse and later disclosure independently recover the displayed inputs", async ({
    page,
  }) => {
    await load(page);
    await openPanel(page, "reuse");
    await page.locator("#reuse-button").click();
    const output = page.locator("#reuse-output");
    const maskRows = await claimRows(
      page.getByRole("table", {
        name: "Omniscient attack-fixture evidence: masks in both rounds",
      }),
    );
    expect(
      maskRows.map((row) => ({
        edge: single(row.claims["reuse-edge"], "reused edge"),
        first: parseByte(
          single(row.claims["reuse-first-mask"], "first-round mask"),
        ),
        second: parseByte(
          single(row.claims["reuse-second-mask"], "second-round mask"),
        ),
        equal: single(row.claims["reuse-mask-equal"], "mask equality"),
      })),
    ).toEqual(
      EDGES.map(([edge]) => ({
        edge,
        first: FIXTURE_MASKS[edge],
        second: FIXTURE_MASKS[edge],
        equal: "true",
      })),
    );
    const rows = await claimRows(
      page.getByRole("table", {
        name: "Per-participant cancellation across reused-mask rounds",
      }),
    );
    const expectedInputs = [0x10, 0x20, 0x30, 0x48, 0x50];
    expect(rows.map((row) => row.heading)).toEqual(PARTICIPANTS);
    rows.forEach((row, index) => {
      const first = parseByte(
        single(row.claims["reuse-first-broadcast"], "first broadcast"),
      );
      const second = parseByte(
        single(row.claims["reuse-second-broadcast"], "second broadcast"),
      );
      const broadcastXor = parseByte(
        single(row.claims["reuse-broadcast-xor"], "broadcast XOR"),
      );
      const inputXor = parseByte(
        single(row.claims["reuse-input-xor"], "input XOR"),
      );
      const recovered = parseByte(
        single(
          row.claims["reuse-known-empty-recovery"],
          "known-empty recovery",
        ),
      );
      expect(
        parseByte(single(row.claims["reuse-first-input"], "first input")),
      ).toBe(0);
      expect(
        parseByte(single(row.claims["reuse-second-input"], "second input")),
      ).toBe(expectedInputs[index]);
      expect(broadcastXor).toBe(first ^ second);
      expect(inputXor).toBe(broadcastXor);
      expect(recovered).toBe(inputXor);
      expect(recovered).toBe(expectedInputs[index]);
      expect(single(row.claims["reuse-identity-match"], "reuse identity")).toBe(
        "true",
      );
    });
    const distinctControlRows = await claimRows(
      page.getByRole("table", {
        name: "Distinct-mask deterministic control: this fixture breaks the per-participant identity",
      }),
    );
    expect(distinctControlRows.map((row) => row.heading)).toEqual(PARTICIPANTS);
    distinctControlRows.forEach((row, index) => {
      const firstInput = parseByte(
        single(
          row.claims["distinct-control-first-input"],
          "control first input",
        ),
      );
      const nextInput = parseByte(
        single(row.claims["distinct-control-next-input"], "control next input"),
      );
      const firstBroadcast = parseByte(
        single(
          row.claims["distinct-control-first-broadcast"],
          "control first broadcast",
        ),
      );
      const nextBroadcast = parseByte(
        single(
          row.claims["distinct-control-next-broadcast"],
          "control next broadcast",
        ),
      );
      const broadcastXor = parseByte(
        single(
          row.claims["distinct-control-broadcast-xor"],
          "control broadcast XOR",
        ),
      );
      const inputXor = parseByte(
        single(row.claims["distinct-control-input-xor"], "control input XOR"),
      );
      expect(firstInput).toBe(0);
      expect(nextInput).toBe(expectedInputs[index]);
      expect(firstBroadcast).toBe(
        parseByte(
          single(
            rows[index]!.claims["reuse-first-broadcast"],
            "shared first broadcast",
          ),
        ),
      );
      expect(broadcastXor).toBe(firstBroadcast ^ nextBroadcast);
      expect(inputXor).toBe(firstInput ^ nextInput);
      expect(broadcastXor).not.toBe(inputXor);
      expect(
        single(
          row.claims["distinct-control-identity-match"],
          "distinct-mask control identity",
        ),
      ).toBe("false");
    });
    await expect(output.locator('[data-verdict="mask-reuse"]')).toHaveAttribute(
      "data-result",
      "alarm",
    );
    await expect(
      output.locator('[data-verdict="distinct-mask-control"]'),
    ).toHaveAttribute("data-result", "pass");
    await expect(output).toContainText(
      "displayed deterministic replacement masks",
    );
    await expect(output).toContainText(
      "does not establish an all-distinct theorem or validate randomness",
    );

    expect(await oneClaim(output, "disclosure-participant")).toBe("D");
    const recorded = parseByte(await oneClaim(output, "disclosure-broadcast"));
    expect(recorded).toBe(FIXTURE_BROADCASTS.D);
    expect(await oneClaim(output, "disclosure-edge-ids")).toBe("CD,DE");
    const disclosedRows = await claimRows(
      page.getByRole("table", {
        name: "Incident masks disclosed after the recorded round",
      }),
    );
    expect(
      disclosedRows.map((row) => ({
        edge: single(row.claims["disclosure-edge"], "disclosed edge"),
        mask: parseByte(
          single(row.claims["disclosure-mask"], "disclosed mask"),
        ),
      })),
    ).toEqual([
      { edge: "CD", mask: FIXTURE_MASKS.CD },
      { edge: "DE", mask: FIXTURE_MASKS.DE },
    ]);
    const recovered = parseByte(
      await oneClaim(output, "disclosure-recovered-input"),
    );
    expect(recovered).toBe(recorded ^ FIXTURE_MASKS.CD! ^ FIXTURE_MASKS.DE!);
    expect(recovered).toBe(0x48);
    await expect(
      output.locator('[data-verdict="late-disclosure"]'),
    ).toHaveAttribute("data-result", "alarm");
    await expect(output).toContainText(
      "JavaScript cannot prove that a mask was erased",
    );
    await expect(output).toContainText(
      "bypasses the honest duplicate-round and exact-assignment-replay guard",
    );
  });

  test("visible limits and primary comparisons do not overstate the model", async ({
    page,
  }) => {
    await load(page);
    const text = (await page.locator("body").innerText()).replace(/\s+/g, " ");
    for (const statement of [
      "No message confidentiality",
      "No source authentication, receiver anonymity, Sybil resistance or membership protocol",
      "No transport privacy",
      "key-sharing graph is not a network topology",
      "No collision resolution, sender accountability, guaranteed delivery or protection from a valid-shaped jammer",
      "No proof of secure erasure, constant-time execution or separate-role isolation in JavaScript",
      "WebCrypto supplies a pseudorandom teaching stand-in",
      "exactly-one-sender hypothesis and prior weights",
    ]) {
      expect(text).toContain(statement);
    }
    expect(text).not.toMatch(/\p{Extended_Pictographic}/u);

    await page.locator("details > summary").click();
    const links = [
      ["https://ir.cwi.nl/pub/2438", "Chaum"],
      ["https://doi.org/10.1007/BF00206326", "DOI"],
      ["https://bford.info/pub/net/dissent-abs/", "Dissent"],
      [
        "https://www.usenix.org/conference/usenixsecurity13/technical-sessions/presentation/corrigan-gibbs",
        "Verdict",
      ],
      ["https://csrc.nist.gov/pubs/fips/180-4/upd1/final", "FIPS 180-4"],
      [
        "https://www.w3.org/TR/2017/REC-WebCryptoAPI-20170126/",
        "W3C Web Cryptography API",
      ],
    ] as const;
    for (const [href, name] of links) {
      await expect(
        page.getByRole("link", { name: new RegExp(name) }),
      ).toHaveAttribute("href", href);
    }
    await expect(page.locator(".detail-body")).toContainText(
      "comparison, not a property of this lab",
    );
    await expect(page.locator(".detail-body")).toContainText(
      "The core XOR lesson and generalized key-sharing graph follow Chaum’s construction (§§1.1 and 1.3)",
    );
    await expect(page.locator(".detail-body")).toContainText(
      "hash commitment supplies neither proof nor blame",
    );
  });
});
