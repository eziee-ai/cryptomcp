import type { ManifestAmountRef, ManifestCall, ManifestTokenRef } from "../../../kit/manifest";

/** A plain-language reading of a manifest call's `spend`/`receive`/`recipient`/`deadline`/`ignore` fields, for `/p/<id>`. */

function describeToken(ref: ManifestTokenRef): string {
  if (ref === "native") return "the chain's native token";
  if ("const" in ref) return `a fixed token, ${ref.const}`;
  return `the token in "${ref.arg}"`;
}

function describeAmount(ref: ManifestAmountRef): string {
  if (ref === "msg.value") return "the ETH sent with the call (msg.value)";
  if ("const" in ref) return `a fixed amount, ${ref.const}`;
  return `the amount in "${ref.arg}"`;
}

export interface CallReading {
  spend: string[];
  receive: string | null;
  recipient: string | null;
  deadline: string | null;
  ignore: Array<{ arg: string; reason: string }>;
}

export function readCall(call: ManifestCall): CallReading {
  return {
    spend: (call.spend ?? []).map((entry) => `spends ${describeAmount(entry.amount)} of ${describeToken(entry.token)}`),
    receive: call.receive
      ? call.receive.minAmount
        ? `receives at least ${describeAmount(call.receive.minAmount)} of ${describeToken(call.receive.token)}`
        : `receives ${describeToken(call.receive.token)}, with no minimum declared`
      : null,
    recipient: call.recipient ? `pays out to the address in "${call.recipient.arg}"` : null,
    deadline: call.deadline ? `expires at the timestamp in "${call.deadline.arg}"` : null,
    ignore: call.ignore ?? [],
  };
}
