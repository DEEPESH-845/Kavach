/* Route transition placeholder. Deliberately quiet: a shimmer block that matches the shape
   of a page header and a table, so the layout does not jump when the real content lands. */
export default function ConsoleLoading() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <div className="skeleton" style={{ height: 26, width: 220, marginBottom: 10 }} />
      <div className="skeleton" style={{ height: 15, width: 'min(560px, 80%)', marginBottom: 26 }} />
      <div className="grid grid--stats" style={{ marginBottom: 22 }}>
        {[0, 1, 2, 3].map((i) => <div key={i} className="skeleton skeleton--stat" />)}
      </div>
      <div className="skeleton" style={{ height: 240 }} />
    </div>
  );
}
