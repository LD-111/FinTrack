import { open, save } from "@tauri-apps/plugin-dialog";
import { readFile, writeFile } from "@tauri-apps/plugin-fs";
import { todayISO } from "@/lib/dates";

const SPREADSHEET = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const FILTERS = [{ name: "Spreadsheet", extensions: ["xlsx", SPREADSHEET] }];

export async function saveWorkbookFile(bytes: ArrayBuffer): Promise<string | null> {
  const path = await save({
    defaultPath: `fintrack-${todayISO()}.xlsx`,
    filters: FILTERS,
  });
  if (typeof path !== "string") return null;
  await writeFile(path, new Uint8Array(bytes));
  return path;
}

export async function pickWorkbookFile(): Promise<ArrayBuffer | null> {
  const selected = await open({
    multiple: false,
    filters: FILTERS,
  });
  if (typeof selected !== "string") return null;
  const bytes = await readFile(selected);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}
