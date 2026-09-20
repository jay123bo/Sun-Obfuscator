import { parseLua, type ParseError } from "./parser";
import { encryptString, generateDecryptorCode, type EncryptionAlgorithm } from "./encryption";
import { generateUnreachableBlock } from "./dead-code";
import { generateAntiDebugFunction } from "./anti-debug";
import { formatCode, type FormattingStyle, type IndentChar } from "./formatter";
import { calculateMetrics, MetricsTracker, type ObfuscationMetrics } from "./metrics";

type LuaTokenKind = "word" | "number" | "string" | "comment" | "symbol";

interface LuaToken {
  kind: LuaTokenKind;
  start: number;
  end: number;
  raw: string;
  value?: string;
}

interface Replacement {
  start: number;
  end: number;
  value: string;
}

interface ScopeBinding {
  name: string;
  start: number;
  end: number;
  mangled: string;
}

interface Scope {
  start: number;
  end: number;
  parent: Scope | null;
  bindings: Map<string, ScopeBinding[]>;
}

export interface ObfuscationOptions {
  mangleNames?: boolean;
  encodeStrings?: boolean;
  encodeNumbers?: boolean;
  controlFlow?: boolean;
  minify?: boolean;
  protectionLevel?: number;

  encryptionAlgorithm?: EncryptionAlgorithm;
  controlFlowFlattening?: boolean;
  deadCodeInjection?: boolean;
  antiDebugging?: boolean;
  formattingStyle?: FormattingStyle;
  indentSize?: number;
  indentChar?: IndentChar;

  /**
   * Wrap the transformed program in a small reversible bytecode-like loader.
   * Automatically enabled at protectionLevel 100 unless explicitly disabled.
   */
  vmSeal?: boolean;

  /**
   * AST/range validation is enabled by default after transformation.
   */
  selfValidate?: boolean;
}

export interface ObfuscationResult {
  success: boolean;
  code?: string;
  error?: string;
  errorDetails?: ParseError;
  metrics?: ObfuscationMetrics;
}

const LUA_KEYWORDS = new Set([
  "and", "break", "do", "else", "elseif", "end", "false", "for", "function",
  "goto", "if", "in", "local", "nil", "not", "or", "repeat", "return",
  "then", "true", "until", "while",
]);

function readLongBracketEnd(code: string, start: number): number {
  if (code[start] !== "[") return -1;
  let i = start + 1;
  while (code[i] === "=") i++;
  if (code[i] !== "[") return -1;
  const level = i - start - 1;
  const close = "]" + "=".repeat(level) + "]";
  const end = code.indexOf(close, i + 1);
  return end < 0 ? code.length : end + close.length;
}

