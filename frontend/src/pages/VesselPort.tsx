import { type T, useT } from "../lib/i18n";
import { Check, X } from "lucide-react";
import { useRef, useState } from "react";
import { BarList, InlineBar } from "../components/ui/bars";
import { EmptyState, ErrorState, PageSkeleton, Refreshing, Skeleton } from "../components/ui/feedback";
import { Delta, Figure, FigureRow, Verdict } from "../components/ui/figures";
import { Button } from "../components/ui/inputs";
import { PageHeader, Section } from "../components/ui/layout";
import { Tooltip } from "../components/ui/overlay";
import { MobileItem, MobileList, Table, Td, Th, Tr } from "../components/ui/table";
import { useMoney } from "../lib/currency";
import { dayRate, days, metres, monthLong, num, pct, perDayUnit, perTonne, perTonneUnit, tonnes, total } from "../lib/format";
import { COST_COMPONENTS, VESSEL_ABBR, VESSEL_CLASSES, originParts, rejectionCodes, rejectionSentences } from "../lib/labels";
import { useCharterTerms, usePorts, useRank, useWeather } from "../lib/queries";
import { ShipTypes } from "../components/ship3d/ShipTypes";
import { useShipment } from "../lib/shipment";
import type { FeasibilityRow, RankedRow } from "../types";

const DEFAULT_ROWS = 8;

function voyagesText(r: RankedRow, tr: T) {
  const text = r.n_voyages > 1 ? `${r.n_voyages} × ${num(r.payload_tonnes)} t` : "1";
  return r.part_loaded ? tr("{n}, part-loaded", { n: text }) : text;
}

