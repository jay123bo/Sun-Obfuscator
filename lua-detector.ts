import { parseLua } from "./parser";

export interface LuaDetectionResult {
  isLua: boolean;
  confidence: number;
  reasons: string[];
  parserValid: boolean;
}

const STRONG_NON_LUA = [
  /\b(import|from)\s+[A-Za-z_$]/,
  /\b(const|let|var)\s+[A-Za-z_$][\w$]*\s*=/,
  /=>/,
  /\b(def|class)\s+[A-Za-z_][\w]*\s*[:(]/,
  /<\/?[A-Za-z][^>]*>/,
];

const LUA_SIGNALS = [
  /\blocal\b/,
  /\bfunction\b/,
  /\bend\b/,
  /\bthen\b/,
  /\belseif\b/,
  /\brepeat\b/,
  /\buntil\b/,
  /\bfor\b.+\bdo\b/,
  /\bwhile\b.+\bdo\b/,
  /\breturn\b/,
  /\bnil\b/,
  /\btrue\b|\bfalse\b/,
  /--/,
  /\.\./,
  /~=/,
  /\bsetmetatable\s*\(/,
];

export function detectLua(code: string): LuaDetectionResult {
  const source = code.trim();
  if (!source) {
    return {
      isLua: false,
      confidence: 0,
      reasons: ["No source code was provided."],
      parserValid: false,
    };
  }

  const parseResult = parseLua(source);
  const parserValid = parseResult.success;
  const signals = LUA_SIGNALS.filter(pattern => pattern.test(source)).length;
  const hardNonLua = STRONG_NON_LUA.filter(pattern => pattern.test(source)).length;

  let confidence = parserValid ? 0.82 : 0.08;
  confidence += Math.min(signals * 0.025, 0.18);
  confidence -= Math.min(hardNonLua * 0.22, 0.66);
  confidence = Math.max(0, Math.min(1, confidence));

  const reasons: string[] = [];

  if (parserValid) {
    reasons.push("Lua parser accepted the source.");
  } else if (parseResult.error) {
    reasons.push("Lua parser rejected the source syntax.");
  }

  if (signals > 0) {
    reasons.push(`Detected ${signals} Lua-specific syntax signals.`);
  }

  if (hardNonLua > 0) {
    reasons.push("Detected syntax strongly associated with another language.");
  }

  const isLua = parserValid && hardNonLua === 0 && confidence >= 0.8;

  if (!isLua && reasons.length === 0) {
    reasons.push("Source did not meet the Lua detection threshold.");
  }

  return {
    isLua,
    confidence,
    reasons,
    parserValid,
  };
}