function scanLua(code: string): LuaToken[] {
  const tokens: LuaToken[] = [];
  const isIdStart = (c: string | undefined) => !!c && /[A-Za-z_]/.test(c);
  const isId = (c: string | undefined) => !!c && /[A-Za-z0-9_]/.test(c);

  let i = 0;
  while (i < code.length) {
    const ch = code[i];

    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    if (ch === "-" && code[i + 1] === "-") {
      const longEnd = readLongBracketEnd(code, i + 2);
      if (longEnd >= 0) {
        tokens.push({ kind: "comment", start: i, end: longEnd, raw: code.slice(i, longEnd) });
        i = longEnd;
        continue;
      }
      let end = code.indexOf("\n", i + 2);
      if (end < 0) end = code.length;
      tokens.push({ kind: "comment", start: i, end, raw: code.slice(i, end) });
      i = end;
      continue;
    }

    if (ch === "'" || ch === '"') {
      const quote = ch;
      const start = i++;
      while (i < code.length) {
        if (code[i] === "\\") {
          i += Math.min(2, code.length - i);
          continue;
        }
        if (code[i] === quote) {
          i++;
          break;
        }
        i++;
      }
      tokens.push({ kind: "string", start, end: i, raw: code.slice(start, i) });
      continue;
    }

    const longStringEnd = ch === "[" ? readLongBracketEnd(code, i) : -1;
    if (longStringEnd >= 0) {
      tokens.push({ kind: "string", start: i, end: longStringEnd, raw: code.slice(i, longStringEnd) });
      i = longStringEnd;
      continue;
    }

    if (isIdStart(ch)) {
      const start = i++;
      while (isId(code[i])) i++;
      const raw = code.slice(start, i);
      tokens.push({ kind: "word", start, end: i, raw, value: raw });
      continue;
    }

    if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(code[i + 1] || ""))) {
      const start = i;

      if (ch === "0" && /[xX]/.test(code[i + 1] || "")) {
        i += 2;
        while (/[0-9A-Fa-f]/.test(code[i] || "")) i++;
        if (code[i] === ".") {
          i++;
          while (/[0-9A-Fa-f]/.test(code[i] || "")) i++;
        }
        if (/[pP]/.test(code[i] || "")) {
          i++;
          if (/[+-]/.test(code[i] || "")) i++;
          while (/[0-9]/.test(code[i] || "")) i++;
        }
      } else {
        i++;
        while (/[0-9]/.test(code[i] || "")) i++;
        if (code[i] === ".") {
          i++;
          while (/[0-9]/.test(code[i] || "")) i++;
        }
        if (/[eE]/.test(code[i] || "")) {
          i++;
          if (/[+-]/.test(code[i] || "")) i++;
          while (/[0-9]/.test(code[i] || "")) i++;
        }
      }

      tokens.push({ kind: "number", start, end: i, raw: code.slice(start, i), value: code.slice(start, i) });
      continue;
    }

    const start = i;
    const three = code.slice(i, i + 3);
    const two = code.slice(i, i + 2);

    if (three === "...") i += 3;
    else if (
      two === ".." || two === "==" || two === "~=" || two === "<=" || two === ">=" ||
      two === "::" || two === "+=" || two === "-=" || two === "*=" || two === "/=" ||
      two === "%=" || two === "^="
    ) i += 2;
    else i++;

    tokens.push({ kind: "symbol", start, end: i, raw: code.slice(start, i) });
  }

  return tokens;
}

function walkAst(node: any, visit: (node: any, parent: any) => void, parent: any = null): void {
  if (!node || typeof node !== "object") return;
  visit(node, parent);
  if (Array.isArray(node)) {
    for (const child of node) walkAst(child, visit, parent);
    return;
  }
  for (const key of Object.keys(node)) {
    if (key === "parent" || key === "range" || key === "loc") continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (const child of value) walkAst(child, visit, node);
    } else if (value && typeof value === "object") {
      walkAst(value, visit, node);
    }
  }
}

function getRange(node: any): [number, number] | null {
  return Array.isArray(node?.range) && node.range.length === 2 ? [node.range[0], node.range[1]] : null;
}

function isScopeNode(type: string): boolean {
  return type === "Chunk" ||
    type === "FunctionDeclaration" ||
    type === "IfClause" ||
    type === "ElseifClause" ||
    type === "ElseClause" ||
    type === "WhileStatement" ||
    type === "RepeatStatement" ||
    type === "ForNumericStatement" ||
    type === "ForGenericStatement" ||
    type === "DoStatement";
}

function addBinding(scope: Scope, name: string, range: [number, number], nextName: () => string): void {
  if (!name || LUA_KEYWORDS.has(name) || name.startsWith("__obf_")) return;
  const list = scope.bindings.get(name) || [];
  list.push({ name, start: range[0], end: range[1], mangled: nextName() });
  scope.bindings.set(name, list);
}

function buildScopes(ast: any, nextName: () => string): Scope[] {
  const rootRange = getRange(ast) || [0, Number.MAX_SAFE_INTEGER];
  const root: Scope = { start: rootRange[0], end: rootRange[1], parent: null, bindings: new Map() };
  const scopes: Scope[] = [root];

  const visit = (node: any, current: Scope) => {
    if (!node || typeof node !== "object") return;

    let scope = current;

    if (isScopeNode(node.type)) {
      const range = getRange(node);
      if (range && node.type !== "Chunk") {
        scope = { start: range[0], end: range[1], parent: current, bindings: new Map() };
        scopes.push(scope);
      }
    }

    if (node.type === "LocalStatement" && Array.isArray(node.variables)) {
      for (const variable of node.variables) {
        const range = getRange(variable);
        if (range) addBinding(scope, variable.name, range, nextName);
      }
    }

    if (node.type === "FunctionDeclaration") {
      if (node.isLocal && node.identifier) {
        const range = getRange(node.identifier);
        if (range) addBinding(current, node.identifier.name, range, nextName);
      }
      for (const parameter of node.parameters || []) {
        const range = getRange(parameter);
        if (range && parameter.type === "Identifier") {
          addBinding(scope, parameter.name, range, nextName);
        }
      }
    }

    if (node.type === "ForNumericStatement") {
      const range = getRange(node.variable);
      if (range && node.variable.type === "Identifier") {
        addBinding(scope, node.variable.name, range, nextName);
      }
    }

    if (node.type === "ForGenericStatement") {
      for (const variable of node.variables || []) {
        const range = getRange(variable);
        if (range && variable.type === "Identifier") {
          addBinding(scope, variable.name, range, nextName);
        }
      }
    }

    for (const key of Object.keys(node)) {
      if (key === "parent" || key === "range" || key === "loc") continue;
      const value = node[key];
      if (Array.isArray(value)) {
        for (const child of value) visit(child, scope);
      } else if (value && typeof value === "object") {
        visit(value, scope);
      }
    }
  };

  visit(ast, root);
  return scopes;
}