export default function VesselPort() {
  const { request, shipment, reference, referenceError, retryReference } = useShipment();
  const tr = useT();
  const rank = useRank(request);
  const weather = useWeather(5);
  const money = useMoney();
  const inputsKey = request ? JSON.stringify(request) : "";
  const [selection, setSelection] = useState<{ key: string; rank: number }>({ key: "", rank: 1 });
  const selectedRank = selection.key === inputsKey ? selection.rank : 1;
  const buildUpRef = useRef<HTMLDivElement>(null);
  const select = (r: number, scroll = false) => {
    setSelection({ key: inputsKey, rank: r });
    if (scroll) requestAnimationFrame(() => buildUpRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  const header = (
    <PageHeader
      meta="One shipment"
      title="Vessel & port"
      description="Which vessel type and discharge port suit this cargo, ranked by landed cost at the plant."
    />
  );

  if (referenceError) {
    return (
      <>
        {header}
        <ErrorState message="Couldn't load the list of ports, plants and load ports." onRetry={retryReference} />
      </>
    );
  }
  if (!rank.data || !shipment) {
    if (rank.isError) {
      return (
        <>
          {header}
          <ErrorState message="Couldn't calculate the ranking for this shipment." onRetry={() => void rank.refetch()} />
        </>
      );
    }
    return <PageSkeleton />;
  }

  const { ranked, feasibility } = rank.data;
  const month = tr(monthLong(shipment.month));
  const best = ranked[0];
  const runner = ranked[1];
  const selected = ranked.find((r) => r.rank === selectedRank) ?? best;
  const classes = reference?.vessel_classes.map((v) => v.name) ?? [...VESSEL_CLASSES];

  return (
    <>
      {header}
      <Refreshing active={rank.isPlaceholderData}>
        {!best ? (
          <EmptyState>{tr("No port can take this cargo in {month}. Try a different month, load port or plant.", { month })}</EmptyState>
        ) : (
          <>
            <Verdict support={runner ? alternativeSentence(best, runner, money, tr) : undefined}>
              {best.n_voyages > 1
                ? tr("Split the cargo into {n} {cls} voyages into {port}.", { n: best.n_voyages, cls: tr(best.vessel_class), port: tr(best.port) })
                : tr("Use a {cls} into {port}.", { cls: tr(best.vessel_class), port: tr(best.port) })}
            </Verdict>
            <FigureRow>
              <Figure label="Landed cost" value={perTonne(best.usd_per_tonne, money)} unit={perTonneUnit()} />
              <Figure label="Shipment total" value={total(best.total_usd, money)} />
              <Figure
                label="Voyages"
                value={best.n_voyages}
                note={tr(best.part_loaded ? "up to {t} t each (part-loaded for the draft), {pct}% full" : "up to {t} t each, {pct}% full", {
                  t: num(best.payload_tonnes),
                  pct: num(best.vessel_fill_pct, 0),
                })}
              />
              <Figure
                label="Expected wait"
                value={days(best.expected_wait_days + best.weather_days)}
                note={best.weather_days > 0 ? tr("per call, incl. {d} of monsoon swell", { d: days(best.weather_days) }) : "per port call"}
              />
              <Figure
                label="At the plant in"
                value={days(best.total_lead_days)}
                note={tr("{sea} at sea, {rail} by rail", { sea: days(best.transit_days), rail: days(best.rail_transit_days) })}
              />
            </FigureRow>

            <Section
              title="Best option for each vessel type"
              description={tr("The cheapest port for each size of ship, and why a size can't be used in {month}.", { month })}
            >
              <PerClass classes={classes} ranked={ranked} feasibility={feasibility} best={best} onSelect={(r) => select(r, true)} />
            </Section>

            <Section
              title="All options"
              description={tr("{n} of {total} port and vessel combinations can take this cargo in {month}. Select one to see its cost build-up.", {
                n: ranked.length,
                total: feasibility.length,
                month,
              })}
            >
              <RankedTable ranked={ranked} selectedRank={selectedRank} onSelect={select} />
            </Section>

            <div className="grid grid-cols-1 xl:grid-cols-2 xl:gap-x-12">
              <div ref={buildUpRef} className="scroll-mt-32">
                <Section
                  title="Cost build-up"
                  description={
                    selected.rank === 1
                      ? tr("{port}, {cls}. Largest cost first.", { port: tr(selected.port), cls: tr(selected.vessel_class) })
                      : tr("{port}, {cls}, rank {rank}. The tick marks rank 1.", { port: tr(selected.port), cls: tr(selected.vessel_class), rank: selected.rank })
                  }
                >
                  <CostBuildUp selected={selected} best={best} />
                </Section>
              </div>
              <Section title="Where each vessel type fits" description={tr("Discharge ports in {month}, and the loading terminal.", { month })}>
                <FitMatrix classes={classes} feasibility={feasibility} best={best} origin={shipment.origin} />
                <HandlingNote />
              </Section>
            </div>

            <Section
              title="Time charter or voyage charter"
              description="The ocean cost of the best options either way: hire and fuel for every day on a time charter, or freight per tonne plus demurrage for waiting on a voyage charter. Port charges, handling and rail are the same either way."
            >
              <CharterTermsTable />
            </Section>

            <Section
              title={tr("The {n} ship types", { n: classes.length })}
              description="Every vessel type this plan can use, to scale, from the smallest Handysize to the Capesize."
            >
              <ShipTypes
                classes={reference?.vessel_classes ?? []}
                recommended={best.vessel_class}
                port={best.port}
                feasibility={feasibility}
                weather={weather.data}
              />
            </Section>

          </>
        )}
      </Refreshing>
    </>
  );
}

function alternativeSentence(best: RankedRow, runner: RankedRow, money: ReturnType<typeof useMoney>, tr: T) {
  const gap = runner.usd_per_tonne - best.usd_per_tonne;
  const vars = { port: tr(runner.port), cls: tr(runner.vessel_class), gap: `${perTonne(gap, money)}${perTonneUnit()}` };
  if (gap / best.usd_per_tonne < 0.01) return tr("{port} on a {cls} is {gap} behind and is the closest alternative.", vars);
  return tr("The next option, {port} on a {cls}, costs {gap} more.", vars);
}

function PerClass({
  classes,
  ranked,
  feasibility,
  best,
  onSelect,
}: {
  classes: string[];
  ranked: RankedRow[];
  feasibility: FeasibilityRow[];
  best: RankedRow;
  onSelect: (rank: number) => void;
}) {
  const money = useMoney();
  const tr = useT();
  const rows = classes.map((cls) => {
    const option = ranked.find((r) => r.vessel_class === cls);
    if (option) return { cls, option, why: null as string | null };
    const failed = feasibility.filter((f) => f.vessel_class === cls && !f.feasible);
    const codes = failed.flatMap((f) => rejectionCodes(f.reasons_failed));
    const top = ["Load port", "Draft", "Class", "Season", "LOA", "Beam"].find((c) => codes.includes(c));
    const why =
      top === "Load port"
        ? "Too big for the loading terminal"
        : top === "Draft"
          ? "Too deep for every port this month"
          : top === "Class"
            ? "Not accepted at the ports that could take its draft"
            : "No port can take it this month";
    return { cls, option: null, why };
  });

  return (
    <Table>
      <thead>
        <tr>
          <Th>Vessel type</Th>
          <Th>Best port</Th>
          <Th align="right">Voyages</Th>
          <Th align="right">Landed cost /t</Th>
          <Th align="right" className="hidden sm:table-cell">vs best</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map(({ cls, option, why }) =>
          option ? (
            <Tr
              key={cls}
              onSelect={() => onSelect(option.rank)}
              mark={option.rank === best.rank ? "signal" : "none"}
              label={tr("{cls}, best at {port}", { cls: tr(cls), port: tr(option.port) })}
            >
              <Td className="font-semibold">{tr(cls)}</Td>
              <Td>{tr(option.port)}</Td>
              <Td align="right" className="text-ink-2">{voyagesText(option, tr)}</Td>
              <Td align="right" className="font-semibold">{perTonne(option.usd_per_tonne, money)}</Td>
              <Td align="right" className="hidden sm:table-cell">
                {option.rank === best.rank ? (
                  <span className="text-ink-3">{tr("best")}</span>
                ) : (
                  <Delta value={option.usd_per_tonne - best.usd_per_tonne}>
                    {perTonne(option.usd_per_tonne - best.usd_per_tonne, money, true)}
                  </Delta>
                )}
              </Td>
            </Tr>
          ) : (
            <Tr key={cls}>
              <Td className="font-semibold text-ink-3">{tr(cls)}</Td>
              <Td className="text-ink-3 whitespace-normal">{tr(why ?? "")}</Td>
              <Td align="right" className="text-ink-3">–</Td>
              <Td align="right" className="text-ink-3">–</Td>
              <Td align="right" className="hidden sm:table-cell text-ink-3">–</Td>
            </Tr>
          )
        )}
      </tbody>
    </Table>
  );
}

function RankedTable({
  ranked,
  selectedRank,
  onSelect,
}: {
  ranked: RankedRow[];
  selectedRank: number;
  onSelect: (rank: number, scroll?: boolean) => void;
}) {
  const tr = useT();
  const money = useMoney();
  const [showAll, setShowAll] = useState(false);
  const best = ranked[0];
  const maxPerTonne = Math.max(...ranked.map((r) => r.usd_per_tonne));
  const rows = showAll ? ranked : ranked.filter((r) => r.rank <= DEFAULT_ROWS || r.rank === selectedRank);

  return (
    <>
      <div className="hidden md:block">
        <Table>
          <thead>
            <tr>
              <Th align="right" className="w-12">#</Th>
              <Th>Port</Th>
              <Th>Vessel</Th>
              <Th align="right">Voyages</Th>
              <Th align="right">Landed cost /t</Th>
              <Th align="right">vs best</Th>
              <Th align="right">Shipment total</Th>
              <Th align="right">Wait</Th>
              <Th align="right">At plant in</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <Tr
                key={`${r.port}-${r.vessel_class}`}
                onSelect={() => onSelect(r.rank)}
                selected={r.rank === selectedRank}
                mark={r.rank === 1 ? "signal" : "none"}
                label={tr("Rank {rank}, {port}, {cls}", { rank: r.rank, port: tr(r.port), cls: tr(r.vessel_class) })}
              >
                <Td align="right" className="text-ink-3">{r.rank}</Td>
                <Td className="font-semibold">{tr(r.port)}</Td>
                <Td className="text-ink-2">{tr(r.vessel_class)}</Td>
                <Td align="right" className="text-ink-2">{voyagesText(r, tr)}</Td>
                <Td align="right">
                  <span className="inline-flex items-center gap-3">
                    <InlineBar value={r.usd_per_tonne} max={maxPerTonne} />
                    <span className="w-16 font-semibold">{perTonne(r.usd_per_tonne, money)}</span>
                  </span>
                </Td>
                <Td align="right" className={r.rank === 1 ? "text-ink-3" : "text-ink-2"}>
                  {r.rank === 1 ? "–" : perTonne(r.usd_per_tonne - best.usd_per_tonne, money, true)}
                </Td>
                <Td align="right" className="text-ink-2">{total(r.total_usd, money)}</Td>
                <Td align="right" className="text-ink-2">{days(r.expected_wait_days)}</Td>
                <Td align="right" className="text-ink-2">{days(r.total_lead_days)}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </div>

      <div className="md:hidden">
        <MobileList>
          {rows.map((r) => (
            <MobileItem
              key={`${r.port}-${r.vessel_class}`}
              onSelect={() => onSelect(r.rank, true)}
              selected={r.rank === selectedRank}
              mark={r.rank === 1 ? "signal" : "none"}
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate">
                  <span className="text-ink-3 mr-2">{r.rank}</span>
                  <span className="font-semibold text-ink">{tr(r.port)}</span>
                  <span className="text-ink-2">, {tr(r.vessel_class)}</span>
                </span>
                <span className="text-[17px] font-semibold text-ink whitespace-nowrap">
                  {perTonne(r.usd_per_tonne, money)}
                  <span className="text-[13px] font-normal text-ink-3">{perTonneUnit()}</span>
                </span>
              </div>
              <div className="mt-1 text-[13.5px] text-ink-3">
                {r.n_voyages > 1 ? `${tr("{n} voyages", { n: r.n_voyages })} · ` : ""}
                {tr("{total} · wait {wait} · at plant in {lead}", {
                  total: total(r.total_usd, money),
                  wait: days(r.expected_wait_days),
                  lead: days(r.total_lead_days),
                })}
              </div>
            </MobileItem>
          ))}
        </MobileList>
      </div>

      {ranked.length > DEFAULT_ROWS && (
        <Button variant="text" className="mt-3" onClick={() => setShowAll((s) => !s)}>
          {showAll ? tr("Show the top {n}", { n: DEFAULT_ROWS }) : tr("Show all {n} options", { n: ranked.length })}
        </Button>
      )}
    </>
  );
}

function CostBuildUp({ selected, best }: { selected: RankedRow; best: RankedRow }) {
  const money = useMoney();
  const tr = useT();
  const comparing = selected.rank !== 1;
  const rows = COST_COMPONENTS.filter((c) => c.key !== "transshipment_cost_usd" || selected.transshipment_cost_usd > 0 || best.transshipment_cost_usd > 0)
    .map((c) => {
      const value = selected[c.key] as number;
      const compare = best[c.key] as number;
      return {
        label: c.label,
        value,
        display: total(value, money),
        share: pct((value / selected.total_usd) * 100, 0),
        compare: comparing ? compare : undefined,
        compareDisplay: comparing ? total(compare, money) : undefined,
      };
    })
    .sort((a, b) => b.value - a.value);

  return (
    <div className="bg-surface border border-rule rounded-[var(--radius-surface)] p-4 md:p-5">
      <BarList rows={rows} compareLabel={tr("Rank 1, {port}", { port: tr(best.port) })} />
      <div className="mt-5 flex items-baseline justify-between border-t border-rule pt-3">
        <span className="text-[14px] font-semibold text-ink">{tr("Shipment total")}</span>
        <span className="text-[15px] font-semibold text-ink">
          {total(selected.total_usd, money)}
          <span className="ml-2 font-normal text-ink-3">
            {perTonne(selected.usd_per_tonne, money)}
            {perTonneUnit()}
          </span>
        </span>
      </div>
      {selected.n_voyages > 1 && (
        <p className="mt-1 text-right text-[13.5px] text-ink-3">
          {tr("Across {n} voyages; hire and port calls are paid per voyage.", { n: selected.n_voyages })}
        </p>
      )}
      <p className="mt-1 text-right text-[13.5px] text-ink-3">
        {tr("Bunkers: {t} of fuel at {price}/t. Waiting includes {d} in the loading-port queue.", {
          t: tonnes(selected.bunker_tonnes),
          price: perTonne(selected.bunker_cost_usd / Math.max(selected.bunker_tonnes, 1), money),
          d: days(selected.load_wait_days),
        })}
      </p>
      {comparing && (
        <p className="mt-1 text-right text-[13.5px] text-ink-3">
          <Delta value={selected.total_usd - best.total_usd}>{total(selected.total_usd - best.total_usd, money, true)}</Delta>{" "}
          {tr("vs rank 1")}
        </p>
      )}
    </div>
  );
}

function FitCell({ f, cls, isBest }: { f: FeasibilityRow | undefined; cls: string; isBest: boolean }) {
  const tr = useT();
  if (!f) return <span className="text-ink-3">–</span>;
  const dischargeReasons = f.reasons_failed
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith("load port"))
    .join("; ");
  if (f.feasible || !dischargeReasons) {
    const part = f.feasible && f.part_loaded;
    const text = tr(part ? "{cls} fits part-loaded, for the draft" : "{cls} fits this port", { cls: tr(cls) });
    return (
      <Tooltip content={isBest ? `${text}. ${tr("This is the recommendation.")}` : `${text}.`}>
        <span tabIndex={0} className="inline-flex items-center gap-1 text-positive" aria-label={text}>
          <Check size={17} strokeWidth={2} />
          {part && <span className="text-[12px] text-ink-3">{tr("part")}</span>}
        </span>
      </Tooltip>
    );
  }
  const sentences = rejectionSentences(dischargeReasons, tr);
  return (
    <Tooltip
      content={
        <ul className="space-y-0.5">
          {sentences.map((s) => (
            <li key={s}>{s}.</li>
          ))}
        </ul>
      }
    >
      <span tabIndex={0} className="inline-flex items-center gap-1 text-ink-3" aria-label={`${tr("{cls} does not fit.", { cls: tr(cls) })} ${sentences.join(". ")}.`}>
        <X size={15} strokeWidth={1.75} />
        <span className="hidden 2xl:inline text-[12.5px]">{tr(rejectionCodes(dischargeReasons)[0] ?? "")}</span>
      </span>
    </Tooltip>
  );
}

