import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { ApiError, notices } from "../../api";
import { useAuth } from "../../lib/auth";
import { longDate } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { useShipment } from "../../lib/shipment";
import type { DisruptionNotice } from "../../types";
import { SeverityTag } from "../ui/alerts";
import { EmptyState, ErrorState, Skeleton } from "../ui/feedback";
import { FormError, FormNotice, PrimaryButton, SelectInput, TextInput } from "../ui/forms";
import { Button } from "../ui/inputs";
import { Section } from "../ui/layout";
import { MobileItem, MobileList, Table, Td, Th, Tr } from "../ui/table";

function todayIso(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  // Local date, not UTC: a notice entered late in the evening in India is for today.
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const SEVERITIES = ["Medium", "High"] as const;

/** Developer tool: port closures, strikes and other notices that feed the early warnings. */
export function DisruptionNotices() {
  const t = useT();
  const qc = useQueryClient();
  const { user } = useAuth();
  const { reference } = useShipment();
  const ports = reference?.ports ?? [];
  const list = useQuery({ queryKey: ["notices"], queryFn: ({ signal }) => notices.list(signal) });

  const [port, setPort] = useState("");
  const [start, setStart] = useState(todayIso());
  const [end, setEnd] = useState(todayIso(3));
  const [title, setTitle] = useState("");
  const [severity, setSeverity] = useState<(typeof SEVERITIES)[number]>("Medium");
  const [source, setSource] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["notices"] });
    // Notices feed the alerts on every page.
    void qc.invalidateQueries({ queryKey: ["alerts"] });
  };

  const add = useMutation({
    mutationFn: (body: Omit<DisruptionNotice, "id">) => notices.add(body),
    onSuccess: (n) => {
      setDone(t("Added: {title} at {port}.", { title: n.title, port: t(n.port) }));
      setTitle("");
      setSource("");
      refresh();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : t("Couldn't add the notice. Try again.")),
  });
  const remove = useMutation({
    mutationFn: (id: number) => notices.remove(id),
    onSuccess: refresh,
    onError: (e) => setError(e instanceof ApiError ? e.message : t("Couldn't delete the notice. Try again.")),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setDone(null);
    const chosenPort = port || ports[0];
    if (!chosenPort) return setError(t("Choose a port."));
    if (title.trim().length < 3) return setError(t("Describe the disruption in a few words."));
    if (end < start) return setError(t("The end date is before the start date."));
    add.mutate({ port: chosenPort, start_date: start, end_date: end, title: title.trim(), severity: severity === "High" ? "high" : "medium", source: source.trim() });
  };

  const rows = list.data?.notices ?? [];
  const canEdit = !!user?.is_developer;

  return (
    <>
      <Section
        first
        title="Disruption notices"
        description="Port closures, strikes, dredging or cyclone warnings. A notice shows as an early warning at its port from two weeks before it starts until it ends, on every page with alerts."
      >
        {!canEdit && (
          <p className="mb-4 max-w-[68ch] text-[14px] text-ink-2">
            {t("Only developer accounts can add or delete notices. Add the developer code on your Account page.")}
          </p>
        )}
        <form onSubmit={submit} noValidate className="max-w-3xl space-y-4" aria-label={t("Add a disruption notice")}>
          <FormError>{error}</FormError>
          {done && <FormNotice>{done}</FormNotice>}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <SelectInput label="Port" value={port || ports[0] || ""} onChange={setPort} options={ports} />
            <SelectInput
              label="Severity"
              value={severity}
              onChange={(v) => setSeverity(v as (typeof SEVERITIES)[number])}
              options={[...SEVERITIES]}
            />
            <TextInput label="Starts" type="date" value={start} onChange={(e) => setStart(e.target.value)} required />
            <TextInput label="Ends" type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} required />
          </div>
          <TextInput
            label="What's happening"
            value={title}
            maxLength={160}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t("Berth 3 closed for dredging")}
            required
          />
          <TextInput
            label="Source"
            hint={t("Where the notice came from, such as a port circular or an IMD bulletin.")}
            value={source}
            maxLength={300}
            onChange={(e) => setSource(e.target.value)}
          />
          <PrimaryButton type="submit" busy={add.isPending} disabled={!canEdit} className="sm:w-auto">
            {t("Add notice")}
          </PrimaryButton>
        </form>
      </Section>

      <Section title="Current notices" description="Entered here. Notices from the data files are listed in the README.">
        {!list.data ? (
          list.isError ? (
            <ErrorState message="Couldn't load the notices." onRetry={() => void list.refetch()} />
          ) : (
            <Skeleton className="h-32 w-full" />
          )
        ) : rows.length === 0 ? (
          <EmptyState>No notices yet.</EmptyState>
        ) : (
          <>
            <div className="hidden md:block">
              <Table>
                <thead>
                  <tr>
                    <Th>Port</Th>
                    <Th>Notice</Th>
                    <Th>Dates</Th>
                    <Th>Severity</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((n) => (
                    <Tr key={n.id}>
                      <Td className="font-semibold">{t(n.port)}</Td>
                      <Td className="whitespace-normal">
                        {n.title}
                        {n.source && <span className="block text-[12.5px] text-ink-3">{n.source}</span>}
                      </Td>
                      <Td className="text-ink-2">
                        {longDate(n.start_date)} – {longDate(n.end_date)}
                      </Td>
                      <Td>
                        <SeverityTag severity={n.severity} />
                      </Td>
                      <Td align="right">
                        <Button
                          variant="text"
                          disabled={!canEdit || remove.isPending}
                          onClick={() => remove.mutate(n.id)}
                          aria-label={t("Delete the notice {title}", { title: n.title })}
                        >
                          {t("Delete")}
                        </Button>
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </div>
            <div className="md:hidden">
              <MobileList>
                {rows.map((n) => (
                  <MobileItem key={n.id}>
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="font-semibold text-ink">{t(n.port)}</span>
                      <Button
                        variant="text"
                        disabled={!canEdit || remove.isPending}
                        onClick={() => remove.mutate(n.id)}
                        aria-label={t("Delete the notice {title}", { title: n.title })}
                      >
                        {t("Delete")}
                      </Button>
                    </div>
                    <p className="text-[14px] text-ink">{n.title}</p>
                    <p className="mt-0.5 text-[13px] text-ink-3">
                      {longDate(n.start_date)} – {longDate(n.end_date)}
                    </p>
                  </MobileItem>
                ))}
              </MobileList>
            </div>
          </>
        )}
      </Section>
    </>
  );
}
