import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ArrowLeft,
  ArrowRight,
  Download,
  GripVertical,
  Plus,
  Save,
  Share2,
  Trash2,
} from "lucide-react";
import { getRequests, type WorkItemRow } from "@/lib/api";
import {
  download,
  getCatalog,
  getDashboards,
  previewFromRequest,
  queryTile,
  saveDashboard,
  toCsv,
  type Chart,
  type Dashboard,
  type Dataset,
  type Tile,
  type TileData,
} from "@/lib/studio";
import { useResource } from "@/lib/use-resource";
import { useLens } from "./AppShell";
import { ListState, PageHeading, localDate } from "./shared";

// Validated categorical order (light surface, CVD separation >= 12). A sixth series and beyond fold into "Other".
const SERIES = ["#1f5fbd", "#c45a00", "#8a3ffc", "#1d7a33", "#d6338a"];
const OTHER = "#85867d";
const MAX_SERIES = SERIES.length;
const CHARTS: { id: Chart; label: string }[] = [
  { id: "bar", label: "Bar" },
  { id: "line", label: "Line" },
  { id: "table", label: "Table" },
  { id: "number", label: "Number" },
];
const EMPTY: Dashboard = { title: "Untitled dashboard", tiles: [], shared: false };

const tileKey = (t: Tile) =>
  JSON.stringify([t.dataset, t.measure, t.dimension, t.split, t.filters]);
const label = (
  ds: Dataset | undefined,
  kind: "dimensions" | "measures",
  id: string | null | undefined,
) => ds?.[kind].find((f) => f.id === id)?.label ?? id ?? "";
const short = (v: unknown) => {
  const s = String(v ?? "");
  return /^\d{4}-\d{2}-01$/.test(s) ? s.slice(0, 7) : s;
};

// Rows with a split become one column per series: the five largest by total, the rest summed as "Other".
function pivot(data: TileData) {
  if (!data.split || !data.dimension) return { rows: data.rows, series: ["value"] };
  const dim = data.dimension;
  const split = data.split;
  const totals = new Map<string, number>();
  for (const r of data.rows)
    totals.set(String(r[split]), (totals.get(String(r[split])) ?? 0) + Number(r["value"] ?? 0));
  const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
  const kept = ranked.slice(0, MAX_SERIES);
  const series = ranked.length > MAX_SERIES ? [...kept, "Other"] : kept;
  const byKey = new Map<string, Record<string, string | number>>();
  for (const r of data.rows) {
    const key = String(r[dim]);
    const row = byKey.get(key) ?? { [dim]: key };
    const name = kept.includes(String(r[split])) ? String(r[split]) : "Other";
    row[name] = Math.round((Number(row[name] ?? 0) + Number(r["value"] ?? 0)) * 100) / 100;
    byKey.set(key, row);
  }
  return { rows: [...byKey.values()], series };
}

