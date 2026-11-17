// A Recharts stand-in for the session page tests. jsdom gives
// ResponsiveContainer no size, so the real charts draw nothing; this one
// renders each part as a marker carrying the props the tests assert on.
// Use: vi.mock('recharts', () => import('<path>/test/rechartsStub.jsx'))
export const ResponsiveContainer = ({ children }) => <div>{children}</div>;
// Chart-level mouse handlers get Recharts' (state, event) pair; here the
// state's active index is the event's clientX, so a test picks the row under
// the pointer: fireEvent.mouseDown(chart, { clientX: 10 }).
const pointer = (data, handler) =>
  handler
    ? (e) =>
        handler(
          {
            activeTooltipIndex: String(e.clientX),
            activeIndex: String(e.clientX),
            activeLabel: data[e.clientX]?.x,
            isTooltipActive: true,
          },
          e
        )
    : undefined;
export const ComposedChart = ({
  children,
  data,
  syncId,
  onMouseDown,
  onMouseMove,
  onMouseUp,
}) => (
  <div
    data-testid="chart"
    data-sync={syncId}
    data-points={data.length}
    onMouseDown={pointer(data, onMouseDown)}
    onMouseMove={pointer(data, onMouseMove)}
    onMouseUp={pointer(data, onMouseUp)}
  >
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
// A zone band spans y; a selection spans x.
export const ReferenceArea = ({ x1, x2, y1, y2, fill }) =>
  x1 != null ? (
    <span data-testid="selection" data-x1={x1} data-x2={x2} />
  ) : (
    <span data-testid="band" data-y1={y1} data-y2={y2} data-fill={fill} />
  );
export const ReferenceLine = ({ y, strokeDasharray }) => (
  <span data-testid="avg-line" data-y={y} data-dash={strokeDasharray} />
);
