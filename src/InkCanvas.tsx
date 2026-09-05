import { useEffect, useRef, useState } from "react";
import { getStroke } from "perfect-freehand";
import type { Ink, Stroke, Point, View } from "./types";
export type Tool = "pen" | "eraser" | "lasso";
export function strokePath(stroke: Stroke) {
  const pts = getStroke(stroke.points, {
    size: stroke.width,
    thinning: 0.35,
    smoothing: 0.4,
    streamline: 0.2,
    simulatePressure: false,
    last: true,
  });
  const p = new Path2D();
  pts.forEach(([x, y], i) => (i ? p.lineTo(x, y) : p.moveTo(x, y)));
  p.closePath();
  return p;
}
function inside(point: Point, polygon: Point[]) {
  let result = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i],
      b = polygon[j];
    if (
      a[1] > point[1] !== b[1] > point[1] &&
      point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      result = !result;
  }
  return result;
}
export function InkCanvas({
  label,
  ink,
  onChange,
  tool,
  width,
  lined = false,
  backgrounds = [],
  readOnly = false,
  onActive,
}: {
  label: string;
  ink: Ink;
  onChange: (ink: Ink) => void;
  tool: Tool;
  width: number;
  lined?: boolean;
  backgrounds?: string[];
  readOnly?: boolean;
  onActive?: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null),
    live = useRef(ink),
    frame = useRef(0),
    images = useRef<HTMLImageElement[]>([]),
    current = useRef<Stroke | null>(null),
    selection = useRef<string[]>([]),
    polygon = useRef<Point[]>([]),
    drag = useRef<{ point: Point; strokes: Stroke[] } | null>(null),
    pointers = useRef(new Map<number, { x: number; y: number }>()),
    pinch = useRef<{
      distance: number;
      mid: { x: number; y: number };
      view: View;
    } | null>(null),
    dirty = useRef(false),
    checkpoint = useRef(0);
  const [zoom, setZoom] = useState(ink.view.scale);
  const before = useRef<Stroke[]>([]);
  live.current = ink;
  const paint = () => {
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      const c = canvas.current;
      if (!c) return;
      const rect = c.getBoundingClientRect(),
        dpr = Math.min(devicePixelRatio || 1, 3);
      if (
        c.width !== Math.round(rect.width * dpr) ||
        c.height !== Math.round(rect.height * dpr)
      ) {
        c.width = Math.round(rect.width * dpr);
        c.height = Math.round(rect.height * dpr);
      }
      const ctx = c.getContext("2d")!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, rect.width, rect.height);
      const v = live.current.view;
      ctx.translate(v.x, v.y);
      ctx.scale(v.scale, v.scale);
      const visibleWidth = rect.width / v.scale;
      let y = 16;
      for (const im of images.current) {
        if (!im.complete || !im.naturalWidth) continue;
        const w = 720,
          h = (im.naturalHeight / im.naturalWidth) * w;
        ctx.drawImage(im, 16, y, w, h);
        y += h + 16;
      }
      if (lined) {
        ctx.strokeStyle = "#dce1e8";
        ctx.lineWidth = 0.7;
        const first = Math.max(32, Math.floor(-v.y / v.scale / 32) * 32);
        for (let row = first; row < (rect.height - v.y) / v.scale; row += 32) {
          ctx.beginPath();
          ctx.moveTo(16, row);
          ctx.lineTo(Math.max(744, visibleWidth - v.x / v.scale), row);
          ctx.stroke();
        }
      }
      for (const s of live.current.strokes) {
        if (s.id === current.current?.id) continue;
        ctx.fillStyle = s.color;
        ctx.fill(strokePath(s));
        if (selection.current.includes(s.id)) {
          ctx.strokeStyle = "#0066cc";
          ctx.lineWidth = 1 / v.scale;
          ctx.stroke(strokePath(s));
        }
      }
      if (current.current) {
        ctx.fillStyle = current.current.color;
        ctx.fill(strokePath(current.current));
      }
      if (polygon.current.length) {
        ctx.strokeStyle = "#0066cc";
        ctx.lineWidth = 1 / v.scale;
        ctx.setLineDash([4 / v.scale, 3 / v.scale]);
        ctx.beginPath();
        polygon.current.forEach(([x, y], i) =>
          i ? ctx.lineTo(x, y) : ctx.moveTo(x, y),
        );
        ctx.stroke();
        ctx.setLineDash([]);
      }
    });
  };
  const publish = (next: Ink) => {
    live.current = next;
    onChange(next);
    setZoom(next.view.scale);
    paint();
  };
  useEffect(() => {
    const initial = live.current;
    if (
      backgrounds.length > 0 &&
      initial.strokes.length === 0 &&
      initial.events.length === 0 &&
      initial.view.x === 0 &&
      initial.view.y === 0 &&
      initial.view.scale === 1
    ) {
      const scale = Math.min(1, (canvas.current?.clientWidth || 752) / 752);
      publish({ ...initial, view: { x: 0, y: 0, scale } });
    }
  }, []);
  useEffect(() => {
    paint();
  }, [ink, tool, width, lined]);
  useEffect(() => {
    images.current = backgrounds.map((src) => {
      const im = new Image();
      im.onload = paint;
      im.src = src;
      return im;
    });
    paint();
  }, [backgrounds.join("|")]);
  useEffect(() => {
    const c = canvas.current!,
      observer = new ResizeObserver(paint);
    observer.observe(c);
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      onActive?.();
      const v = live.current.view;
      if (e.ctrlKey) {
        const r = c.getBoundingClientRect(),
          x = e.clientX - r.left,
          y = e.clientY - r.top,
          s = Math.min(8, Math.max(0.25, v.scale * Math.exp(-e.deltaY * 0.01)));
        publish({
          ...live.current,
          view: {
            scale: s,
            x: x - ((x - v.x) * s) / v.scale,
            y: y - ((y - v.y) * s) / v.scale,
          },
        });
      } else
        publish({
          ...live.current,
          view: { ...v, x: v.x - e.deltaX, y: v.y - e.deltaY },
        });
    };
    c.addEventListener("wheel", wheel, { passive: false });
    return () => {
      observer.disconnect();
      c.removeEventListener("wheel", wheel);
      cancelAnimationFrame(frame.current);
    };
  }, []);
  const local = (e: {
    clientX: number;
    clientY: number;
    pressure?: number;
  }): Point => {
    const r = canvas.current!.getBoundingClientRect(),
      v = live.current.view;
    return [
      (e.clientX - r.left - v.x) / v.scale,
      (e.clientY - r.top - v.y) / v.scale,
      e.pressure && e.pressure > 0 ? e.pressure : 0.5,
    ];
  };
  function endStroke() {
    if (current.current) {
      const s = current.current,
        others = live.current.strokes.filter((x) => x.id !== s.id);
      current.current = null;
      publish({
        ...live.current,
        strokes: [...others, s],
        undo: [...live.current.undo, before.current].slice(-40),
        redo: [],
        height: Math.max(
          live.current.height,
          ...s.points.map((p) => p[1] + 200),
        ),
        events: [
          ...live.current.events,
          { at: Date.now(), action: "draw", strokeIds: [s.id] },
        ],
      });
    }
    if (dirty.current) {
      dirty.current = false;
      publish({
        ...live.current,
        undo: [...live.current.undo, before.current].slice(-40),
        redo: [],
        events: [
          ...live.current.events,
          {
            at: Date.now(),
            action: tool === "eraser" ? "erase" : "move",
            strokeIds: [...selection.current],
          },
        ],
      });
    }
    drag.current = null;
  }
  function touchStart() {
    const a = [...pointers.current.values()];
    if (a.length === 2) {
      endStroke();
      pinch.current = {
        distance: Math.hypot(a[1].x - a[0].x, a[1].y - a[0].y),
        mid: { x: (a[0].x + a[1].x) / 2, y: (a[0].y + a[1].y) / 2 },
        view: { ...live.current.view },
      };
    }
  }
  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    onActive?.();
    e.currentTarget.setPointerCapture(e.pointerId);
    const r = e.currentTarget.getBoundingClientRect();
    if (e.pointerType === "touch") {
      if (current.current) return;
      pointers.current.set(e.pointerId, {
        x: e.clientX - r.left,
        y: e.clientY - r.top,
      });
      touchStart();
      return;
    }
    if (readOnly) return;
    before.current = structuredClone(live.current.strokes);
    pointers.current.clear();
    pinch.current = null;
    const p = local(e);
    checkpoint.current = performance.now();
    if (tool === "pen") {
      selection.current = [];
      current.current = {
        id: crypto.randomUUID(),
        points: [p],
        width,
        color: "#202124",
        at: Date.now(),
      };
    } else if (tool === "lasso") {
      const hits = live.current.strokes.filter((s) =>
        selection.current.includes(s.id),
      );
      if (
        hits.some((s) =>
          s.points.some(
            (v) =>
              Math.hypot(v[0] - p[0], v[1] - p[1]) <
              24 / live.current.view.scale,
          ),
        )
      )
        drag.current = {
          point: p,
          strokes: structuredClone(live.current.strokes),
        };
      else {
        selection.current = [];
        polygon.current = [p];
      }
    } else erase(p);
    paint();
  };
  function erase(p: Point) {
    const old = live.current.strokes;
    const strokes = old.filter(
      (s) =>
        !s.points.some(
          (v) =>
            Math.hypot(v[0] - p[0], v[1] - p[1]) <
            10 / live.current.view.scale + s.width,
        ),
    );
    if (strokes.length !== old.length) {
      live.current = { ...live.current, strokes };
      dirty.current = true;
      publish(live.current);
    }
  }
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType === "touch") {
      if (!pointers.current.has(e.pointerId)) return;
      const r = e.currentTarget.getBoundingClientRect();
      pointers.current.set(e.pointerId, {
        x: e.clientX - r.left,
        y: e.clientY - r.top,
      });
      if (pinch.current && pointers.current.size === 2) {
        const [a, b] = [...pointers.current.values()],
          o = pinch.current,
          s = Math.max(
            0.25,
            Math.min(
              8,
              (o.view.scale * Math.hypot(a.x - b.x, a.y - b.y)) /
                Math.max(1, o.distance),
            ),
          ),
          mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        publish({
          ...live.current,
          view: {
            scale: s,
            x: mid.x - ((o.mid.x - o.view.x) * s) / o.view.scale,
            y: mid.y - ((o.mid.y - o.view.y) * s) / o.view.scale,
          },
        });
      }
      return;
    }
    if (readOnly || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
    const p = local(e);
    if (current.current) {
      const co = e.nativeEvent.getCoalescedEvents?.() || [];
      current.current.points.push(
        ...(co.length ? co : [e.nativeEvent]).map(local),
      );
      if (performance.now() - checkpoint.current > 450) {
        checkpoint.current = performance.now();
        const s = structuredClone(current.current);
        publish({
          ...live.current,
          strokes: [...live.current.strokes.filter((x) => x.id !== s.id), s],
          redo: [],
        });
      }
    } else if (tool === "eraser") erase(p);
    else if (drag.current) {
      const d = drag.current;
      live.current = {
        ...live.current,
        strokes: d.strokes.map((s) =>
          selection.current.includes(s.id)
            ? {
                ...s,
                points: s.points.map(
                  (v) =>
                    [
                      v[0] + p[0] - d.point[0],
                      v[1] + p[1] - d.point[1],
                      v[2],
                    ] as Point,
                ),
              }
            : s,
        ),
      };
      dirty.current = true;
    } else if (polygon.current.length) polygon.current.push(p);
    paint();
  };
  const up = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType === "touch") {
      pointers.current.delete(e.pointerId);
      pinch.current = null;
      return;
    }
    if (polygon.current.length) {
      selection.current = live.current.strokes
        .filter((s) => s.points.some((p) => inside(p, polygon.current)))
        .map((s) => s.id);
      polygon.current = [];
    }
    endStroke();
    paint();
  };
  const resetView = () => {
    const w = canvas.current?.clientWidth || 752;
    publish({
      ...live.current,
      view: { x: 0, y: 0, scale: Math.min(1, w / 752) },
    });
  };
  return (
    <section
      className={"ink-area " + (backgrounds.length ? "question-canvas" : "")}
    >
      <div className="area-heading">
        <h3>{label}</h3>
        <div className="zoom-controls">
          <button
            aria-label={`${label}縮小`}
            onClick={() =>
              publish({
                ...live.current,
                view: {
                  ...live.current.view,
                  scale: Math.max(0.25, zoom / 1.25),
                },
              })
            }
          >
            −
          </button>
          <button onClick={resetView} aria-label={`${label}適合頁寬`}>
            {Math.round(zoom * 100)}%
          </button>
          <button
            aria-label={`${label}放大`}
            onClick={() =>
              publish({
                ...live.current,
                view: { ...live.current.view, scale: Math.min(8, zoom * 1.25) },
              })
            }
          >
            ＋
          </button>
        </div>
      </div>
      <canvas
        ref={canvas}
        tabIndex={0}
        aria-label={label}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onLostPointerCapture={up}
        onKeyDown={(e) => {
          if (["ArrowDown", "ArrowUp"].includes(e.key)) {
            e.preventDefault();
            publish({
              ...live.current,
              view: {
                ...live.current.view,
                y: live.current.view.y + (e.key === "ArrowDown" ? -100 : 100),
              },
            });
          }
        }}
      />
    </section>
  );
}
