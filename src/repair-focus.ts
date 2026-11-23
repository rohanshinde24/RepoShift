import ts from "typescript";

function isFallback(expression: ts.Expression): boolean {
  const value = ts.isParenthesizedExpression(expression)
    ? expression.expression
    : expression;
  return (
    value.kind === ts.SyntaxKind.NullKeyword ||
    value.kind === ts.SyntaxKind.FalseKeyword ||
    (ts.isIdentifier(value) && value.text === "undefined") ||
    (ts.isNumericLiteral(value) && value.text === "0") ||
    (ts.isStringLiteral(value) && value.text === "") ||
    (ts.isArrayLiteralExpression(value) && value.elements.length === 0) ||
    (ts.isObjectLiteralExpression(value) && value.properties.length === 0)
  );
}

function returnsFallback(node: ts.Node): boolean {
  if (
    ts.isReturnStatement(node) &&
    node.expression &&
    isFallback(node.expression)
  )
    return true;
  let found = false;
  ts.forEachChild(node, (child) => {
    if (returnsFallback(child)) found = true;
  });
  return found;
}

function replaceableFallback(block: ts.Block, errorName: string): boolean {
  const statements = block.statements;
  const last = statements[statements.length - 1];
  if (
    !last ||
    !ts.isReturnStatement(last) ||
    !last.expression ||
    !isFallback(last.expression) ||
    statements.length > 2
  )
    return false;
  if (statements.length === 1) return true;
  const log = statements[0];
  return !!(
    log &&
    ts.isExpressionStatement(log) &&
    ts.isCallExpression(log.expression) &&
    ts.isPropertyAccessExpression(log.expression.expression) &&
    ts.isIdentifier(log.expression.expression.expression) &&
    log.expression.expression.expression.text === "console" &&
    ["log", "error", "warn"].includes(log.expression.expression.name.text) &&
    log.expression.arguments.length === 1 &&
    log.expression.arguments[0] &&
    ts.isIdentifier(log.expression.arguments[0]) &&
    log.expression.arguments[0].text === errorName
  );
}