function findScope(scopes: Scope[], position: number): Scope {
  let best = scopes[0];
  for (const scope of scopes) {
    if (scope.start <= position && position < scope.end) {
      if (scope.start >= best.start && scope.end <= best.end) best = scope;
    }
  }
  return best;
}

function resolveBinding(scope: Scope, name: string, position: number): ScopeBinding | null {
  let current: Scope | null = scope;
  while (current) {
    const list = current.bindings.get(name);
    if (list) {
      let selected: ScopeBinding | null = null;
      for (const binding of list) {
        if (binding.start <= position && (!selected || binding.start > selected.start)) selected = binding;
      }
      if (selected) return selected;
    }
    current = current.parent;
  }
  return null;
}

function rewriteRanges(code: string, replacements: Replacement[]): string {
  if (!replacements.length) return code;
  replacements.sort((a, b) => b.start - a.start);
  let result = code;
  for (const replacement of replacements) {
    result = result.slice(0, replacement.start) + replacement.value + result.slice(replacement.end);
  }
  return result;
}

function decodeLuaStringLiteral(raw: string): string {
  if (raw.startsWith("[")) {
    let i = 1;
    while (raw[i] === "=") i++;
    if (raw[i] === "[") {
      const level = i - 1;
      const close = "]" + "=".repeat(level) + "]";
      const body = raw.endsWith(close) ? raw.slice(i + 1, -close.length) : raw.slice(i + 1);
      return body;
    }
  }

  if (raw.length < 2) return raw;
  const quote = raw[0];
  let out = "";

  for (let i = 1; i < raw.length - 1; i++) {
    const c = raw[i];
    if (c !== "\\") {
      out += c;
      continue;
    }

    i++;
    if (i >= raw.length - 1) break;
    const e = raw[i];
    const simple: Record<string, string> = {
      a: "\x07",
      b: "\b",
      f: "\f",
      n: "\n",
      r: "\r",
      t: "\t",
      v: "\v",
      "\\": "\\",
      "\"": "\"",
      "'": "'",
    };

    if (simple[e] !== undefined) {
      out += simple[e];
      continue;
    }

    if (e === "x" && /^[0-9A-Fa-f]{2}$/.test(raw.slice(i + 1, i + 3))) {
      out += String.fromCharCode(parseInt(raw.slice(i + 1, i + 3), 16));
      i += 2;
      continue;
    }

    if (/[0-9]/.test(e)) {
      let digits = e;
      while (digits.length < 3 && /[0-9]/.test(raw[i + 1] || "")) digits += raw[++i];
      out += String.fromCharCode(parseInt(digits, 10));
      continue;
    }

    if (e === "\n") continue;
    if (e === "\r") {
      if (raw[i + 1] === "\n") i++;
      continue;
    }

    out += e;
  }

  return out;
}

function toUtf8Bytes(text: string): number[] {
  if (typeof TextEncoder !== "undefined") return Array.from(new TextEncoder().encode(text));
  const encoded = unescape(encodeURIComponent(text));
  const bytes: number[] = [];
  for (let i = 0; i < encoded.length; i++) bytes.push(encoded.charCodeAt(i));
  return bytes;
}

function hexName(counter: number): string {
  const salt = Math.floor(Math.random() * 0x10000).toString(16).padStart(4, "0").toUpperCase();
  return "_0x" + salt + counter.toString(16).padStart(2, "0").toUpperCase();
}

