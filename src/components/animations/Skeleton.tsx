/** Loading placeholders that mirror the real layout, so nothing jumps when data arrives. */
export function Skeleton({ w = '100%', h = 16, r }: { w?: number | string; h?: number | string; r?: number }) {
  return <div className="skeleton" style={{ width: w, height: h, borderRadius: r }} aria-hidden />;
}

export function BoardSkeleton({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="board" style={{ ['--rows' as string]: rows, ['--cols' as string]: cols }} role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, r) => (
        <div className="board__row" key={r}>
          {Array.from({ length: cols }, (_, c) => (
            <div key={c} className="skeleton" style={{ width: 'var(--tile)', height: 'var(--tile)', borderRadius: 8, animationDelay: `${(r + c) * 60}ms` }} />
          ))}
        </div>
      ))}
    </div>
  );
}
