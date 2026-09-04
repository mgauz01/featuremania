import katex from "katex";

type MathBlockProps = {
  latex: string;
  label: string;
};

export default function MathBlock({ latex, label }: MathBlockProps) {
  const html = katex.renderToString(latex, {
    displayMode: true,
    throwOnError: false,
    output: "html",
  });
  return (
    <div
      className="score-formula-math"
      role="math"
      aria-label={label}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