function safeMinify(code: string): string {
  const tokens = scanLua(code).filter(token => token.kind !== "comment");
  if (!tokens.length) return "";

  const needsSpace = (a: LuaToken, b: LuaToken): boolean => {
    const wordLike = (k: LuaTokenKind) => k === "word" || k === "number";
    if (wordLike(a.kind) && wordLike(b.kind)) return true;
    if (wordLike(a.kind) && b.kind === "string") return true;
    if (a.kind === "string" && wordLike(b.kind)) return false;
    if (a.raw === "-" && b.raw === "-") return true;
    if (a.raw === "." && b.raw === ".") return true;
    return false;
  };

  let out = "";
  let previous: LuaToken | null = null;

  for (const token of tokens) {
    if (previous && needsSpace(previous, token)) out += " ";
    out += token.raw;
    previous = token;
  }

  return out.trim();
}

function makeOpaquePredicate(): string {
  const a = 3 + Math.floor(Math.random() * 17);
  const b = 3 + Math.floor(Math.random() * 13);
  return "((" + a + "*" + b + ")>=" + (a * b) + ")";
}

function containsGotoOrLabel(tokens: LuaToken[]): boolean {
  return tokens.some(token => token.kind === "word" && token.value === "goto") ||
    tokens.some(token => token.raw === "::");
}

function transformConditions(code: string, intensity: number, metrics: MetricsTracker): string {
  if (intensity <= 0) return code;
  const parsed = parseLua(code);
  if (!parsed.success || !parsed.ast) return code;

  const replacements: Replacement[] = [];
  walkAst(parsed.ast, node => {
    if (node.type === "IfClause" || node.type === "ElseifClause" || node.type === "WhileStatement" || node.type === "RepeatStatement") {
      const condition = node.condition;
      const range = getRange(condition);
      if (!range) return;
      if (Math.random() * 100 > intensity) return;
      const original = code.slice(range[0], range[1]);
      replacements.push({ start: range[0], end: range[1], value: "(" + makeOpaquePredicate() + " and (" + original + "))" });
      metrics.incrementControlFlowFlattened();
    }
  });

  return rewriteRanges(code, replacements);
}

function flattenWholeChunk(code: string, metrics: MetricsTracker): string {
  const tokens = scanLua(code);
  if (containsGotoOrLabel(tokens)) return code;
  if (tokens.length < 8) return code;

  const state = "__obf_state_" + Math.floor(Math.random() * 0xFFFFFF).toString(16);
  const entry = 100 + Math.floor(Math.random() * 900);
  const dead = entry + 1;
  const deadCode = generateUnreachableBlock().replace(/^/gm, "  ");

  const wrapped =
    "local " + state + "=" + entry + "\n" +
    "while true do\n" +
    "  if " + state + "==" + entry + " then\n" +
    "    do\n" +
    code.split("\n").map(line => "      " + line).join("\n") +
    "    end\n" +
    "    " + state + "=" + (entry + 2) + "\n" +
    "  elseif " + state + "==" + dead + " then\n" +
    "    " + deadCode.replace(/\n/g, "\n    ") + "\n" +
    "    " + state + "=" + (entry + 2) + "\n" +
    "  else\n" +
    "    break\n" +
    "  end\n" +
    "end";

  metrics.incrementControlFlowFlattened();
  return wrapped;
}

function injectDeadCodeSafely(code: string, protectionLevel: number, metrics: MetricsTracker): string {
  if (protectionLevel <= 0) return code;
  const blocks = Math.max(1, Math.min(8, Math.floor(protectionLevel / 20)));

  const snippets: string[] = [];
  for (let i = 0; i < blocks; i++) {
    if (Math.random() * 100 <= Math.min(100, protectionLevel + 10)) {
      snippets.push(generateUnreachableBlock());
      metrics.incrementDeadCodeBlocks();
    }
  }

  if (!snippets.length) return code;
  return snippets.join("\n") + "\n" + code;
}

