"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertCircle, Check, Copy, Download, LockKeyhole, ShieldCheck, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { CodeEditor } from "@/components/CodeEditor";
import { obfuscateLua, type ObfuscationResult } from "@/lib/obfuscator-simple";
import { detectLua, type LuaDetectionResult } from "@/lua-detector";
import type { ParseError } from "@/lib/parser";
import type { EncryptionAlgorithm } from "@/lib/encryption";
import type { FormattingStyle } from "@/lib/formatter";

const DEFAULT_LUA = `local function greet(name)
    if not name then
        name = "world"
    end

    local message = "Hello, " .. name
    print(message)
end

greet("Lua")
`;

interface Settings {
    mangleNames: boolean;
    encodeStrings: boolean;
    encodeNumbers: boolean;
    controlFlow: boolean;
    minify: boolean;
    protectionLevel: number;
    encryptionAlgorithm: EncryptionAlgorithm;
    controlFlowFlattening: boolean;
    deadCodeInjection: boolean;
    antiDebugging: boolean;
    formattingStyle: FormattingStyle;
}

const INITIAL_SETTINGS: Settings = {
    mangleNames: true,
    encodeStrings: true,
    encodeNumbers: false,
    controlFlow: false,
    minify: true,
    protectionLevel: 60,
    encryptionAlgorithm: "xor",
    controlFlowFlattening: false,
    deadCodeInjection: false,
    antiDebugging: false,
    formattingStyle: "minified",
};

function confidenceLabel(confidence: number): string {
    if (confidence >= 0.95) return "Confirmed Lua";
    if (confidence >= 0.8) return "Lua detected";
    if (confidence >= 0.5) return "Uncertain";
    return "Not Lua";
}

