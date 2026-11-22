export const UPDATE_CHECKS_KEY = "fintrack-update-checks";
export const UPDATE_SKIPPED_KEY = "fintrack-update-skipped";

export type UpdatePreferences = {
  checksOnLaunch: boolean;
  skippedVersion: string | null;
};

export type UpdateCheckResult =
  | { status: "up-to-date" }
  | { status: "failed" }
  | { status: "available"; version: string };

export type UpdateNoticeKind = "quiet" | "up-to-date" | "failed" | "offer";

type StorageReader = { getItem(key: string): string | null };
type StorageWriter = StorageReader & {
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

export function readUpdatePreferences(storage: StorageReader): UpdatePreferences {
  const skipped = storage.getItem(UPDATE_SKIPPED_KEY)?.trim() ?? "";
  return {
    checksOnLaunch: storage.getItem(UPDATE_CHECKS_KEY) !== "off",
    skippedVersion: skipped.length > 0 ? skipped : null,
  };
}

export function writeChecksOnLaunch(storage: StorageWriter, on: boolean): void {
  if (on) storage.removeItem(UPDATE_CHECKS_KEY);
  else storage.setItem(UPDATE_CHECKS_KEY, "off");
}

export function writeSkippedVersion(storage: StorageWriter, version: string): void {
  storage.setItem(UPDATE_SKIPPED_KEY, version);
}

export function updateNotice(input: {
  result: UpdateCheckResult | null;
  preferences: UpdatePreferences;
  dismissedVersion: string | null;
  manual: boolean;
}): UpdateNoticeKind {
  const { result, preferences, dismissedVersion, manual } = input;
  if (!result) return "quiet";
  if (result.status === "failed") return manual ? "failed" : "quiet";
  if (result.status === "up-to-date") return manual ? "up-to-date" : "quiet";
  if (manual) return "offer";
  if (!preferences.checksOnLaunch) return "quiet";
  if (preferences.skippedVersion === result.version) return "quiet";
  if (dismissedVersion === result.version) return "quiet";
  return "offer";
}