function FitMatrix({
  classes,
  feasibility,
  best,
  origin,
}: {
  classes: string[];
  feasibility: FeasibilityRow[];
  best: RankedRow;
  origin: string;
}) {
  const tr = useT();
  const ports: string[] = [];
  const byPort = new Map<string, Map<string, FeasibilityRow>>();
  for (const f of feasibility) {
    if (!byPort.has(f.port_name)) {
      byPort.set(f.port_name, new Map());
      ports.push(f.port_name);
    }
    byPort.get(f.port_name)!.set(f.vessel_class, f);
  }
  const loadPort = (cls: string) => {
    const any = feasibility.find((f) => f.vessel_class === cls);
    const reasons = (any?.reasons_failed ?? "")
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s.startsWith("load port"));
    return reasons;
  };

  return (
    <div className="space-y-4">
      <Table>
        <thead>
          <tr>
            <Th>Discharge port</Th>
            {classes.map((c) => (
              <Th key={c} align="center" className="px-1.5 sm:px-3">
                <Tooltip content={tr(c)}>
                  <span tabIndex={0} aria-label={tr(c)}>{VESSEL_ABBR[c] ?? c}</span>
                </Tooltip>
              </Th>
            ))}
            <Th align="right" className="hidden sm:table-cell">Usable draft</Th>
          </tr>
        </thead>
        <tbody>
          {ports.map((port) => {
            const row = byPort.get(port)!;
            const draft = row.values().next().value?.usable_draft_m;
            return (
              <Tr key={port}>
                <Td className="font-semibold">
                  {tr(port)}
                  {draft !== undefined && (
                    <span className="block sm:hidden text-[12.5px] font-normal text-ink-3">{tr("{m} usable", { m: metres(draft) })}</span>
                  )}
                </Td>
                {classes.map((c) => {
                  const isBest = port === best.port && c === best.vessel_class;
                  return (
                    <Td key={c} align="center" className={`px-1.5 sm:px-3 ${isBest ? "bg-signal-tint" : ""}`}>
                      <FitCell f={row.get(c)} cls={c} isBest={isBest} />
                    </Td>
                  );
                })}
                <Td align="right" className="hidden sm:table-cell text-ink-2">{draft !== undefined ? metres(draft) : "–"}</Td>
              </Tr>
            );
          })}
        </tbody>
      </Table>

      <Table>
        <thead>
          <tr>
            <Th>{tr("Loading at {place}", { place: tr(originParts(origin).short) })}</Th>
            {classes.map((c) => (
              <Th key={c} align="center" className="px-1.5 sm:px-3">{VESSEL_ABBR[c] ?? c}</Th>
            ))}
            <Th className="hidden sm:table-cell" />
          </tr>
        </thead>
        <tbody>
          <Tr>
            <Td className="font-semibold">{tr(originParts(origin).place)}</Td>
            {classes.map((c) => {
              const reasons = loadPort(c);
              return (
                <Td key={c} align="center" className="px-1.5 sm:px-3">
                  {reasons.length === 0 ? (
                    <span className="inline-flex text-positive" aria-label={tr("{cls} can load", { cls: tr(c) })}>
                      <Check size={17} strokeWidth={2} />
                    </span>
                  ) : (
                    <Tooltip content={rejectionSentences(reasons.join("; "), tr).map((s) => `${s}.`).join(" ")}>
                      <span
                        tabIndex={0}
                        className="inline-flex text-ink-3"
                        aria-label={`${tr("{cls} can't load:", { cls: tr(c) })} ${rejectionSentences(reasons.join("; "), tr).join("; ")}`}
                      >
                        <X size={15} strokeWidth={1.75} />
                      </span>
                    </Tooltip>
                  )}
                </Td>
              );
            })}
            <Td className="hidden sm:table-cell" />
          </Tr>
        </tbody>
      </Table>
    </div>
  );
}

