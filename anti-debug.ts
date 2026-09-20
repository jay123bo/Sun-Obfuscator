/**
 * Anti-debugging measures for Lua obfuscation
 * Adds runtime checks to detect and thwart debugging attempts
 */

/**
 * Generate debug library detection code
 * Checks if the debug library is available and terminates if found
 */
export function generateDebugDetection(): string {
  return 'do local _d=debug local _h=nil if _d and _d.gethook then local _a,_b,_c=_d.gethook() _h=_a end if _h~=nil then error("Debug hook detected",0) end end';
}

export function generateTimingCheck(): string {
  const iterations = Math.floor(Math.random() * 500) + 250;
  return 'do local _t1=os and os.clock and os.clock() or 0 for _i=1,' +
    iterations +
    ' do end local _t2=os and os.clock and os.clock() or _t1 if _t2-_t1>0.5 then error("Timing anomaly detected",0) end end';
}

export function generateStackDepthCheck(): string {
  return 'do if debug and debug.traceback then local _s=debug.traceback() if _s and #_s>50000 then error("Stack anomaly detected",0) end end end';
}

export function generateIntegrityCheck(seed: number = Math.floor(Math.random() * 10000)): string {
  const expected = (seed * 55) % 65536;
  return 'do local _chk=' + seed +
    ' local _v=0 for i=1,10 do _v=(_v+i*_chk)%65536 end if _v~=' +
    expected +
    ' then error("Integrity check failed",0) end end';
}

export function generateEnvironmentCheck(): string {
  return 'do local _g=_G if _g and (_g._DEBUG or _g._TRACE or _g._HOOK) then error("Debug environment detected",0) end end';
}

export function generateEnvFunctionCheck(): string {
  return 'do if getfenv and _G and getfenv(0)~=_G then error("Environment manipulation detected",0) end end';
}

export function generateAntiDebugFunction(
  checks: Array<"debug" | "timing" | "stack" | "integrity" | "environment" | "envfunc"> = ["debug", "environment"]
): string {
  const funcName = "_ad_" + Math.floor(Math.random() * 0xFFFFFF).toString(16);
  const body: string[] = [];

  if (checks.includes("debug")) body.push(generateDebugDetection());
  if (checks.includes("timing")) body.push(generateTimingCheck());
  if (checks.includes("stack")) body.push(generateStackDepthCheck());
  if (checks.includes("integrity")) body.push(generateIntegrityCheck());
  if (checks.includes("environment")) body.push(generateEnvironmentCheck());
  if (checks.includes("envfunc")) body.push(generateEnvFunctionCheck());

  return "local function " + funcName + "()\n" +
    body.map(line => "  " + line).join("\n") +
    "\nend\n" + funcName + "()";
}

/**
 * Inject anti-debug checks at strategic points in code
 *
 * @param code - Original Lua code
 * @param frequency - How often to inject (0-100, higher = more checks)
 * @param checks - Array of check types to use
 * @returns Code with anti-debug checks injected
 */
export function injectAntiDebugChecks(
	code: string,
	frequency: number = 30,
	checks: Array<"debug" | "timing" | "stack" | "integrity" | "environment" | "envfunc"> = ["debug", "environment"]
): string {
	const lines = code.split("\n");
	const result: string[] = [];

	// Add initial anti-debug check at the start
	result.push(generateAntiDebugFunction(checks));
	result.push("");

	// Inject checks throughout the code
	for (let i = 0; i < lines.length; i++) {
		result.push(lines[i]);

		const trimmed = lines[i].trim();

		// Inject after function declarations
		if (trimmed.startsWith("function ") || trimmed.startsWith("local function ")) {
			const shouldInject = Math.random() * 100 < frequency;
			if (shouldInject) {
				// Inject a simple inline check
				const inlineCheck = checks[Math.floor(Math.random() * checks.length)];
				if (inlineCheck === "debug") {
					result.push(`  ${generateDebugDetection()}`);
				} else if (inlineCheck === "environment") {
					result.push(`  ${generateEnvironmentCheck()}`);
				}
			}
		}
	}

	return result.join("\n");
}

/**
 * Inject anti-debug checks into AST
 *
 * @param ast - Lua AST
 * @param frequency - How often to inject (0-100)
 * @returns Modified AST with anti-debug nodes
 */
export function injectAntiDebugAST(ast: any, frequency: number = 30): any {
	if (!ast || typeof ast !== "object") {
		return ast;
	}

	// Inject at function declarations
	if (ast.type === "FunctionDeclaration" && Array.isArray(ast.body)) {
		const shouldInject = Math.random() * 100 < frequency;
		if (shouldInject) {
			// Inject debug detection at start of function
			const debugCheck = createDebugDetectionNode();
			ast.body.unshift(debugCheck);
		}
	}

	// Inject at chunk level (main code)
	if (ast.type === "Chunk" && Array.isArray(ast.body)) {
		// Add anti-debug check at the very beginning
		const antiDebugNode = createDebugDetectionNode();
		ast.body.unshift(antiDebugNode);

		// Randomly inject throughout the code
		const newBody: any[] = [];
		for (const statement of ast.body) {
			newBody.push(statement);

			const shouldInject = Math.random() * 100 < frequency / 2; // Less frequent in main body
			if (shouldInject) {
				newBody.push(createEnvironmentCheckNode());
			}
		}
		ast.body = newBody;
	}

	// Recursively process child nodes
	for (const key in ast) {
		if (ast.hasOwnProperty(key) && key !== "parent") {
			if (Array.isArray(ast[key])) {
				ast[key] = ast[key].map((child: any) => injectAntiDebugAST(child, frequency));
			} else if (typeof ast[key] === "object" && ast[key] !== null) {
				ast[key] = injectAntiDebugAST(ast[key], frequency);
			}
		}
	}

	return ast;
}

/**
 * Create debug detection AST node
 */
function createDebugDetectionNode(): any {
	return {
		type: "IfStatement",
		clauses: [
			{
				type: "IfClause",
				condition: {
					type: "BinaryExpression",
					operator: "==",
					left: {
						type: "CallExpression",
						base: { type: "Identifier", name: "type" },
						arguments: [{ type: "Identifier", name: "debug" }],
					},
					right: { type: "StringLiteral", value: "table", raw: '"table"' },
				},
				body: [
					{
						type: "CallStatement",
						expression: {
							type: "CallExpression",
							base: { type: "Identifier", name: "error" },
							arguments: [
								{ type: "StringLiteral", value: "Debug library detected", raw: '"Debug library detected"' },
								{ type: "NumericLiteral", value: 0 },
							],
						},
					},
				],
			},
		],
	};
}

/**
 * Create environment check AST node
 */
function createEnvironmentCheckNode(): any {
	return {
		type: "IfStatement",
		clauses: [
			{
				type: "IfClause",
				condition: {
					type: "LogicalExpression",
					operator: "or",
					left: {
						type: "MemberExpression",
						base: { type: "Identifier", name: "_G" },
						identifier: { type: "Identifier", name: "_DEBUG" },
					},
					right: {
						type: "MemberExpression",
						base: { type: "Identifier", name: "_G" },
						identifier: { type: "Identifier", name: "_TRACE" },
					},
				},
				body: [
					{
						type: "CallStatement",
						expression: {
							type: "CallExpression",
							base: { type: "Identifier", name: "error" },
							arguments: [
								{ type: "StringLiteral", value: "Debug environment detected", raw: '"Debug environment detected"' },
								{ type: "NumericLiteral", value: 0 },
							],
						},
					},
				],
			},
		],
	};
}
