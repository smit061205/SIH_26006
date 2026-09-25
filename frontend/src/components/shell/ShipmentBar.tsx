import { useT } from "../../lib/i18n";
import { useState } from "react";
import { durationLabel, monthShort, tonnes } from "../../lib/format";
import { originParts, plantShort } from "../../lib/labels";
import { CARGO_MAX, CARGO_MIN, CARGO_STEP, TOLERANCES, useShipment } from "../../lib/shipment";
import { SlidersHorizontal } from "lucide-react";
import { Button, Field, NumberField, type Option, Segmented, Select } from "../ui/inputs";
import { Popover, Sheet } from "../ui/overlay";

const GRADE_SHORT: Record<string, string> = { hard_coking: "Hard coking", semi_soft: "Semi-soft", pci: "PCI" };

/** Days 1-31 as options (the backend trims to the month's length). */
const DAYS: Option[] = Array.from({ length: 31 }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }));

/** A short line for the terms in force: "Hard coking · 10-20 Oct · ±10% · Panamax only". */
function useTermsSummary() {
  const t = useT();
  const { shipment } = useShipment();
  if (!shipment) return "";
  const parts: string[] = [];
  if (shipment.grade) parts.push(t(GRADE_SHORT[shipment.grade]));
  if (shipment.laycanStart !== null) parts.push(`${shipment.laycanStart}–${shipment.laycanEnd ?? shipment.laycanStart} ${t(monthShort(shipment.month))}`);
  if (shipment.tolerancePct) parts.push(`±${shipment.tolerancePct}%`);
  if (shipment.fixedClass) parts.push(t("{cls} only", { cls: shipment.fixedClass }));
  if (shipment.fixedPort) parts.push(t("into {port}", { port: shipment.fixedPort }));
  return parts.join(" · ");
}

/**
 * Fixture terms beyond the basics: the coal grade (which also limits the
 * load ports), the laycan window, the more-or-less quantity, and the planner's
 * own fixed choice of vessel type or discharge port (used by the charter plan).
 */
function TermsFields() {
  const t = useT();
  const { shipment, update, reference } = useShipment();
  if (!shipment || !reference) return null;
  const whole = shipment.laycanStart === null;
  return (
    <div className="space-y-4">
      <Field label="Coal grade">
        <Segmented
          label={t("Coal grade")}
          value={shipment.grade ?? "any"}
          onChange={(v) => update({ grade: v === "any" ? null : (v as typeof shipment.grade) })}
          options={[{ value: "any", label: t("Any") }, ...reference.coal_grades.map((g) => ({ value: g.value, label: t(GRADE_SHORT[g.value]) }))]}
        />
      </Field>
      <Field label="Laycan">
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            label={t("Laycan")}
            value={whole ? "month" : "days"}
            onChange={(v) => update(v === "month" ? { laycanStart: null, laycanEnd: null } : { laycanStart: 1, laycanEnd: 10 })}
            options={[
              { value: "month", label: t("Whole month") },
              { value: "days", label: t("Dates") },
            ]}
          />
          {!whole && (
            <span className="flex items-center gap-1.5 text-[13px] text-ink-2">
              <Select label={t("Laycan opens")} value={String(shipment.laycanStart)} onChange={(v) => update({ laycanStart: Number(v), laycanEnd: Math.max(Number(v), shipment.laycanEnd ?? Number(v)) })} options={DAYS} className="w-[64px]" />
              {t("to")}
              <Select label={t("Laycan closes")} value={String(shipment.laycanEnd ?? shipment.laycanStart)} onChange={(v) => update({ laycanStart: Math.min(shipment.laycanStart ?? 1, Number(v)), laycanEnd: Number(v) })} options={DAYS} className="w-[64px]" />
              {t(monthShort(shipment.month))}
            </span>
          )}
        </div>
      </Field>
      <Field label="Quantity tolerance (more or less)">
        <Segmented
          label={t("Quantity tolerance")}
          value={String(shipment.tolerancePct)}
          onChange={(v) => update({ tolerancePct: Number(v) })}
          options={TOLERANCES.map((n) => ({ value: String(n), label: n === 0 ? t("Exact") : `±${n}%` }))}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Vessel type">
          <Select
            label={t("Fixed vessel type")}
            value={shipment.fixedClass ?? "auto"}
            onChange={(v) => update({ fixedClass: v === "auto" ? null : v })}
            options={[{ value: "auto", label: t("Best for the plan") }, ...reference.vessel_classes.map((v) => ({ value: v.name, label: v.name }))]}
          />
        </Field>
        <Field label="Discharge port">
          <Select
            label={t("Fixed discharge port")}
            value={shipment.fixedPort ?? "auto"}
            onChange={(v) => update({ fixedPort: v === "auto" ? null : v })}
            options={[{ value: "auto", label: t("Best for the plan") }, ...reference.ports.map((p) => ({ value: p, label: p }))]}
          />
        </Field>
      </div>
      <p className="text-[12.5px] leading-snug text-ink-3">
        {t("The grade limits the load ports to those that ship it. A fixed vessel type or port applies to the charter plan.")}
      </p>
    </div>
  );
}

