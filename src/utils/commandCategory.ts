/**
 * Shared command/category matching (audit 8.56 P3 — first App.tsx extraction
 * slice: this predicate was duplicated across five JSX blocks).
 * A command matches a category when either its parent category (top-level
 * grouping) or its own category equals the target, case-insensitively.
 */
export interface CategorizedCommand {
  category: string;
  parentCategory?: string;
}

export function commandMatchesCategory(cmd: CategorizedCommand, category: string): boolean {
  const target = category.toLowerCase();
  const parent = (cmd.parentCategory || cmd.category).toLowerCase();
  return parent === target || cmd.category.toLowerCase() === target;
}
