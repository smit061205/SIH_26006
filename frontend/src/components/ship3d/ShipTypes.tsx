import { useState } from "react";
import { metres, num, tonnes } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { usePorts } from "../../lib/queries";
import type { FeasibilityRow, VesselClassInfo, WeatherResponse } from "../../types";
import { Figure, FigureRow } from "../ui/figures";
import { Button } from "../ui/inputs";
import { Table, Td, Th, Tr } from "../ui/table";
import { toSpec } from "./hull";
import { ShipCloseUp } from "./ShipCloseUp";
import { FleetView } from "./ShipView";

/**
 * The five ship types to scale, one picked out with its particulars, then that
 * ship up close at the plan's discharge port: its forecast sea, and a cargo
 * slider against the port's usable depth.
 */
export function ShipTypes({
  classes,
  recommended,
  port,
  feasibility = [],
  weather,
}: {
  classes: VesselClassInfo[];
  recommended?: string;
  port?: string;
  feasibility?: FeasibilityRow[];
  weather?: WeatherResponse;
}) {
  const t = useT();
  const ports = usePorts();
  const [picked, setPicked] = useState<string | null>(null);
  const [asTable, setAsTable] = useState(false);
  if (classes.length === 0) return null;
  const specs = classes.map(toSpec);
  const current = classes.find((c) => c.name === (picked ?? recommended)) ?? classes[0];
  const gear = (c: VesselClassInfo) => (c.cranes > 0 ? t("{n} cranes", { n: c.cranes }) : t("Gearless"));
  const describe = (name: string) => {
    const c = classes.find((v) => v.name === name)!;
    return t("{cls}: {loa} long, {beam} wide, {draft} laden draft, {holds} holds, {gear}", {
      cls: c.name,
      loa: metres(c.loa_m),
      beam: metres(c.beam_m),
      draft: metres(c.draft_laden_m),
      holds: c.holds,
      gear: gear(c),
    });
  };
  return (
    <div>
      {asTable ? (
        <Table>
          <thead>
            <tr>
              <Th>Vessel type</Th>
              <Th align="right">Length</Th>
              <Th align="right">Beam</Th>
              <Th align="right">Laden draft</Th>
              <Th align="right">Cargo per voyage</Th>
              <Th align="right">Holds</Th>
              <Th>Cargo gear</Th>
            </tr>
          </thead>
          <tbody>
            {classes.map((c) => (
              <Tr key={c.name} mark={c.name === recommended ? "signal" : "none"}>
                <Td className="font-semibold">{c.name}</Td>
                <Td align="right">{metres(c.loa_m)}</Td>
                <Td align="right">{metres(c.beam_m)}</Td>
                <Td align="right">{metres(c.draft_laden_m)}</Td>
                <Td align="right">{tonnes(c.payload_tonnes)}</Td>
                <Td align="right">{c.holds}</Td>
                <Td className="text-ink-2">{gear(c)}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      ) : (
        <div className="overflow-hidden rounded-[var(--radius-surface)] border border-rule bg-surface">
          <FleetView
            specs={specs}
            selected={picked}
            onSelect={setPicked}
            resetLabel={t("Show all")}
            labelFor={(s) => describe(s.name)}
            caption3d={t("Drawn to scale from each type's particulars. Drag to turn, scroll or pinch to zoom, select a ship to look closer.")}
            caption2d={t("Drawn to scale from each type's particulars, fully laden. The dashed line is the waterline.")}
          />
        </div>
      )}
      {!asTable && current && (
        <div className="mt-6">
          <p className="mb-3 text-[15px] font-semibold text-ink">
            {current.name}
            {current.name === recommended && <span className="ml-2 font-normal text-signal">{t("recommended")}</span>}
          </p>
          <FigureRow>
            <Figure label="Length" value={num(current.loa_m)} unit=" m" />
            <Figure label="Beam" value={num(current.beam_m, 1)} unit=" m" />
            <Figure label="Laden draft" value={num(current.draft_laden_m, 1)} unit=" m" />
            <Figure label="Cargo per voyage" value={num(current.payload_tonnes)} unit=" t" />
            <Figure label="Holds" value={current.holds} note={gear(current)} />
          </FigureRow>
          <h3 className="mb-3 mt-8 text-[15px] font-semibold text-ink">
            {port ? t("{cls} up close at {port}", { cls: current.name, port }) : t("{cls} up close", { cls: current.name })}
          </h3>
          <ShipCloseUp
            key={current.name}
            spec={toSpec(current)}
            port={port}
            portEntry={ports.data?.ports.find((p) => p.name === port)}
            usable={feasibility.find((f) => f.port_name === port && f.vessel_class === current.name)?.usable_draft_m ?? null}
            weather={port ? weather?.ports[port] : undefined}
          />
        </div>
      )}
      <Button variant="text" className="mt-3" onClick={() => setAsTable((v) => !v)}>
        {asTable ? "Show the models" : "Show as table"}
      </Button>
    </div>
  );
}
