import { footprint } from "../../domain/layout";
import type { LayoutObject } from "../../domain/schemas";
import "./floor-scene-art.css";

/** Shared by the scene and each palette thumbnail. IDs are scoped to their SVG. */
export function SceneMaterials({ id }: { id: string }) {
  return <defs>
    <linearGradient id={`${id}-timber`} x2=".3" y2="1"><stop stopColor="var(--art-wood-light)" /><stop offset=".5" stopColor="var(--art-wood)" /><stop offset="1" stopColor="var(--art-wood-dark)" /></linearGradient>
    <linearGradient id={`${id}-fabric`} x2="0" y2="1"><stop stopColor="var(--art-fabric-light)" /><stop offset=".65" stopColor="var(--art-fabric)" /><stop offset="1" stopColor="var(--art-fabric-dark)" /></linearGradient>
    <linearGradient id={`${id}-stone`} x2="1" y2="1"><stop stopColor="var(--art-stone-light)" /><stop offset="1" stopColor="var(--art-stone)" /></linearGradient>
    <linearGradient id={`${id}-daylight`} x1="0" y1="0" x2="1" y2="1"><stop stopColor="var(--art-daylight)" stopOpacity=".38" /><stop offset=".65" stopColor="var(--art-daylight)" stopOpacity="0" /></linearGradient>
    <pattern id={`${id}-grain`} width=".8" height=".23" patternUnits="userSpaceOnUse"><path d="M0 .05Q.2 .01 .4 .05T.8 .05M0 .15Q.3 .2 .55 .15T.8 .15M.15 .1H.65" className="floor-art-grain" /></pattern>
    <pattern id={`${id}-boards`} width="5.4" height=".9" patternUnits="userSpaceOnUse">
      <rect width="5.4" height=".9" fill="var(--art-floor)" />
      <path d="M0 0H1.8V.3H0ZM3.6 .3H5.4V.6H3.6ZM.9 .6H5.4V.9H.9Z" fill="var(--art-floor-light)" opacity=".38" />
      <path d="M1.8 0H5.4V.3H1.8ZM0 .3H3.6V.6H0Z" fill="var(--art-floor-dark)" opacity=".12" />
      <path d="M0 .3H5.4M0 .6H5.4M0 .9H5.4M1.8 0V.3M3.6 .3V.6M.9 .6V.9M0 0V.9" className="floor-art-board-joint" />
      <path d="M.1 .11Q.9 .16 1.7 .11M1.9 .22Q3.5 .16 5.3 .22M.1 .52Q1.8 .46 3.5 .52M3.7 .41Q4.5 .46 5.3 .41M1 .78Q2.8 .72 5.3 .78M.1 .72H.8" className="floor-art-floor-grain" />
    </pattern>
    <filter id={`${id}-room-shadow`} x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx=".06" dy=".16" stdDeviation=".1" floodColor="var(--art-shadow)" floodOpacity=".18" /></filter>
  </defs>;
}

export function RoomArt({ width, depth, materialId }: { width: number; depth: number; materialId: string }) {
  return <g className="floor-room-art" pointerEvents="none" aria-hidden="true">
    <rect x="-.2" y="-.18" width={width + .4} height={depth + .48} rx=".07" className="floor-art-wall-side" filter={`url(#${materialId}-room-shadow)`} />
    <rect x="-.2" y="-.2" width={width + .4} height={depth + .4} rx=".07" className="floor-art-wall-cap" />
    <rect width={width} height={depth} fill={`url(#${materialId}-boards)`} />
    <rect width={width} height={depth} fill={`url(#${materialId}-daylight)`} />
    <path d={`M0 ${depth}V0H${width}`} className="floor-art-wall-shade" />
    <path d={`M.025 ${depth - .025}H${width - .025}V.025`} className="floor-art-skirting" />
    <rect x="-.12" y="-.12" width={width + .24} height={depth + .24} rx=".025" className="floor-art-wall-edge" />
  </g>;
}