function applyVmSeal(code: string): string {
  const alphabetBase = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const alphabet = alphabetBase.split("").sort(() => Math.random() - 0.5).join("");
  const primary = 17 + Math.floor(Math.random() * 223);
  const secondary = 1024 + Math.floor(Math.random() * 59000);
  const tertiary = 17 + Math.floor(Math.random() * 223);
  const chunkSize = 22;

  const bytes = toUtf8Bytes(code);
  const chunks: string[] = [];

  const b64 = (data: number[]): string => {
    let out = "";
    for (let i = 0; i < data.length; i += 3) {
      const b0 = data[i] || 0;
      const b1 = data[i + 1] || 0;
      const b2 = data[i + 2] || 0;
      const n = (b0 << 16) | (b1 << 8) | b2;
      out += alphabet[(n >>> 18) & 63];
      out += alphabet[(n >>> 12) & 63];
      out += i + 1 < data.length ? alphabet[(n >>> 6) & 63] : "=";
      out += i + 2 < data.length ? alphabet[n & 63] : "=";
    }
    return out;
  };

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const slice = bytes.slice(offset, offset + chunkSize);
    const index = Math.floor(offset / chunkSize);
    const k1 = (primary + index * 37) & 255;
    const encoded = slice.map((value, j) => value ^ ((k1 + j * 3) & 255));
    const k2 = (secondary + index * 7) & 255;
    for (let j = 0; j < encoded.length; j++) encoded[j] = (encoded[j] + k2 + j) & 255;
    for (let j = 0; j < encoded.length; j++) encoded[j] ^= tertiary;
    encoded.reverse();
    chunks.push(b64(encoded));
  }

  let hash = 0;
  for (let i = 0; i < chunks.length; i++) {
    for (let j = 0; j < chunks[i].length; j++) {
      hash = (hash * 131 + chunks[i].charCodeAt(j)) % 1000003;
    }
    hash = (hash + (i + 1) * 17) % 1000003;
  }

  const safe = (n: number) => "(" + n + ")";
  const data = chunks.map(item => JSON.stringify(item)).join(",");
  const state = "_0x" + Math.floor(Math.random() * 0xFFFFFFF).toString(16);
  const decoder = "_d" + Math.floor(Math.random() * 0xFFFFFF).toString(16);
  const exec = "_e" + Math.floor(Math.random() * 0xFFFFFF).toString(16);
  const out = "_o" + Math.floor(Math.random() * 0xFFFFFF).toString(16);
  const temp = "_t" + Math.floor(Math.random() * 0xFFFFFF).toString(16);
  const bx = "_x" + Math.floor(Math.random() * 0xFFFFFF).toString(16);

  const lua =
    "local " + bx + "=function(a,b)local r=0 local p=1 while a>0 or b>0 do local aa=a%2 local bb=b%2 if aa~=bb then r=r+p end a=math.floor(a/2)b=math.floor(b/2)p=p*2 end return r end " +
    "local " + state + "={" + data + "}" +
    "local " + decoder + "=function(" + temp + ")local a='" + alphabet + "'local m={}for i=1,64 do m[a:sub(i,i)]=i-1 end " +
    temp + "=" + temp + ":gsub('[^'..a..'=]','')local o=''for i=1,#" + temp + ",4 do " +
    "local x=m[" + temp + ":sub(i,i)]or 0 local y=m[" + temp + ":sub(i+1,i+1)]or 0 " +
    "local z=" + temp + ":sub(i+2,i+2)=='=' and 0 or(m[" + temp + ":sub(i+2,i+2)]or 0) " +
    "local q=" + temp + ":sub(i+3,i+3)=='=' and 0 or(m[" + temp + ":sub(i+3,i+3)]or 0) " +
    "local n=x*262144+y*4096+z*64+q " +
    "o=o..string.char(math.floor(n/65536)%256)if " + temp + ":sub(i+2,i+2)~='=' then o=o..string.char(math.floor(n/256)%256)end " +
    "if " + temp + ":sub(i+3,i+3)~='=' then o=o..string.char(n%256)end end return o end " +
    "local function " + exec + "()if #" + state + "~=" + safe(chunks.length) + " then error('VM integrity')end " +
    "local h=0 for i=1,#" + state + " do local s=" + state + "[i]for j=1,#s do h=(h*131+string.byte(s,j))%1000003 end h=(h+i*17)%1000003 end " +
    "if h~=" + safe(hash) + " then error('VM integrity')end local " + out + "='' " +
    "for i=1,#" + state + " do local d=" + decoder + "(" + state + "[i])d=d:reverse()local t='' " +
    "for j=1,#d do t=t..string.char(" + bx + "(string.byte(d,j)," + safe(tertiary) + ")) end d=t " +
    "do local k=(" + safe(secondary) + "+(i-1)*7)%256 local t=''for j=1,#d do t=t..string.char((string.byte(d,j)-k-(j-1)+512)%256)end d=t end " +
    "do local k=(" + safe(primary) + "+(i-1)*37)%256 local t=''for j=1,#d do t=t..string.char(" + bx + "(string.byte(d,j),((k+(j-1)*3)%256)))end d=t end " +
    out + "=" + out + "..d end " +
    "local f,e=(loadstring or load)(" + out + ")if not f then error('VM load failed: '..tostring(e))end return f()end return " + exec + "()";

  return lua;
}

