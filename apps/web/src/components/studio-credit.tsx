/** Who built the site; always after the TSE/IBGE source lines (TASK-studio-credit.md). */
export function StudioCredit() {
  return (
    <p>
      Desenvolvido por{" "}
      <a
        href="https://blessed-moon.vercel.app"
        target="_blank"
        rel="noopener"
        className="rounded-sm font-medium underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        Blessed Moon Studio<span className="sr-only"> (abre em nova aba)</span>
      </a>
    </p>
  );
}