function TileChart({ tile, data }: { tile: Tile; data: TileData }) {
  const { rows, series } = useMemo(() => pivot(data), [data]);
  const dim = data.dimension;
  if (tile.chart === "number" || !dim) {
    const total = data.rows.reduce((sum, r) => sum + Number(r["value"] ?? 0), 0);
    const value =
      data.unit === "%" || !dim ? (dim ? total / Math.max(data.rows.length, 1) : total) : total;
    return (
      <p className="py-6 text-4xl font-semibold tabular-nums">
        {value.toLocaleString(undefined, { maximumFractionDigits: 1 })}{" "}
        <span className="text-base font-normal text-muted-foreground">{data.unit}</span>
      </p>
    );
  }
  if (tile.chart === "table") {
    const keys = Object.keys(rows[0] ?? {});
    return (
      <div className="max-h-72 overflow-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              {keys.map((k) => (
                <th key={k} className="border-b p-2 text-left font-semibold">
                  {k === "value" ? data.measure_label : k}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                {keys.map((k) => (
                  <td
                    key={k}
                    className={`border-b p-2 ${typeof r[k] === "number" ? "text-right tabular-nums" : ""}`}
                  >
                    {short(r[k])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  const color = (s: string, i: number) => (s === "Other" ? OTHER : (SERIES[i] ?? OTHER));
  // recharts reads its axes from direct children, so these go in as an array, not a fragment.
  const common = [
    <CartesianGrid key="grid" stroke="var(--border)" vertical={false} />,
    <XAxis
      key="x"
      dataKey={dim}
      tickFormatter={short}
      tick={{ fontSize: 12 }}
      interval="preserveStartEnd"
    />,
    <YAxis key="y" tick={{ fontSize: 12 }} width={56} />,
    <Tooltip key="tip" labelFormatter={short} />,
    ...(series.length > 1
      ? [
          <Legend
            key="legend"
            formatter={(value: string) => <span className="text-foreground">{value}</span>}
          />,
        ]
      : []),
  ];
  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        {tile.chart === "line" ? (
          <LineChart data={rows}>
            {common}
            {series.map((s, i) => (
              <Line
                key={s}
                dataKey={s}
                name={s === "value" ? data.measure_label : s}
                stroke={color(s, i)}
                strokeWidth={2}
                dot={{ r: 4 }}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        ) : (
          <BarChart data={rows}>
            {common}
            {series.map((s, i) => (
              <Bar
                key={s}
                dataKey={s}
                name={s === "value" ? data.measure_label : s}
                fill={color(s, i)}
                radius={[4, 4, 0, 0]}
                isAnimationActive={false}
              />
            ))}
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}

function TileCard({
  tile,
  index,
  count,
  dataset,
  editable,
  onChange,
  onRemove,
  onMove,
  onData,
}: {
  tile: Tile;
  index: number;
  count: number;
  dataset: Dataset | undefined;
  editable: boolean;
  onChange: (t: Tile) => void;
  onRemove: () => void;
  onMove: (from: number, to: number) => void;
  onData: (d: TileData | null) => void;
}) {
  const key = tileKey(tile);
  const [editing, setEditing] = useState(false);
  const [state, setState] = useState<{ data: TileData | null; error: string | null }>({
    data: null,
    error: null,
  });
  const report = useRef(onData);
  report.current = onData;
  useEffect(() => {
    let live = true;
    setState({ data: null, error: null });
    queryTile(tile)
      .then((data) => {
        if (!live) return;
        setState({ data, error: null });
        report.current(data);
      })
      .catch(
        (e: unknown) =>
          live && setState({ data: null, error: e instanceof Error ? e.message : "Query failed" }),
      );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const drop = (event: DragEvent) => {
    if (!editable) return;
    const moved = event.dataTransfer.getData("application/x-tile");
    const dim = event.dataTransfer.getData("application/x-dimension");
    event.preventDefault();
    if (moved) return onMove(Number(moved), index);
    if (dim) {
      const field = JSON.parse(dim) as { dataset: string; dimension: string };
      if (field.dataset !== tile.dataset) return;
      onChange(
        tile.dimension && tile.dimension !== field.dimension && !tile.split
          ? { ...tile, split: field.dimension, chart: tile.chart === "number" ? "bar" : tile.chart }
          : {
              ...tile,
              dimension: field.dimension,
              split: null,
              chart: tile.chart === "number" ? "bar" : tile.chart,
            },
      );
    }
  };
  return (
    <article
      className="panel min-w-0"
      style={{ gridColumn: `span ${tile.width}` }}
      onDragOver={(e) => editable && e.preventDefault()}
      onDrop={drop}
      aria-label={tile.title}
    >
      <header className="mb-3 flex flex-wrap items-center gap-2">
        {editable && (
          <span
            draggable
            onDragStart={(e) => e.dataTransfer.setData("application/x-tile", String(index))}
            className="cursor-grab text-muted-foreground"
            title="Drag to move"
          >
            <GripVertical aria-hidden className="h-5 w-5" />
          </span>
        )}
        {editable && editing ? (
          <input
            className="control min-w-0 flex-1 font-semibold"
            aria-label="Tile title"
            value={tile.title}
            onChange={(e) => onChange({ ...tile, title: e.target.value })}
          />
        ) : (
          <h3 className="min-w-0 flex-1 font-semibold">{tile.title}</h3>
        )}
        {editable && (
          <button
            className="control"
            aria-expanded={editing}
            aria-label={editing ? "Done editing tile" : "Edit tile"}
            onClick={() => setEditing(!editing)}
          >
            {editing ? "Done" : "Edit"}
          </button>
        )}
      </header>
      {editable && editing && (
        <div className="mb-3 flex flex-wrap gap-2 text-sm">
          <select
            className="control"
            aria-label="Chart type"
            value={tile.chart}
            onChange={(e) => onChange({ ...tile, chart: e.target.value as Chart })}
          >
            {CHARTS.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
          <select
            className="control"
            aria-label="Group by"
            value={tile.dimension ?? ""}
            onChange={(e) => onChange({ ...tile, dimension: e.target.value || null, split: null })}
          >
            <option value="">No grouping</option>
            {dataset?.dimensions.map((d) => (
              <option key={d.id} value={d.id}>
                By {d.label.toLowerCase()}
              </option>
            ))}
          </select>
          {tile.dimension && (
            <select
              className="control"
              aria-label="Split by"
              value={tile.split ?? ""}
              onChange={(e) => onChange({ ...tile, split: e.target.value || null })}
            >
              <option value="">No split</option>
              {dataset?.dimensions
                .filter((d) => d.id !== tile.dimension)
                .map((d) => (
                  <option key={d.id} value={d.id}>
                    Split by {d.label.toLowerCase()}
                  </option>
                ))}
            </select>
          )}
          <select
            className="control"
            aria-label="Width"
            value={tile.width}
            onChange={(e) => onChange({ ...tile, width: Number(e.target.value) as Tile["width"] })}
          >
            <option value={1}>Narrow</option>
            <option value={2}>Wide</option>
            <option value={3}>Full width</option>
          </select>
          <button
            className="control"
            aria-label="Move earlier"
            disabled={index === 0}
            onClick={() => onMove(index, index - 1)}
          >
            <ArrowLeft aria-hidden className="h-4 w-4" />
          </button>
          <button
            className="control"
            aria-label="Move later"
            disabled={index === count - 1}
            onClick={() => onMove(index, index + 1)}
          >
            <ArrowRight aria-hidden className="h-4 w-4" />
          </button>
          <button className="control" aria-label="Remove tile" onClick={onRemove}>
            <Trash2 aria-hidden className="h-4 w-4" />
          </button>
        </div>
      )}
      {state.error ? (
        <p role="alert" className="tone-red rounded p-3 text-sm">
          {state.error}
        </p>
      ) : !state.data ? (
        <p role="status" className="py-8 text-sm text-muted-foreground">
          Loading rows...
        </p>
      ) : (
        <TileChart tile={tile} data={state.data} />
      )}
      {state.data && (
        <p className="mt-2 text-xs text-muted-foreground">
          {state.data.measure_label}
          {tile.dimension
            ? ` by ${label(dataset, "dimensions", tile.dimension).toLowerCase()}`
            : ""}
          {tile.split ? `, split by ${label(dataset, "dimensions", tile.split).toLowerCase()}` : ""}
          . Source: {state.data.source}, {state.data.rows.length} rows
          {state.data.truncated ? " (first rows only)" : ""}.
        </p>
      )}
    </article>
  );
}

export function DashboardBuilder() {
  const [role, , access] = useLens();
  const catalog = useResource(() => getCatalog(), role);
  const boards = useResource(() => getDashboards(), role);
  // A link can open a saved dashboard: /dashboards?board=DASH-1234ABCD
  const linked = useRef<string | null>(null);
  useEffect(() => {
    try {
      linked.current = new URLSearchParams(window.location.search).get("board");
    } catch {
      linked.current = null;
    }
  }, []);
  useEffect(() => {
    const hit = boards.data?.find((b) => b.id === linked.current);
    if (hit) {
      linked.current = null;
      setBoard(hit);
    }
  }, [boards.data]);
  const canEdit = role === "analyst" || role === "admin";
  const requests = useResource(
    () => (canEdit ? getRequests() : Promise.resolve([] as WorkItemRow[])),
    role,
  );
  const [board, setBoard] = useState<Dashboard>(EMPTY);
  const [datasetId, setDatasetId] = useState("sales");
  const [measureId, setMeasureId] = useState("net_sales");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const data = useRef(new Map<string, TileData | null>()); // loaded rows by query, for the CSV export
  const datasets = catalog.data ?? [];
  const dataset = datasets.find((d) => d.id === datasetId);
  const editable =
    canEdit &&
    (!board.owner || board.owner === access.name || role === "admin" || !access.enforced);

  const setTiles = (tiles: Tile[]) => setBoard((b) => ({ ...b, tiles }));
  const addTile = (ds: string, measure: string, dimension?: string) => {
    const d = datasets.find((x) => x.id === ds);
    if (!d) return;
    const dim =
      dimension ??
      (d.dimensions.some((x) => x.id === "month") ? "month" : (d.dimensions[0]?.id ?? null));
    setTiles([
      ...board.tiles,
      {
        dataset: ds,
        measure,
        dimension: dim,
        split: null,
        filters: null,
        chart: dim === "month" ? "line" : "bar",
        width: 1,
        title: `${label(d, "measures", measure)}${dim ? ` by ${label(d, "dimensions", dim).toLowerCase()}` : ""}`,
      },
    ]);
  };
  const move = (from: number, to: number) => {
    if (to < 0 || to >= board.tiles.length || from === to) return;
    const tiles = [...board.tiles];
    const [t] = tiles.splice(from, 1);
    tiles.splice(to, 0, t!);
    setTiles(tiles);
  };
  const dropOnCanvas = (event: DragEvent) => {
    const measure = event.dataTransfer.getData("application/x-measure");
    if (!measure || !editable) return;
    event.preventDefault();
    const field = JSON.parse(measure) as { dataset: string; measure: string };
    addTile(field.dataset, field.measure);
  };
  const save = (shared = board.shared) => {
    setError(null);
    saveDashboard({ ...board, shared })
      .then((saved) => {
        setBoard(saved);
        setStatus(
          `Saved ${saved.id}${saved.shared ? ", shared with readers" : ", private to you"}.`,
        );
        boards.reload();
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Save failed"));
  };
  const fromRequest = (id: string) => {
    if (!id) return;
    setError(null);
    previewFromRequest(id)
      .then((p) => {
        if (!p.tiles.length) {
          setError(
            `The KPIs of ${id} (${p.kpis.join(", ") || "none"}) are not in the data pack's figures.`,
          );
          return;
        }
        setBoard({ title: p.title, tiles: p.tiles, shared: false, request_id: p.request_id });
        setStatus(`Started from ${id}: ${p.tiles.length} tiles for ${p.kpis.join(", ")}.`);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Preview failed"));
  };
  const exportJson = () =>
    download(
      `${(board.id ?? "dashboard").toLowerCase()}.json`,
      JSON.stringify(
        { ...board, format: "reuse-gate-dashboard/1", data_note: "Bayer synthetic data pack" },
        null,
        2,
      ),
    );
  const exportCsv = () => {
    const rows = board.tiles.flatMap((t) => {
      const d = data.current.get(tileKey(t));
      return (d?.rows ?? []).map((r) => ({ tile: t.title, source: d?.source ?? "", ...r }));
    });
    download(`${(board.id ?? "dashboard").toLowerCase()}.csv`, toCsv(rows), "text/csv");
  };

  return (
    <>
      <PageHeading
        title={canEdit ? "Dashboard studio" : "Dashboards"}
        description={
          canEdit
            ? "Drag a measure onto the canvas, then drag a field onto a tile to group or split it. Every number is read live from the data pack; each tile names its source table."
            : "Dashboards analysts have shared with you. Every number is read live from the data pack."
        }
      />
      <ListState
        loading={catalog.loading}
        error={catalog.error}
        empty={false}
        retry={catalog.reload}
      />
      <div className="grid gap-6 xl:grid-cols-[18rem_minmax(0,1fr)]">
        <aside className="space-y-6">
          <section className="panel">
            <h2 className="section-title">Saved</h2>
            {canEdit && (
              <button
                className="control mb-3 w-full"
                onClick={() => (setBoard(EMPTY), setStatus(null))}
              >
                <Plus aria-hidden className="h-4 w-4" /> New dashboard
              </button>
            )}
            <ListState
              loading={boards.loading}
              error={boards.error}
              empty={!boards.data?.length}
              retry={boards.reload}
              emptyText={canEdit ? "Nothing saved yet." : "No dashboards are shared with you yet."}
            />
            <ul className="space-y-2">
              {(boards.data ?? []).map((b) => (
                <li key={b.id}>
                  <button
                    className={`nav-link w-full text-left ${board.id === b.id ? "nav-active" : ""}`}
                    onClick={() => (setBoard(b), setStatus(null))}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{b.title}</span>
                      <span className="block text-xs text-muted-foreground">
                        {b.owner} {b.shared ? "· shared" : "· private"} · {b.tiles.length} tiles
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
          {canEdit && datasets.length > 0 && (
            <section className="panel">
              <h2 className="section-title">Fields</h2>
              <label className="block text-sm font-semibold" htmlFor="dataset-select">
                Data
              </label>
              <select
                id="dataset-select"
                className="control mb-3 w-full"
                value={datasetId}
                onChange={(e) => {
                  const d = datasets.find((x) => x.id === e.target.value);
                  setDatasetId(e.target.value);
                  setMeasureId(d?.measures[0]?.id ?? "");
                }}
              >
                {datasets.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.label}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">Source: {dataset?.source}</p>
              <h3 className="mt-3 text-sm font-semibold">Measures</h3>
              <ul className="mt-1 flex flex-wrap gap-2">
                {dataset?.measures.map((m) => (
                  <li
                    key={m.id}
                    draggable
                    onDragStart={(e) =>
                      e.dataTransfer.setData(
                        "application/x-measure",
                        JSON.stringify({ dataset: datasetId, measure: m.id }),
                      )
                    }
                    className="tone-blue cursor-grab rounded-full border px-3 py-1 text-xs font-semibold"
                  >
                    {m.label}
                  </li>
                ))}
              </ul>
              <h3 className="mt-3 text-sm font-semibold">Group or split by</h3>
              <ul className="mt-1 flex flex-wrap gap-2">
                {dataset?.dimensions.map((d) => (
                  <li
                    key={d.id}
                    draggable
                    onDragStart={(e) =>
                      e.dataTransfer.setData(
                        "application/x-dimension",
                        JSON.stringify({ dataset: datasetId, dimension: d.id }),
                      )
                    }
                    className="cursor-grab rounded-full border px-3 py-1 text-xs"
                  >
                    {d.label}
                  </li>
                ))}
              </ul>
              <div className="mt-4 border-t pt-4">
                <label className="block text-sm font-semibold" htmlFor="measure-select">
                  Or add with the keyboard
                </label>
                <select
                  id="measure-select"
                  className="control mb-2 w-full"
                  value={measureId}
                  onChange={(e) => setMeasureId(e.target.value)}
                >
                  {dataset?.measures.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
                <button className="control w-full" onClick={() => addTile(datasetId, measureId)}>
                  <Plus aria-hidden className="h-4 w-4" /> Add tile
                </button>
              </div>
            </section>
          )}
        </aside>
        <section className="min-w-0">
          <div className="panel mb-4 flex flex-wrap items-center gap-3">
            {editable ? (
              <input
                className="control min-w-0 flex-[1_1_16rem] text-lg font-semibold"
                aria-label="Dashboard title"
                value={board.title}
                onChange={(e) => setBoard({ ...board, title: e.target.value })}
              />
            ) : (
              <h2 className="flex-1 text-xl font-semibold">{board.title}</h2>
            )}
            {canEdit && (requests.data?.length ?? 0) > 0 && (
              <select
                className="control"
                aria-label="Start from a request"
                value=""
                onChange={(e) => fromRequest(e.target.value)}
              >
                <option value="">Start from a request's spec...</option>
                {(requests.data ?? []).map((r) => (
                  <option key={r.request_id} value={r.request_id}>
                    {r.request_id}: {r.text.slice(0, 50)}
                  </option>
                ))}
              </select>
            )}
            {editable && (
              <>
                <button
                  className="primary-action"
                  disabled={!board.tiles.length}
                  onClick={() => save()}
                >
                  <Save aria-hidden className="h-4 w-4" /> Save
                </button>
                <button
                  className="control"
                  disabled={!board.tiles.length}
                  onClick={() => save(!board.shared)}
                >
                  <Share2 aria-hidden className="h-4 w-4" />{" "}
                  {board.shared ? "Make private" : "Share"}
                </button>
              </>
            )}
            <button className="control" disabled={!board.tiles.length} onClick={exportJson}>
              <Download aria-hidden className="h-4 w-4" /> JSON
            </button>
            <button className="control" disabled={!board.tiles.length} onClick={exportCsv}>
              <Download aria-hidden className="h-4 w-4" /> CSV
            </button>
          </div>
          {board.owner && (
            <p className="mb-3 text-sm text-muted-foreground">
              {board.id} by {board.owner}
              {board.updated ? `, saved ${localDate(board.updated)}` : ""}
              {board.request_id ? `, built for ${board.request_id}` : ""}.{" "}
              {board.shared ? "Shared with readers." : "Private."}
            </p>
          )}
          {status && (
            <p role="status" className="tone-green mb-3 rounded p-3 text-sm">
              {status}
            </p>
          )}
          {error && (
            <p role="alert" className="tone-red mb-3 rounded p-3 text-sm">
              {error}
            </p>
          )}
          <div
            className="grid min-h-64 gap-4 rounded border border-dashed p-4 md:grid-cols-3"
            onDragOver={(e) => editable && e.preventDefault()}
            onDrop={dropOnCanvas}
            aria-label="Dashboard canvas"
          >
            {board.tiles.map((t, i) => (
              <TileCard
                key={`${board.id ?? "new"}-${i}-${t.dataset}-${t.measure}`}
                tile={t}
                index={i}
                count={board.tiles.length}
                dataset={datasets.find((d) => d.id === t.dataset)}
                editable={editable}
                onChange={(next) => setTiles(board.tiles.map((x, j) => (j === i ? next : x)))}
                onRemove={() => setTiles(board.tiles.filter((_, j) => j !== i))}
                onMove={move}
                onData={(d) => data.current.set(tileKey(t), d)}
              />
            ))}
            {!board.tiles.length && (
              <p className="col-span-full self-center text-center text-muted-foreground">
                {editable
                  ? "Drop a measure here, add one with the keyboard, or start from a request's spec."
                  : "Choose a dashboard on the left."}
              </p>
            )}
          </div>
        </section>
      </div>
    </>
  );
}