function fallbackCatchCount(file: string, content: string): number {
  const source = ts.createSourceFile(
    file,
    content,
    ts.ScriptTarget.Latest,
    true,
  );
  let count = 0;
  const visit = (node: ts.Node) => {
    if (ts.isCatchClause(node) && returnsFallback(node.block)) count++;
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "catch" &&
      node.arguments.length === 1
    ) {
      const handler = node.arguments[0];
      if (
        handler &&
        (ts.isArrowFunction(handler) || ts.isFunctionExpression(handler)) &&
        (ts.isExpression(handler.body)
          ? isFallback(handler.body)
          : returnsFallback(handler.body))
      )
        count++;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return count;
}

export function introducedFallbackCatchFiles(
  before: Record<string, string>,
  after: Record<string, string>,
  allowed: string[],
): string[] {
  return allowed.filter(
    (name) =>
      name.endsWith(".ts") &&
      typeof after[name] === "string" &&
      fallbackCatchCount(name, after[name]) >
        fallbackCatchCount(name, before[name] ?? ""),
  );
}

export function repairSingleFallbackCatch(
  before: Record<string, string>,
  after: Record<string, string>,
  allowed: string[],
): { path: string; content: string } | null {
  const candidates = introducedFallbackCatchFiles(before, after, allowed);
  if (candidates.length !== 1) return null;
  const name = candidates[0]!;
  if (fallbackCatchCount(name, before[name] ?? "") !== 0) return null;
  const content = after[name]!;
  const source = ts.createSourceFile(
    name,
    content,
    ts.ScriptTarget.Latest,
    true,
  );
  const replacements: { start: number; end: number; content: string }[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isCatchClause(node) &&
      node.variableDeclaration &&
      ts.isIdentifier(node.variableDeclaration.name) &&
      replaceableFallback(node.block, node.variableDeclaration.name.text)
    ) {
      replacements.push({
        start: node.block.getStart(source),
        end: node.block.getEnd(),
        content: `{ throw ${node.variableDeclaration.name.text}; }`,
      });
    }
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "catch" &&
      node.arguments.length === 1
    ) {
      const handler = node.arguments[0];
      if (
        handler &&
        ts.isArrowFunction(handler) &&
        handler.parameters.length === 1 &&
        handler.parameters[0] &&
        ts.isIdentifier(handler.parameters[0].name) &&
        ((ts.isExpression(handler.body) && isFallback(handler.body)) ||
          (ts.isBlock(handler.body) &&
            replaceableFallback(handler.body, handler.parameters[0].name.text)))
      ) {
        replacements.push({
          start: handler.body.getStart(source),
          end: handler.body.getEnd(),
          content: `{ throw ${handler.parameters[0].name.text}; }`,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (replacements.length !== 1) return null;
  const replacement = replacements[0]!;
  return {
    path: name,
    content:
      content.slice(0, replacement.start) +
      replacement.content +
      content.slice(replacement.end),
  };
}

function isRethrowGuard(statement: ts.Statement, errorName: string): boolean {
  return (
    ts.isIfStatement(statement) &&
    !statement.elseStatement &&
    ts.isBinaryExpression(statement.expression) &&
    statement.expression.operatorToken.kind ===
      ts.SyntaxKind.InstanceOfKeyword &&
    ts.isIdentifier(statement.expression.left) &&
    statement.expression.left.text === errorName &&
    ts.isIdentifier(statement.expression.right) &&
    ts.isThrowStatement(statement.thenStatement) &&
    !!statement.thenStatement.expression &&
    ts.isIdentifier(statement.thenStatement.expression) &&
    statement.thenStatement.expression.text === errorName
  );
}

function wrapsCaughtError(block: ts.Block, errorName: string): boolean {
  const statements = block.statements;
  const last = statements[statements.length - 1];
  if (
    !last ||
    !ts.isThrowStatement(last) ||
    !last.expression ||
    !ts.isNewExpression(last.expression) ||
    !ts.isIdentifier(last.expression.expression) ||
    last.expression.expression.text !== "Error"
  )
    return false;
  return (
    statements.length === 1 ||
    (statements.length === 2 &&
      !!statements[0] &&
      isRethrowGuard(statements[0], errorName))
  );
}

function errorWrapperCount(file: string, content: string): number {
  const source = ts.createSourceFile(
    file,
    content,
    ts.ScriptTarget.Latest,
    true,
  );
  let count = 0;
  const visit = (node: ts.Node) => {
    if (
      ts.isCatchClause(node) &&
      node.variableDeclaration &&
      ts.isIdentifier(node.variableDeclaration.name) &&
      wrapsCaughtError(node.block, node.variableDeclaration.name.text)
    )
      count++;
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "catch" &&
      node.arguments.length === 1
    ) {
      const handler = node.arguments[0];
      if (
        handler &&
        ts.isArrowFunction(handler) &&
        handler.parameters.length === 1 &&
        handler.parameters[0] &&
        ts.isIdentifier(handler.parameters[0].name) &&
        ts.isBlock(handler.body) &&
        wrapsCaughtError(handler.body, handler.parameters[0].name.text)
      )
        count++;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return count;
}

export function repairSingleErrorWrapper(
  before: Record<string, string>,
  after: Record<string, string>,
  allowed: string[],
): { path: string; content: string } | null {
  const candidates = allowed.filter(
    (name) =>
      name.endsWith(".ts") &&
      typeof after[name] === "string" &&
      errorWrapperCount(name, after[name]) >
        errorWrapperCount(name, before[name] ?? ""),
  );
  if (candidates.length !== 1) return null;
  const name = candidates[0]!;
  const content = after[name]!;
  const source = ts.createSourceFile(
    name,
    content,
    ts.ScriptTarget.Latest,
    true,
  );
  const replacements: { start: number; end: number; content: string }[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isCatchClause(node) &&
      node.variableDeclaration &&
      ts.isIdentifier(node.variableDeclaration.name) &&
      wrapsCaughtError(node.block, node.variableDeclaration.name.text)
    )
      replacements.push({
        start: node.block.getStart(source),
        end: node.block.getEnd(),
        content: `{ throw ${node.variableDeclaration.name.text}; }`,
      });
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "catch" &&
      node.arguments.length === 1
    ) {
      const handler = node.arguments[0];
      if (
        handler &&
        ts.isArrowFunction(handler) &&
        handler.parameters.length === 1 &&
        handler.parameters[0] &&
        ts.isIdentifier(handler.parameters[0].name) &&
        ts.isBlock(handler.body) &&
        wrapsCaughtError(handler.body, handler.parameters[0].name.text)
      )
        replacements.push({
          start: handler.body.getStart(source),
          end: handler.body.getEnd(),
          content: `{ throw ${handler.parameters[0].name.text}; }`,
        });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (replacements.length !== 1) return null;
  const replacement = replacements[0]!;
  return {
    path: name,
    content:
      content.slice(0, replacement.start) +
      replacement.content +
      content.slice(replacement.end),
  };
}