function TermsButton() {
  const t = useT();
  const summary = useTermsSummary();
  return (
    <Popover
      title="Fixture terms"
      align="start"
      trigger={
        <Button variant="text" className="no-underline text-ink-2 hover:text-ink" aria-label={t("Fixture terms")}>
          <SlidersHorizontal size={14} strokeWidth={1.75} aria-hidden />
          <span className="max-w-[16rem] truncate">{summary || t("Fixture terms")}</span>
        </Button>
      }
    >
      <TermsFields />
    </Popover>
  );
}

function useOptions() {
  const { reference, shipment } = useShipment();
  const months: Option[] = (reference?.months ?? []).map((m) => ({ value: String(m.value), label: m.label }));
  // Only the load ports that ship the chosen grade.
  const grade = shipment?.grade;
  const origins: Option[] = (reference?.origins ?? []).filter((o) => !grade || (reference?.origin_grades?.[o] ?? []).includes(grade)).map((o) => {
    const p = originParts(o);
    return { value: o, label: p.label, short: `${p.short}, ${p.country}` };
  });
  const plants: Option[] = (reference?.plants ?? []).map((p) => ({ value: p, label: p, short: plantShort(p) }));
  const durations: Option[] = (reference?.durations ?? []).map((d) => ({ value: String(d.value), label: durationLabel(d.value) }));
  return { months, origins, plants, durations };
}

function Fields({ layout, showDuration }: { layout: "inline" | "stack"; showDuration: boolean }) {
  const { shipment, update } = useShipment();
  const { months, origins, plants, durations } = useOptions();
  if (!shipment) return null;
  const inline = layout === "inline";
  const contract = showDuration && shipment.duration > 0;
  return (
    <>
      <Field label="Plant" layout={layout}>
        <Select
          label="Destination plant"
          value={shipment.plant}
          onChange={(v) => update({ plant: v })}
          options={plants}
          className={inline ? "w-[128px]" : ""}
        />
      </Field>
      <Field label="Load port" layout={layout}>
        <Select
          label="Load port"
          value={shipment.origin}
          onChange={(v) => update({ origin: v })}
          options={origins}
          className={inline ? "w-[196px]" : ""}
        />
      </Field>
      <Field label={contract ? "Cargo / month" : "Cargo"} layout={layout}>
        <NumberField
          label={contract ? "Cargo per month in tonnes" : "Cargo in tonnes"}
          value={shipment.cargoTonnes}
          onCommit={(v) => update({ cargoTonnes: v })}
          min={CARGO_MIN}
          max={CARGO_MAX}
          step={CARGO_STEP}
          unit="t"
          className={inline ? "w-[150px]" : ""}
        />
      </Field>
      <Field label={contract ? "Starting" : inline ? "Delivery" : "Delivery month"} layout={layout}>
        <Select
          label={contract ? "First delivery month" : "Delivery month"}
          value={String(shipment.month)}
          onChange={(v) => update({ month: Number(v) })}
          options={months}
          className={inline ? "w-[124px]" : ""}
        />
      </Field>
      {showDuration && (
        <Field label="Contract" layout={layout}>
          <Select
            label="Contract length"
            value={String(shipment.duration)}
            onChange={(v) => update({ duration: Number(v) })}
            options={durations}
            className={inline ? "w-[150px]" : ""}
          />
        </Field>
      )}
    </>
  );
}

export function ShipmentBar({ showDuration = false }: { showDuration?: boolean }) {
  const { shipment, referenceError } = useShipment();
  const t = useT();
  const summary = useTermsSummary();
  const [open, setOpen] = useState(false);

  if (!shipment) {
    return referenceError ? null : <div aria-hidden className="h-[59px] border-b border-rule bg-paper" />;
  }

  return (
    <div className="bg-paper border-b border-rule">
      <div className="mx-auto max-w-[1264px] px-4 sm:px-6 lg:px-8">
        <div className="hidden md:flex flex-wrap items-center gap-x-5 gap-y-2.5 py-2.5">
          <Fields layout="inline" showDuration={showDuration} />
          <TermsButton />
        </div>

        <div className="md:hidden flex items-center justify-between gap-3 py-2.5">
          <p className="min-w-0 text-[14px] text-ink-2 leading-snug">
            <span className="font-semibold text-ink">{plantShort(shipment.plant)}</span>
            {" · "}
            {t("{cargo} from {origin}", { cargo: tonnes(shipment.cargoTonnes), origin: originParts(shipment.origin).short })}
            {" · "}
            {t(monthShort(shipment.month))}
            {showDuration && <> · {shipment.duration === 0 ? t("spot") : t("{n} mo", { n: shipment.duration })}</>}
            {summary && <span className="block text-[13px] text-ink-3">{summary}</span>}
          </p>
          <Button onClick={() => setOpen(true)}>Change</Button>
        </div>
      </div>

      <Sheet
        open={open}
        onOpenChange={setOpen}
        title="Shipment"
        footer={
          <Button className="w-full justify-center" onClick={() => setOpen(false)}>
            Done
          </Button>
        }
      >
        <div className="space-y-4">
          <Fields layout="stack" showDuration={showDuration} />
          <div className="border-t border-rule pt-4">
            <p className="mb-3 text-[14px] font-semibold text-ink">{t("Fixture terms")}</p>
            <TermsFields />
          </div>
        </div>
      </Sheet>
    </div>
  );
}