export class LuaObfuscator {
  private counter = 0;
  private metricsTracker = new MetricsTracker();

  obfuscate(
    code: string,
    options: ObfuscationOptions = {
      mangleNames: true,
      encodeStrings: false,
      encodeNumbers: false,
      controlFlow: false,
      minify: true,
      protectionLevel: 50,
    }
  ): ObfuscationResult {
    const startTime = Date.now();

    try {
      this.counter = 0;
      this.metricsTracker.reset();

      const initial = parseLua(code);
      if (!initial.success || !initial.ast) {
        return {
          success: false,
          error: initial.error || "Invalid Lua syntax",
          errorDetails: initial.errorDetails,
        };
      }

      const level = options.protectionLevel ?? 50;
      const algorithm = options.encodeStrings
        ? (options.encryptionAlgorithm || (level >= 70 ? "xor" : "none"))
        : "none";

      let transformed = code;

      if (options.mangleNames !== false) {
        transformed = this.mangleLocalNames(transformed);
      }

      if (options.encodeNumbers) {
        transformed = this.encodeNumbersSafe(transformed, level);
      }

      if (options.encodeStrings) {
        transformed = this.encodeStringsSafe(transformed, algorithm);
      }

      if (options.controlFlow) {
        transformed = transformConditions(transformed, level, this.metricsTracker);
      }

      if (options.deadCodeInjection) {
        transformed = injectDeadCodeSafely(transformed, level, this.metricsTracker);
      }

      if (options.antiDebugging) {
        transformed = generateAntiDebugFunction(["debug", "environment"]) + "\n" + transformed;
        this.metricsTracker.incrementAntiDebugChecks(2);
      }

      if (options.controlFlowFlattening) {
        transformed = flattenWholeChunk(transformed, this.metricsTracker);
      }

      if (options.mangleNames !== false) {
        transformed = this.mangleLocalNames(transformed);
      }

      const style = options.formattingStyle;
      if (style) {
        transformed = formatCode(transformed, {
          style,
          indentSize: options.indentSize,
          indentChar: options.indentChar,
        });
      } else if (options.minify) {
        transformed = safeMinify(transformed);
      }

      if (options.selfValidate !== false) {
        const validation = parseLua(transformed);
        if (!validation.success) {
          return {
            success: false,
            error: "Transformation produced invalid Lua: " + (validation.error || "syntax error"),
            errorDetails: validation.errorDetails,
          };
        }
      }

      const vmSeal = options.vmSeal ?? level >= 100;
      if (vmSeal) transformed = applyVmSeal(transformed);

      const duration = Date.now() - startTime;
      const metrics = calculateMetrics(
        code,
        transformed,
        this.metricsTracker.getCounts(),
        duration,
        algorithm,
        "client"
      );

      return { success: true, code: transformed, metrics };
    } catch (error: any) {
      return {
        success: false,
        error: error?.message || "Obfuscation failed",
      };
    }
  }