function Chair({ width: w, depth: d, materialId }: { width: number; depth: number; materialId: string }) {
  return <>
    <rect x={w * .08} y={d * .06} width={w * .84} height={d * .88} rx={w * .15} className="floor-art-chair-frame" />
    <rect x={w * .14} y={d * .21} width={w * .72} height={d * .62} rx={w * .15} fill={`url(#${materialId}-fabric)`} />
    <rect x={w * .06} y={d * .04} width={w * .88} height={d * .2} rx={d * .08} className="floor-art-chair-back" />
    <path d={`M${w * .2} ${d * .35}Q${w * .5} ${d * .27} ${w * .8} ${d * .35}M${w * .2} ${d * .72}H${w * .8}`} className="floor-art-stitch" />
    <circle cx={w * .5} cy={d * .53} r={Math.min(w, d) * .025} className="floor-art-tuft" />
  </>;
}

function PlaceSetting({ x, y, radius: r, rotation = 0 }: { x: number; y: number; radius: number; rotation?: number }) {
  return <g className="floor-place-setting" transform={`translate(${x} ${y}) rotate(${rotation})`}>
    <rect x={-r * 1.7} y={-r * 1.25} width={r * 3.4} height={r * 2.5} rx={r * .16} className="floor-art-linen" />
    <circle cy={r * .08} r={r * 1.06} className="floor-art-plate-shadow" />
    <circle r={r} className="floor-art-plate" /><circle r={r * .72} className="floor-art-plate-rim" />
    <path d={`M${-r * 1.3} ${-r * .65}v${r * 1.35}m${-r * .12} ${-r * 1.4}v${r * .45}h${r * .24}v${-r * .45}M${r * 1.3} ${-r * .7}v${r * 1.4}`} className="floor-art-cutlery" />
    <circle cx={r * 1.25} cy={-r * 1.03} r={r * .25} className="floor-art-glass" />
  </g>;
}

function Plant({ width: w, depth: d }: { width: number; depth: number }) {
  return <>
    <ellipse cx={w * .51} cy={d * .55} rx={w * .35} ry={d * .36} className="floor-art-pot-shadow" />
    <ellipse cx={w * .5} cy={d * .5} rx={w * .34} ry={d * .34} className="floor-art-planter" />
    <ellipse cx={w * .5} cy={d * .5} rx={w * .26} ry={d * .26} className="floor-art-soil" />
    {[0, 55, 115, 175, 235, 295].map((angle, index) => <g key={angle} transform={`rotate(${angle} ${w / 2} ${d / 2})`}>
      <path d={`M${w * .5} ${d * .54}C${w * .08} ${d * .38} ${w * .28} ${d * .04} ${w * .42} ${d * .03}C${w * .66} ${d * .17} ${w * .71} ${d * .36} ${w * .5} ${d * .54}`} className={index % 2 ? "floor-art-leaf-light" : "floor-art-leaf"} />
      <path d={`M${w * .5} ${d * .54}Q${w * .38} ${d * .28} ${w * .42} ${d * .09}`} className="floor-art-leaf-vein" />
    </g>)}
    <ellipse cx={w * .5} cy={d * .45} rx={w * .08} ry={d * .13} className="floor-art-leaf-light" />
  </>;
}