const HANDLING_LABEL: Record<string, string> = {
  grab_unloaders: "Grab ship unloaders",
  mobile_harbour_cranes: "Mobile harbour cranes",
  floating_cranes: "Floating cranes",
};

/** How each discharge port unloads coal, and what that means for geared and gearless ships. */
/** Time charter against voyage charter for the best options: laytime, expected demurrage, ocean cost per tonne. */
function CharterTermsTable() {
  const tr = useT();
  const money = useMoney();
  const { request, shipment } = useShipment();
  const q = useCharterTerms(request && shipment ? { ...request, port: shipment.fixedPort ?? null, vessel_class: shipment.fixedClass ?? null } : null);
  if (q.isError) return <ErrorState message="Couldn't compare the charter terms." onRetry={() => void q.refetch()} />;
  if (!q.data) return <Skeleton className="h-48 w-full" />;
  const options = q.data.options;
  if (!options.length) return null;
  const first = options[0];
  return (
    <>
      <p className="mb-4 max-w-[68ch] text-[15px] text-ink">
        {first.cheaper === "voyage"
          ? tr("For {cls} into {port} a voyage charter comes out {d} cheaper: the owner carries the fuel while the ship waits, and demurrage of about {dd} is still less than the hire it replaces.", {
              cls: tr(first.vessel_class),
              port: tr(first.port),
              d: perTonne(first.time_charter_usd_per_tonne - first.voyage_charter_usd_per_tonne, money) + perTonneUnit(),
              dd: days(first.demurrage_days),
            })
          : tr("For {cls} into {port} a time charter comes out {d} cheaper: the owner's margin on voyage freight outweighs what the waiting costs on hire.", {
              cls: tr(first.vessel_class),
              port: tr(first.port),
              d: perTonne(first.voyage_charter_usd_per_tonne - first.time_charter_usd_per_tonne, money) + perTonneUnit(),
            })}
      </p>
      <Table>
        <thead>
          <tr>
            <Th>Option</Th>
            <Th align="right">Time charter /t</Th>
            <Th align="right">Voyage freight /t</Th>
            <Th align="right">Demurrage</Th>
            <Th align="right">Voyage charter /t</Th>
            <Th align="right">Laytime</Th>
          </tr>
        </thead>
        <tbody>
          {options.map((o) => (
            <Tr key={`${o.port}-${o.vessel_class}`}>
              <Td className="font-semibold">{tr("{cls} into {port}", { cls: tr(o.vessel_class), port: tr(o.port) })}</Td>
              <Td align="right" className={o.cheaper === "time" ? "font-semibold text-positive" : undefined}>
                {perTonne(o.time_charter_usd_per_tonne, money)}
              </Td>
              <Td align="right">{perTonne(o.voyage_freight_usd_per_tonne, money)}</Td>
              <Td align="right" className="text-ink-2">
                {o.demurrage_days > 0 ? tr("{d}, {amount}", { d: days(o.demurrage_days), amount: total(o.demurrage_usd, money) }) : tr("None")}
              </Td>
              <Td align="right" className={o.cheaper === "voyage" ? "font-semibold text-positive" : undefined}>
                {perTonne(o.voyage_charter_usd_per_tonne, money)}
              </Td>
              <Td align="right" className="text-ink-2">{tr("{d} per voyage", { d: days(o.laytime_days) })}</Td>
            </Tr>
          ))}
        </tbody>
      </Table>
      <p className="mt-3 text-[13px] text-ink-3">
        {tr("Demurrage at {rate} a day (the hire rate) for waiting past 12 hours' notice at either port; despatch at half that for finishing early.", {
          rate: dayRate(first.demurrage_rate_usd_per_day, money) + perDayUnit(),
        })}
      </p>
    </>
  );
}

