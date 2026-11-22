export function updaterConfigArgs(release, args) {
  if (release && args[0] === "build") {
    return ["--config", JSON.stringify({ bundle: { createUpdaterArtifacts: true } })];
  }
  return [];
}