/** All art stays in the original room-unit footprint; decoration adds no data objects. */
export function FurnitureArt({ object, assigned = 0, materialId }: { object: LayoutObject; assigned?: number; materialId: string }) {
  const { type, rotation, width: w, depth: d } = object;
  const size = footprint(object);
  const count = Math.max(0, (object.seats ?? 0) - assigned);
  const chairDepth = Math.min(.27, d * .24);
  const tableY = chairDepth + Math.min(.035, d * .04);
  const tableHeight = d - 2 * tableY;
  const vaseSize = Math.min(.13, w * .15, tableHeight * .25);
  const paint = (material: string) => `url(#${materialId}-${material})`;
  const seats = (rows: number) => Array.from({ length: count }, (_, index) => {
    const row = index % rows;
    const slots = Math.ceil((count - row) / rows);
    return { index, row, slots, x: (Math.floor(index / rows) + 1) * w / (slots + 1), width: Math.min(.38, w / (slots + 1) * .72) };
  });
  const chairs = (rows: number, top: number, bottom = top) => seats(rows).map(seat => <g key={seat.index} data-chair-marker="" transform={`translate(${seat.x} ${(seat.row ? bottom : top) + chairDepth / 2}) rotate(${seat.row ? 180 : 0}) translate(${-seat.width / 2} ${-chairDepth / 2})`}><Chair width={seat.width} depth={chairDepth} materialId={materialId} /></g>);
  const tabletop = (x: number, y: number, width: number, height: number, stone = false) => <>
    <rect x={x} y={y + Math.min(.045, height * .08)} width={width} height={height} rx={Math.min(.1, height / 4)} className="floor-art-table-edge" />
    <rect x={x} y={y} width={width} height={height} rx={Math.min(.1, height / 4)} fill={paint(stone ? "stone" : "timber")} className="floor-art-table" />
    {!stone && <rect x={x + width * .02} y={y + height * .05} width={width * .96} height={height * .9} rx={Math.min(.08, height / 5)} fill={paint("grain")} />}
    <rect x={x + width * .025} y={y + height * .07} width={width * .95} height={height * .86} rx={Math.min(.07, height / 5)} className="floor-art-table-inlay" />
  </>;

  return <g className="floor-furniture-art" aria-hidden="true" pointerEvents="none" transform={`translate(${size.width / 2} ${size.depth / 2}) rotate(${rotation}) translate(${-w / 2} ${-d / 2})`}>
    {(type === "table_2" || type === "table_4") && <>
      {chairs(2, 0, d - chairDepth)}
      {tabletop(w * .08, tableY, w * .84, tableHeight)}
      {seats(2).map(seat => <PlaceSetting key={seat.index} x={seat.x} y={tableY + tableHeight * (seat.row ? .76 : .24)} radius={Math.min(.105, tableHeight * .17, w / (seat.slots + 1) * .19)} rotation={seat.row ? 180 : 0} />)}
      <g transform={`translate(${(w - vaseSize) / 2} ${(d - vaseSize) / 2})`}><Plant width={vaseSize} depth={vaseSize} /></g>
    </>}
    {type === "booth" && <>
      <rect x={w * .025} y={d * .025} width={w * .95} height={d * .95} rx={Math.min(.12, d * .1)} className="floor-art-chair-frame" />
      {[.06, .71].map(y => <rect key={y} x={w * .05} y={d * y} width={w * .9} height={d * .23} rx={Math.min(.07, d * .05)} fill={paint("fabric")} />)}
      {seats(2).map(seat => <g key={seat.index} data-chair-marker="">
        <rect x={w * .08 + Math.floor(seat.index / 2) * w * .84 / seat.slots} y={d * (seat.row ? .72 : .08)} width={w * .84 / seat.slots - w * .015} height={d * .18} rx={Math.min(.045, d * .03)} fill={paint("fabric")} className="floor-art-cushion" />
        <path d={`M${seat.x - Math.min(.17, w / seat.slots * .15)} ${d * (seat.row ? .84 : .16)}h${Math.min(.34, w / seat.slots * .3)}`} className="floor-art-stitch" />
      </g>)}
      {tabletop(w * .09, d * .33, w * .82, d * .34)}
      {seats(2).map(seat => <PlaceSetting key={seat.index} x={seat.x} y={d * (seat.row ? .59 : .41)} radius={Math.min(.09, d * .065, w / (seat.slots + 1) * .15)} rotation={seat.row ? 180 : 0} />)}
      <rect x={w * .47} y={d * .44} width={w * .06} height={d * .12} rx=".01" className="floor-art-menu" />
    </>}
    {type === "counter" && <>
      {chairs(1, d - chairDepth)}
      {tabletop(w * .025, d * .03, w * .95, d * .62, true)}
      <path d={`M${w * .09} ${d * .52}Q${w * .32} ${d * .2} ${w * .55} ${d * .33}T${w * .94} ${d * .15}`} className="floor-art-stone-vein" />
      {seats(1).map(seat => <PlaceSetting key={seat.index} x={seat.x} y={d * .45} radius={Math.min(.09, d * .1, w / (seat.slots + 1) * .16)} />)}
      <path d={`M${w * .06} ${d * .65}H${w * .94}`} className="floor-art-brass-line" />
    </>}
    {type === "cashier_stand" && <>
      <rect x={w * .025} y={d * .04} width={w * .95} height={d * .92} rx={Math.min(.08, d * .1)} className="floor-art-chair-frame" />
      {tabletop(w * .05, d * .04, w * .9, d * .8, true)}
      <rect x={w * .28} y={d * .25} width={w * .42} height={d * .49} rx={d * .04} className="floor-art-register" />
      <rect x={w * .31} y={d * .17} width={w * .36} height={d * .33} rx={d * .035} className="floor-art-screen-frame" />
      <rect x={w * .335} y={d * .2} width={w * .31} height={d * .24} rx={d * .02} className="floor-art-screen" />
      <path d={`M${w * .37} ${d * .26}h${w * .2}M${w * .37} ${d * .33}h${w * .11}`} className="floor-art-screen-line" />
      {[0, 1, 2].map(row => <path key={row} d={`M${w * .34} ${d * (.55 + row * .05)}h${w * .3}`} className="floor-art-register-keys" />)}
      <rect x={w * .76} y={d * .25} width={w * .12} height={d * .24} rx={d * .02} className="floor-art-menu" />
      <path d={`M${w * .33} ${d * .87}h${w * .34}`} className="floor-art-brass-line" />
    </>}
    {type === "door" && <>
      <path d={`M${w * .06} ${d * .87}Q${w * .06} ${d * .08} ${w * .91} ${d * .08}`} className="svg-door-swing" />
      <rect x={w * .04} y={d * .83} width={w * .92} height={d * .13} fill={paint("timber")} className="floor-art-table" />
      <path d={`M${w * .06} ${d * .9}V${d * .08}`} className="svg-door-line" />
      <circle cx={w * .83} cy={d * .87} r={Math.min(.025, d * .05)} className="floor-art-brass" />
    </>}
    {(type === "wall" || type === "divider") && <>
      <rect width={w} height={d} rx={Math.min(.045, d / 4)} className={type === "wall" ? "floor-art-wall-side" : "floor-art-chair-frame"} />
      <rect x={w * .02} y={d * .08} width={w * .96} height={d * .72} rx={Math.min(.035, d / 5)} fill={type === "wall" ? "var(--art-wall)" : paint("timber")} />
      {type === "divider" && Array.from({ length: Math.min(30, Math.max(2, Math.round(w / .14))) }, (_, i) => <path key={i} d={`M${(i + .5) * w / Math.min(30, Math.max(2, Math.round(w / .14)))} ${d * .14}v${d * .54}`} className="floor-art-divider-slat" />)}
    </>}
    {type === "chair" && <g transform={`translate(${w * .08} ${d * .08})`}><Chair width={w * .84} depth={d * .84} materialId={materialId} /></g>}
    {type === "window" && <>
      <rect width={w} height={d} rx={Math.min(.025, d * .1)} className="floor-art-wall-side" />
      <rect x={w * .025} y={d * .15} width={w * .95} height={d * .7} className="svg-window" />
      <path d={`M${w / 3} ${d * .12}V${d * .87}M${w * 2 / 3} ${d * .12}V${d * .87}`} className="floor-art-window-frame" />
      <path d={`M${w * .08} ${d * .75}l${w * .09} ${-d * .5}M${w * .72} ${d * .75}l${w * .09} ${-d * .5}`} className="floor-art-glass-highlight" />
    </>}
    {(type === "light" || type === "decoration") && <>
      <ellipse cx={w / 2} cy={d / 2} rx={w * .44} ry={d * .44} className="floor-art-brass" />
      <ellipse cx={w / 2} cy={d / 2} rx={w * .36} ry={d * .36} fill={paint("stone")} />
      <ellipse cx={w / 2} cy={d / 2} rx={w * .24} ry={d * .24} className={type === "light" ? "svg-lamp" : "floor-art-planter"} />
      <ellipse cx={w * .45} cy={d * .44} rx={w * .08} ry={d * .08} className="floor-art-plate" />
    </>}
    {(type === "ac" || type === "custom") && <>
      <rect x={w * .025} y={d * .025} width={w * .95} height={d * .95} rx={Math.min(.07, d * .12)} fill={paint("stone")} className="floor-art-table" />
      {type === "ac" ? <>
        {[.35, .47, .59, .71].map(y => <path key={y} d={`M${w * .1} ${d * y}H${w * .83}`} className="floor-art-register-keys" />)}
        <circle cx={w * .91} cy={d * .25} r={Math.min(.025, d * .045)} className="floor-art-leaf" />
      </> : <rect x={w * .1} y={d * .1} width={w * .8} height={d * .8} rx={Math.min(.04, d * .1)} className="floor-art-table-inlay" />}
    </>}
    {type === "plant" && <Plant width={w} depth={d} />}
  </g>;
}
