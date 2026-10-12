// "Note to pilots": standing requirements, one per line.
export function noteLines(notes: string | undefined): string[] {
  return (notes ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}
