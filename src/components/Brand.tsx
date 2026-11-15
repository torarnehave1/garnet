// The Garnet mark: a net of knots, one of them lit.
const L: [number, number, number, number][] = [
  [32, 11, 39, 18], [32, 11, 25, 18], [25, 18, 32, 25], [25, 18, 18, 25], [18, 25, 25, 32], [18, 25, 11, 32], [11, 32, 18, 39],
  [39, 18, 46, 25], [39, 18, 32, 25], [32, 25, 39, 32], [32, 25, 25, 32], [25, 32, 32, 39], [25, 32, 18, 39], [18, 39, 25, 46],
  [46, 25, 53, 32], [46, 25, 39, 32], [39, 32, 46, 39], [39, 32, 32, 39], [32, 39, 39, 46], [32, 39, 25, 46], [25, 46, 32, 53],
  [53, 32, 46, 39], [46, 39, 39, 46], [39, 46, 32, 53],
]
const C: [number, number, number, string][] = [
  [32, 11, 2.1, '#6fd3c7'], [25, 18, 1.6, '#e8eef7'], [18, 25, 2.1, '#c9a2f2'], [11, 32, 1.6, '#e8eef7'], [39, 18, 1.6, '#e8eef7'],
  [32, 25, 1.6, '#e8eef7'], [25, 32, 1.6, '#e8eef7'], [18, 39, 2.1, '#9db7ff'], [46, 25, 1.6, '#e8eef7'], [39, 32, 1.6, '#e8eef7'],
  [32, 39, 3.4, '#f2b45a'], [25, 46, 1.6, '#e8eef7'], [53, 32, 1.6, '#e8eef7'], [46, 39, 2.1, '#ef8fa3'], [39, 46, 1.6, '#e8eef7'],
  [32, 53, 2.1, '#6fd3c7'],
]

export function Brand() {
  return (
    <div className="brand">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="44" height="44" aria-hidden="true">
        <g stroke="#cfe0ff" strokeOpacity=".55" strokeWidth="1.3" strokeLinecap="round">
          {L.map(([x1, y1, x2, y2], i) => (
            <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} />
          ))}
        </g>
        <circle cx="32" cy="39" r="6.2" fill="#f2b45a" fillOpacity=".22" />
        {C.map(([cx, cy, r, f], i) => (
          <circle key={i} cx={cx} cy={cy} r={r} fill={f} />
        ))}
      </svg>
      <div>
        <h1>Garnet</h1>
        <div className="sub">De som bøter garnet</div>
      </div>
    </div>
  )
}