export default function Home() {
    const [inputCode, setInputCode] = useState(DEFAULT_LUA);
    const [outputCode, setOutputCode] = useState("");
    const [settings, setSettings] = useState<Settings>(INITIAL_SETTINGS);
    const [detector, setDetector] = useState<LuaDetectionResult>(() => detectLua(DEFAULT_LUA));
    const [error, setError] = useState<string | null>(null);
    const [inputError, setInputError] = useState<ParseError | undefined>();
    const [isProcessing, setIsProcessing] = useState(false);
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        const timeout = window.setTimeout(() => setDetector(detectLua(inputCode)), 120);
        return () => window.clearTimeout(timeout);
    }, [inputCode]);

    const protectionSummary = useMemo(() => {
        if (settings.protectionLevel >= 90) return "Maximum";
        if (settings.protectionLevel >= 70) return "High";
        if (settings.protectionLevel >= 40) return "Standard";
        return "Light";
    }, [settings.protectionLevel]);

    const obfuscate = async () => {
        setError(null);
        setInputError(undefined);
        setOutputCode("");
        setCopied(false);

        const latestDetection = detectLua(inputCode);
        setDetector(latestDetection);

        if (!latestDetection.isLua) {
            setError(
                "This tool accepts Lua source only. The source was not accepted by the Lua parser, so it was not obfuscated."
            );
            return;
        }

        setIsProcessing(true);
        try {
            const result: ObfuscationResult = await new Promise(resolve => {
                window.setTimeout(() => {
                    resolve(
                        obfuscateLua(inputCode, {
                            ...settings,
                            minify: settings.formattingStyle === "minified",
                        })
                    );
                }, 10);
            });

            if (result.success && result.code) {
                setOutputCode(result.code);
            } else {
                setError(result.error || "Obfuscation failed.");
                setInputError(result.errorDetails);
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : "Unexpected obfuscation error.");
        } finally {
            setIsProcessing(false);
        }
    };

    const copyOutput = async () => {
        if (!outputCode) return;
        await navigator.clipboard.writeText(outputCode);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
    };

    const downloadOutput = () => {
        if (!outputCode) return;
        const blob = new Blob([outputCode], { type: "text/plain;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = "protected.lua";
        link.click();
        URL.revokeObjectURL(url);
    };

    const setPreset = (level: number) => {
        setSettings(current => ({
            ...current,
            protectionLevel: level,
            mangleNames: level >= 20,
            encodeStrings: level >= 40,
            encodeNumbers: level >= 60,
            controlFlow: level >= 80,
            minify: true,
            encryptionAlgorithm: level >= 70 ? "xor" : "none",
            controlFlowFlattening: level >= 90,
            deadCodeInjection: level >= 80,
            antiDebugging: level >= 95,
            formattingStyle: "minified",
        }));
    };

    return (
        <main className="min-h-screen bg-[#f3f1eb] text-[#1f2933]">
            <header className="border-b border-[#d7d3ca] bg-[#fffdf8]">
                <div className="mx-auto flex max-w-[1500px] items-center justify-between px-5 py-4">
                    <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 items-center justify-center border border-[#20262e] bg-[#20262e] text-white">
                            <LockKeyhole className="h-4 w-4" />
                        </div>
                        <div>
                            <div className="text-sm font-semibold tracking-wide">SUN LUA PROTECTOR</div>
                            <div className="text-[11px] uppercase tracking-[0.22em] text-[#6b7280]">
                                Lua source protection
                            </div>
                        </div>
                    </div>

                    <div className="hidden items-center gap-6 text-xs text-[#6b7280] sm:flex">
                        <span>Lua only</span>
                        <span>Parser verified</span>
                        <span>Runs locally</span>
                    </div>
                </div>
            </header>

            <div className="mx-auto max-w-[1500px] px-5 py-6">
                <div className="mb-5 border border-[#d7d3ca] bg-[#fffdf8] px-5 py-4">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                        <div>
                            <div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-[#6b7280]">
                                <ShieldCheck className="h-4 w-4" />
                                Source verification
                            </div>
                            <div className="text-lg font-semibold">{confidenceLabel(detector.confidence)}</div>
                            <div className="mt-1 text-sm text-[#6b7280]">
                                {detector.reasons.join(" ")}
                            </div>
                        </div>

                        <div className="flex items-center gap-2 border border-[#d7d3ca] bg-[#f7f5ef] px-3 py-2 text-xs">
                            <span
                                className={[
                                    "h-2 w-2 rounded-full",
                                    detector.isLua ? "bg-emerald-600" : "bg-amber-600",
                                ].join(" ")}
                            />
                            {Math.round(detector.confidence * 100)}% confidence
                        </div>
                    </div>
                </div>

                <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
                    <div className="grid min-h-[650px] gap-5 lg:grid-cols-2">
                        <section className="flex min-h-[500px] flex-col border border-[#d7d3ca] bg-[#fffdf8]">
                            <div className="flex items-center justify-between border-b border-[#d7d3ca] px-4 py-3">
                                <div>
                                    <div className="text-sm font-semibold">Lua source</div>
                                    <div className="text-xs text-[#7b8190]">Only Lua syntax is accepted.</div>
                                </div>
                                <div className="border border-[#d7d3ca] px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-[#6b7280]">
                                    .lua
                                </div>
                            </div>
                            <div className="min-h-0 flex-1 bg-[#111827]">
                                <CodeEditor
                                    value={inputCode}
                                    onChange={value => {
                                        setInputCode(value);
                                        setError(null);
                                        setInputError(undefined);
                                    }}
                                    error={inputError}
                                    height="100%"
                                />
                            </div>
                        </section>

                        <section className="flex min-h-[500px] flex-col border border-[#d7d3ca] bg-[#fffdf8]">
                            <div className="flex items-center justify-between border-b border-[#d7d3ca] px-4 py-3">
                                <div>
                                    <div className="text-sm font-semibold">Protected output</div>
                                    <div className="text-xs text-[#7b8190]">Generated only after Lua verification.</div>
                                </div>
                                <div className="flex gap-2">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={copyOutput}
                                        disabled={!outputCode}
                                        className="rounded-none border-[#c8c4bb] bg-transparent"
                                    >
                                        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                                        {copied ? "Copied" : "Copy"}
                                    </Button>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={downloadOutput}
                                        disabled={!outputCode}
                                        className="rounded-none border-[#c8c4bb] bg-transparent"
                                    >
                                        <Download className="h-3.5 w-3.5" />
                                        Save
                                    </Button>
                                </div>
                            </div>
                            <div className="min-h-0 flex-1 bg-[#111827]">
                                <CodeEditor value={outputCode} readOnly height="100%" />
                            </div>
                        </section>
                    </div>

                    <aside className="border border-[#d7d3ca] bg-[#fffdf8]">
                        <div className="border-b border-[#d7d3ca] px-4 py-4">
                            <div className="text-sm font-semibold">Protection settings</div>
                            <div className="mt-1 text-xs text-[#7b8190]">
                                Presets are shortcuts; every setting remains editable.
                            </div>
                        </div>

                        <div className="space-y-5 p-4">
                            <div>
                                <div className="mb-2 flex items-center justify-between text-xs">
                                    <span className="font-semibold uppercase tracking-wider text-[#6b7280]">Preset</span>
                                    <span className="font-medium text-[#20262e]">{protectionSummary}</span>
                                </div>
                                <div className="grid grid-cols-4 gap-2">
                                    {[20, 40, 70, 100].map(level => (
                                        <button
                                            key={level}
                                            type="button"
                                            onClick={() => setPreset(level)}
                                            className={[
                                                "border px-2 py-2 text-xs font-semibold transition",
                                                settings.protectionLevel === level
                                                    ? "border-[#20262e] bg-[#20262e] text-white"
                                                    : "border-[#d7d3ca] bg-[#f7f5ef] text-[#374151] hover:bg-[#ece9e1]",
                                            ].join(" ")}
                                        >
                                            {level}%
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className="border-y border-[#e3dfd6] py-4">
                                <div className="mb-3 flex items-center justify-between text-xs">
                                    <span className="font-semibold uppercase tracking-wider text-[#6b7280]">Protection level</span>
                                    <span className="font-mono">{settings.protectionLevel}%</span>
                                </div>
                                <input
                                    className="w-full accent-[#20262e]"
                                    type="range"
                                    min={0}
                                    max={100}
                                    step={5}
                                    value={settings.protectionLevel}
                                    onChange={event => setPreset(Number(event.target.value))}
                                />
                            </div>

                            <div className="space-y-3">
                                {[
                                    ["mangleNames", "Mangle local names"],
                                    ["encodeStrings", "Encode strings"],
                                    ["encodeNumbers", "Encode numbers"],
                                    ["controlFlow", "Obscure conditions"],
                                    ["controlFlowFlattening", "Flatten control flow"],
                                    ["deadCodeInjection", "Inject dead code"],
                                    ["antiDebugging", "Runtime checks"],
                                    ["minify", "Minify output"],
                                ].map(([key, label]) => (
                                    <label key={key} className="flex items-center justify-between gap-3 text-sm">
                                        <span>{label}</span>
                                        <Switch
                                            checked={Boolean(settings[key as keyof Settings])}
                                            onCheckedChange={checked =>
                                                setSettings(current => ({
                                                    ...current,
                                                    [key]: checked,
                                                }))
                                            }
                                        />
                                    </label>
                                ))}
                            </div>

                            <div>
                                <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-[#6b7280]">
                                    String method
                                </label>
                                <select
                                    className="h-9 w-full border border-[#c8c4bb] bg-white px-3 text-sm outline-none focus:border-[#20262e]"
                                    value={settings.encryptionAlgorithm}
                                    onChange={event =>
                                        setSettings(current => ({
                                            ...current,
                                            encryptionAlgorithm: event.target.value as EncryptionAlgorithm,
                                        }))
                                    }
                                >
                                    <option value="none">None</option>
                                    <option value="xor">XOR</option>
                                    <option value="base64">Base64</option>
                                    <option value="huffman">Huffman</option>
                                    <option value="chunked">Chunked</option>
                                </select>
                            </div>

                            <div className="border-t border-[#e3dfd6] pt-4">
                                <Button
                                    onClick={obfuscate}
                                    disabled={isProcessing || !inputCode.trim() || !detector.isLua}
                                    className="h-11 w-full rounded-none bg-[#20262e] text-white hover:bg-[#111827]"
                                >
                                    {isProcessing ? (
                                        <>
                                            <Sparkles className="h-4 w-4 animate-pulse" />
                                            Protecting…
                                        </>
                                    ) : (
                                        <>
                                            <LockKeyhole className="h-4 w-4" />
                                            Protect Lua
                                        </>
                                    )}
                                </Button>
                                <p className="mt-2 text-[11px] leading-5 text-[#7b8190]">
                                    Input is parser-checked immediately before protection. Non-Lua source is rejected.
                                </p>
                            </div>
                        </div>
                    </aside>
                </section>

                {error && (
                    <div className="mt-5 flex items-start gap-3 border border-[#d6b4b4] bg-[#fff7f7] px-4 py-3 text-sm text-[#8b2f2f]">
                        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                        <div>{error}</div>
                    </div>
                )}

                <footer className="mt-6 border-t border-[#d7d3ca] py-4 text-xs text-[#7b8190]">
                    Source detection is parser-backed and local. Obfuscation is not a guarantee against reverse engineering.
                </footer>
            </div>
        </main>
    );
}
