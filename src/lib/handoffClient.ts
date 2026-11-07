import { invoke } from "@tauri-apps/api/core";
import { handoffUrl, type HandoffTarget } from "@/lib/handoff";
import { isTauriRuntime } from "@/lib/shell";

const UNREACHABLE =
  "Could not reach the computer. Use Export and Import if this Wi-Fi blocks device-to-device traffic.";
const TIMEOUT = "The computer did not answer. Accept the transfer on the computer, or try again.";

export async function postHandoff(target: HandoffTarget, body: string): Promise<{ status: number; body: string }> {
  try {
    if (isTauriRuntime()) {
      return await invoke<{ status: number; body: string }>("send_handoff", {
        host: target.host,
        port: target.port,
        token: target.token,
        body,
      });
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 180_000);
    try {
      const response = await fetch(handoffUrl(target.host, target.port, target.token), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal: controller.signal,
      });
      return { status: response.status, body: await response.text() };
    } finally {
      window.clearTimeout(timer);
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw new Error(TIMEOUT);
    const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
    if (
      message.includes("Could not reach") ||
      message.includes("did not answer") ||
      message.includes("code did not match") ||
      message.includes("too large")
    ) {
      throw new Error(message);
    }
    throw new Error(UNREACHABLE);
  }
}
