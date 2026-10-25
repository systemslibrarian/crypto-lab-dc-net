import type { ResultKind } from "./types";

export function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`required element is missing: ${selector}`);
  return element;
}

export function bytesToHex(value: Uint8Array): string {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

export function parseOneByte(value: string): Uint8Array | undefined {
  const normalized = value.trim().toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]{2}$/.test(normalized)) return undefined;
  return Uint8Array.of(Number.parseInt(normalized, 16));
}

export function codeClaim(
  marker: string,
  value: Uint8Array | string | number | bigint,
  label?: string,
): HTMLElement {
  const code = document.createElement("code");
  const machineValue =
    value instanceof Uint8Array ? bytesToHex(value) : String(value);
  code.dataset.claim = marker;
  code.dataset.value = machineValue;
  code.textContent = label ?? machineValue;
  return code;
}

export function textClaim(
  marker: string,
  value: string | number | bigint | boolean,
  text = String(value),
): HTMLElement {
  const span = document.createElement("span");
  span.dataset.claim = marker;
  span.dataset.value = String(value);
  span.textContent = text;
  return span;
}

export function verdict(
  marker: string,
  kind: ResultKind,
  heading: string,
  detail: string,
): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = `verdict verdict-${kind}`;
  wrapper.dataset.verdict = marker;
  wrapper.dataset.result = kind;

  const icon = document.createElement("span");
  icon.className = "verdict-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent =
    kind === "pass"
      ? "OK"
      : kind === "reject"
        ? "NO"
        : kind === "alarm"
          ? "!"
          : "i";

  const copy = document.createElement("div");
  const title = document.createElement("strong");
  title.textContent = heading;
  const body = document.createElement("span");
  body.textContent = detail;
  copy.append(title, body);
  wrapper.append(icon, copy);
  return wrapper;
}

export function tableRegion(
  label: string,
  table: HTMLTableElement,
): HTMLElement {
  const region = document.createElement("div");
  region.className = "table-wrap";
  region.tabIndex = 0;
  region.setAttribute("role", "region");
  region.setAttribute("aria-label", label);
  region.append(table);
  return region;
}

export function setStale(
  output: HTMLElement,
  status: HTMLElement,
  stale: boolean,
): void {
  output.dataset.stale = String(stale);
  status.textContent = stale
    ? "Inputs changed. Displayed evidence is stale; run again."
    : "Inputs match the displayed evidence.";
}

export function xor(values: readonly Uint8Array[]): Uint8Array {
  if (values.length === 0) return new Uint8Array();
  const width = values[0]?.length ?? 0;
  const output = new Uint8Array(width);
  for (const value of values) {
    if (value.length !== width) throw new RangeError("XOR width mismatch");
    for (let index = 0; index < width; index += 1) {
      output[index] ^= value[index] ?? 0;
    }
  }
  return output;
}

export function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}
