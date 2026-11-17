// A Recharts stand-in for the session page tests. jsdom gives
// ResponsiveContainer no size, so the real charts draw nothing; this one
// renders each part as a marker carrying the props the tests assert on.
// Use: vi.mock('recharts', () => import('<path>/test/rechartsStub.jsx'))
export const ResponsiveContainer = ({ children }) => <div>{children}</div>;
export const ComposedChart = ({ children, data, syncId }) => (
  <div data-testid="chart" data-sync={syncId} data-points={data.length}>
    {children}
  </div>
);
export const LineChart = ({ children }) => <div>{children}</div>;
export const BarChart = ({ children }) => <div>{children}</div>;
export const Bar = () => null;
export const Line = ({ dataKey, dot, isAnimationActive }) => (
  <span
    data-testid="line"
    data-key={dataKey}
    data-dot={String(dot)}
    data-anim={String(isAnimationActive)}
  />
);
export const XAxis = ({ tickFormatter }) => (
  <span data-testid="x-tick">{tickFormatter ? tickFormatter(90) : null}</span>
);
export const YAxis = ({ reversed, label, domain }) => (
  <span
    data-testid="y-axis"
    data-reversed={String(!!reversed)}
    data-unit={label?.value}
    data-domain={Array.isArray(domain) ? domain.join(',') : ''}
  />
);
export const Tooltip = ({ content }) => (
  <span
    data-testid="tooltip"
    data-custom={String(!!content)}
    data-chart={content?.props?.chart ?? ''}
  />
);
export const ReferenceArea = ({ y1, y2, fill }) => (
  <span data-testid="band" data-y1={y1} data-y2={y2} data-fill={fill} />
);
export const ReferenceLine = ({ y, strokeDasharray }) => (
  <span data-testid="avg-line" data-y={y} data-dash={strokeDasharray} />
);