function HandlingNote() {
  const tr = useT();
  const { reference } = useShipment();
  const ports = usePorts().data?.ports;
  if (!ports?.length) return null;
  const geared = (reference?.vessel_classes ?? []).filter((v) => (v.cranes ?? 0) > 0).map((v) => tr(v.name));
  return (
    <div className="mt-4 bg-surface border border-rule rounded-[var(--radius-surface)] p-4">
      <h3 className="text-[14px] font-semibold text-ink">{tr("Unloading equipment")}</h3>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13.5px]">
        {ports.map((p) => (
          <div key={p.name} className="contents">
            <dt className="font-semibold text-ink-2">{tr(p.name)}</dt>
            <dd className="text-ink-3">
              {p.handling_type ? tr(HANDLING_LABEL[p.handling_type]) : tr("Berth cranes")}
              {p.shore_equipment ? ` · ${p.shore_equipment}` : ""}
            </dd>
          </div>
        ))}
      </dl>
      {geared.length > 0 && (
        <p className="mt-3 text-[13px] text-ink-3">
          {tr("{classes} carry their own cranes and grabs, so they discharge faster at ports with only mobile or floating cranes. The other types rely on the port's equipment.", {
            classes: geared.join(tr(" and ")),
          })}
        </p>
      )}
    </div>
  );
}
