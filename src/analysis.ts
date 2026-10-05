import ts from "typescript";
import path from "node:path";
import { tree } from "./core.js";
import type { Recipe } from "./recipes.js";
export interface Graph {
  files: string[];
  edges: { from: string; to: string; kind: "import" | "reference" }[];
  symbols: { id: string; file: string; name: string; line: number }[];
  unresolved: string[];
}
export interface Task {
  id: string;
  files: string[];
  dependsOn: string[];
}
export function targetedContext(
  graph: Graph,
  files: Record<string, string>,
  owned: string[],
) {
  const selected = new Set(owned);
  for (const edge of graph.edges)
    if (owned.includes(edge.to)) selected.add(edge.from);
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of graph.edges)
      if (selected.has(edge.from) && !selected.has(edge.to)) {
        selected.add(edge.to);
        changed = true;
      }
  }
  // Recipe SDK declarations include the target API, which the old code does not yet import.
  for (const file of Object.keys(files))
    if (file.startsWith("lib/")) selected.add(file);
  return Object.fromEntries(
    Object.entries(files).filter(([file]) => selected.has(file)),
  );
}
export async function analyze(root: string): Promise<Graph> {
  const all = await tree(root);
  const files = Object.keys(all).filter((f) => f.endsWith(".ts"));
  if (
    files.length > 100 ||
    Object.values(all).join("\n").split("\n").length > 10000
  )
    throw new Error("Repository exceeds MVP limits");
  const graph: Graph = { files, edges: [], symbols: [], unresolved: [] };
  const program = ts.createProgram(
    files.map((f) => path.join(root, f)),
    {
      target: ts.ScriptTarget.ES2022,
      moduleResolution: ts.ModuleResolutionKind.Node10,
    },
  );
  const checker = program.getTypeChecker();
  for (const file of files) {
    const source = program.getSourceFile(path.join(root, file))!;
    const visit = (node: ts.Node) => {
      if (
        ts.isImportDeclaration(node) &&
        ts.isStringLiteral(node.moduleSpecifier)
      ) {
        const spec = node.moduleSpecifier.text;
        const resolved = ts.resolveModuleName(
          spec,
          path.join(root, file),
          program.getCompilerOptions(),
          ts.sys,
        ).resolvedModule;
        if (resolved) {
          const target = path.relative(root, resolved.resolvedFileName);
          if (files.includes(target))
            graph.edges.push({ from: file, to: target, kind: "import" });
        } else graph.unresolved.push(`${file}:${spec}`);
      }
      if (ts.isFunctionDeclaration(node) && node.name)
        graph.symbols.push({
          id: `${file}:${node.name.text}`,
          file,
          name: node.name.text,
          line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1,
        });
      if (ts.isIdentifier(node)) {
        let symbol = checker.getSymbolAtLocation(node);
        if (symbol && symbol.flags & ts.SymbolFlags.Alias)
          symbol = checker.getAliasedSymbol(symbol);
        for (const decl of symbol?.declarations ?? []) {
          const target = path.relative(root, decl.getSourceFile().fileName);
          if (target !== file && files.includes(target))
            graph.edges.push({ from: file, to: target, kind: "reference" });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  graph.edges = [
    ...new Map(graph.edges.map((e) => [JSON.stringify(e), e])).values(),
  ];
  return graph;
}
export function plan(graph: Graph, recipe: Recipe): Task[] {
  const affected = new Set(recipe.seedFiles);
  let changed = true;
  while (changed) {
    changed = false;
    for (const e of graph.edges)
      if (affected.has(e.to) && !affected.has(e.from)) {
        affected.add(e.from);
        changed = true;
      }
  }
  const files = graph.files
    .filter((f) => affected.has(f) && recipe.allowedFiles.includes(f))
    .sort();
  const adj = new Map(
    files.map((f) => [
      f,
      graph.edges
        .filter((e) => e.from === f && files.includes(e.to))
        .map((e) => e.to),
    ]),
  );
  // Tarjan SCC: mutually dependent source files migrate together.
  let index = 0;
  const indices = new Map<string, number>(),
    low = new Map<string, number>(),
    stack: string[] = [],
    on = new Set<string>(),
    groups: string[][] = [];
  const visit = (v: string) => {
    indices.set(v, index);
    low.set(v, index++);
    stack.push(v);
    on.add(v);
    for (const w of adj.get(v) ?? []) {
      if (!indices.has(w)) {
        visit(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (on.has(w)) low.set(v, Math.min(low.get(v)!, indices.get(w)!));
    }
    if (low.get(v) === indices.get(v)) {
      const group: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        on.delete(w);
        group.push(w);
      } while (w !== v);
      groups.push(group.sort());
    }
  };
  for (const file of files) if (!indices.has(file)) visit(file);
  if (groups.length > 10) throw new Error("Too many migration tasks");
  const tasks = groups.map((files, i) => ({
    id: `task-${i}`,
    files,
    dependsOn: [] as string[],
  }));
  for (const t of tasks)
    t.dependsOn = tasks
      .filter(
        (other) =>
          other !== t &&
          t.files.some((f) =>
            (adj.get(f) ?? []).some((dep) => other.files.includes(dep)),
          ),
      )
      .map((t) => t.id);
  return tasks;
}
