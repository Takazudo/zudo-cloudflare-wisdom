import { useEffect, useState } from "react";
import { createHighlighterCore, type HighlighterCore } from "@shikijs/core";
import { createJavaScriptRegexEngine } from "@shikijs/engine-javascript";

let highlighterPromise: Promise<HighlighterCore> | null = null;

function getHighlighter(): Promise<HighlighterCore> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighterCore({
      themes: [
        import("@shikijs/themes/catppuccin-latte"),
        import("@shikijs/themes/vitesse-dark"),
      ],
      langs: [
        import("@shikijs/langs/html"),
        import("@shikijs/langs/css"),
        import("@shikijs/langs/javascript"),
      ],
      engine: createJavaScriptRegexEngine(),
    }).catch((err) => {
      // Clear cached rejection so next call retries
      highlighterPromise = null;
      throw err;
    });
  }
  return highlighterPromise;
}

interface HighlightedCodeProps {
  code: string;
  language: string;
}

export default function HighlightedCode({
  code,
  language,
}: HighlightedCodeProps) {
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getHighlighter()
      .then((highlighter) => {
        if (cancelled) return;
        const lang = highlighter.getLoadedLanguages().includes(language)
          ? language
          : "text";
        const result = highlighter.codeToHtml(code, {
          lang,
          themes: { light: "catppuccin-latte", dark: "vitesse-dark" },
          defaultColor: false,
        });
        setHtml(result);
      })
      .catch(() => {
        // Shiki failed to load — keep showing the plain-text fallback
      });
    return () => {
      cancelled = true;
    };
  }, [code, language]);

  if (!html) {
    return (
      <pre className="m-0 p-hsp-md bg-code-bg text-caption leading-relaxed overflow-x-auto">
        <code className="font-mono whitespace-pre">
          {code}
        </code>
      </pre>
    );
  }

  return (
    <div
      className="zd-html-preview-code"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