  private mangleLocalNames(code: string): string {
    const parsed = parseLua(code);
    if (!parsed.success || !parsed.ast) return code;

    const identifiers = scanLua(code).filter(token => token.kind === "word").map(token => token.value || "");
    const used = new Set(identifiers);
    const nextName = () => {
      let name = "";
      do {
        name = hexName(this.counter++);
      } while (used.has(name));
      used.add(name);
      return name;
    };

    const scopes = buildScopes(parsed.ast, nextName);
    const replacements: Replacement[] = [];
    const tokens = scanLua(code);

    const propertyRanges: Replacement[] = [];
    walkAst(parsed.ast, (node, parent) => {
      if (node.type !== "Identifier") return;
      if (parent?.type === "MemberExpression" && parent.identifier === node) {
        const range = getRange(node);
        if (range) propertyRanges.push({ start: range[0], end: range[1], value: "" });
      }
      if (parent?.type === "TableKeyString" && parent.key === node) {
        const range = getRange(node);
        if (range) propertyRanges.push({ start: range[0], end: range[1], value: "" });
      }
    });

    const isProtectedRange = (start: number, end: number) =>
      propertyRanges.some(range => range.start === start && range.end === end);

    for (const token of tokens) {
      if (token.kind !== "word" || !token.value || LUA_KEYWORDS.has(token.value)) continue;

      const previous = tokens.slice(0, tokens.indexOf(token)).reverse().find(t => t.kind !== "comment");
      if (previous && (previous.raw === "." || previous.raw === ":")) continue;
      if (isProtectedRange(token.start, token.end)) continue;

      const scope = findScope(scopes, token.start);
      const binding = resolveBinding(scope, token.value, token.start);
      if (!binding) continue;

      replacements.push({ start: token.start, end: token.end, value: binding.mangled });
    }

    const before = replacements.length;
    const result = rewriteRanges(code, replacements);
    if (before) this.metricsTracker.incrementNamesMangled(new Set(replacements.map(r => r.start + ":" + r.end)).size);
    return result;
  }

  private encodeNumbersSafe(code: string, level: number): string {
    const parsed = parseLua(code);
    if (!parsed.success || !parsed.ast) return code;

    const replacements: Replacement[] = [];
    walkAst(parsed.ast, node => {
      if (node.type !== "NumericLiteral") return;
      const range = getRange(node);
      if (!range || typeof node.value !== "number" || !Number.isFinite(node.value)) return;
      if (Math.abs(node.value) <= 3 || !Number.isInteger(node.value)) return;

      const should = level >= 100 || (level > 0 && Math.random() * 100 < level);
      if (!should) return;

      const n = node.value;
      const offset = 7 + Math.floor(Math.random() * 91);
      const strategy = Math.floor(Math.random() * 3);

      let replacement: string;
      if (strategy === 0) {
        replacement = "(" + (n + offset) + "-" + offset + ")";
      } else if (strategy === 1) {
        const factor = 2 + Math.floor(Math.random() * 3);
        replacement = "(" + (n * factor) + "/" + factor + ")";
      } else {
        replacement = "(" + (n + offset) + "-" + offset + ")";
      }

      replacements.push({ start: range[0], end: range[1], value: replacement });
      this.metricsTracker.incrementNumbersEncoded();
    });

    return rewriteRanges(code, replacements);
  }

  private encodeStringsSafe(code: string, algorithm: EncryptionAlgorithm): string {
    const parsed = parseLua(code);
    if (!parsed.success || !parsed.ast) return code;

    const replacements: Replacement[] = [];

    walkAst(parsed.ast, node => {
      if (node.type !== "StringLiteral") return;
      const range = getRange(node);
      if (!range) return;

      const raw = code.slice(range[0], range[1]);
      const value = typeof node.value === "string" ? node.value : decodeLuaStringLiteral(raw);
      if (value.length === 0) return;

      let replacement: string;
      if (algorithm === "none") {
        const bytes = toUtf8Bytes(value);
        replacement = "string.char(" + bytes.join(",") + ")";
      } else {
        replacement = generateDecryptorCode(encryptString(value, algorithm));
      }

      replacements.push({ start: range[0], end: range[1], value: replacement });
      this.metricsTracker.incrementStringsEncoded();
    });

    return rewriteRanges(code, replacements);
  }
}

export function obfuscateLua(code: string, options?: ObfuscationOptions): ObfuscationResult {
  const level = options?.protectionLevel ?? 50;

  const defaults: ObfuscationOptions = {
    mangleNames: level >= 20,
    encodeStrings: level >= 40,
    encodeNumbers: level >= 60,
    controlFlow: level >= 80,
    minify: level >= 10,
    encryptionAlgorithm: level >= 70 ? "xor" : "none",
    controlFlowFlattening: level >= 90,
    deadCodeInjection: level >= 80,
    antiDebugging: level >= 95,
    vmSeal: level >= 100,
    selfValidate: true,
    protectionLevel: level,
  };

  return new LuaObfuscator().obfuscate(code, { ...defaults, ...options, protectionLevel: level });
}
