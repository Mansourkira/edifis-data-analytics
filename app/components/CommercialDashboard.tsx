"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Download, Loader2, Printer, RefreshCw, Search } from "lucide-react";
import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { createBrowserSupabaseClient } from "../lib/supabase/client";
import ChartSizeGate from "./ChartSizeGate";
import { exportElementToPdf } from "../lib/export-pdf";
import { useTheme } from "./ThemeProvider";

type DashboardRow = {
  year: number;
  monthIndex: number;
  monthLabel: string;
  clientName: string;
  commercial: string;
  familyCode: string;
  familyLabel: string;
  brand: string;
  article: string;
  quantity: number;
  totalHt: number;
};

type DashboardPayload = {
  rows: DashboardRow[];
  timestamp: Date;
};

type Filters = {
  client: string;
  commercial: string;
  year: string;
  family: string;
  brand: string;
  search: string;
};

const MONTHS_FR = [
  "JAN",
  "FÉV",
  "MAR",
  "AVR",
  "MAI",
  "JUIN",
  "JUIL",
  "AOÛ",
  "SEP",
  "OCT",
  "NOV",
  "DÉC",
];

const PIE_COLORS = ["#3f7fc3", "#f5a24a", "#79c18d", "#e7c15a", "#b6b9c0", "#8c9ccb"];

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function asNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function asDate(value: unknown): Date | null {
  if (typeof value !== "string" || !value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** EUR with narrow no-break space as thousands separator (French ERP style). */
function formatCurrencyEur(value: number): string {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatIntegerFr(value: number): string {
  return new Intl.NumberFormat("fr-FR", {
    maximumFractionDigits: 0,
  }).format(value);
}

async function fetchDashboardData(): Promise<DashboardPayload> {
  const supabase = createBrowserSupabaseClient();

  const [productsResult, familiesResult] = await Promise.all([
    supabase.from("products").select("*"),
    supabase.from("families").select("*"),
  ]);

  if (productsResult.error) throw productsResult.error;
  if (familiesResult.error) throw familiesResult.error;

  const products = (productsResult.data ?? []) as Record<string, unknown>[];
  const families = (familiesResult.data ?? []) as Record<string, unknown>[];

  const familyByCode = new Map<string, string>();
  for (const family of families) {
    const code = asString(family.family_code ?? family.code ?? family.id);
    if (!code) continue;
    familyByCode.set(
      code,
      asString(family.label ?? family.name ?? family.libelle, code),
    );
  }

  const normalizedProducts = products.map((product) => {
    const familyCode = asString(
      product.family_code ?? product.family ?? product.famille_code,
      "N/A",
    );
    const familyLabel = familyByCode.get(familyCode) ?? familyCode;
    const brand = asString(product.brand ?? product.marque, "Sans marque");
    const article = asString(
      product.product_name ?? product.name ?? product.article ?? product.designation,
      "Article",
    );

    const quantity = Math.max(0, asNumber(product.stock ?? product.quantity ?? 0));
    const priceHt = asNumber(product.price_ht ?? product.price ?? product.unit_price ?? 0);
    return { familyCode, familyLabel, brand, article, quantity, priceHt };
  });

  const grouped = new Map<
    string,
    { familyCode: string; familyLabel: string; brand: string; article: string; quantity: number; priceHt: number }
  >();
  for (const product of normalizedProducts) {
    const key = `${product.familyCode}|${product.brand}|${product.article}`;
    const current = grouped.get(key);
    if (current) {
      current.quantity += product.quantity;
      const p = product.priceHt > 0 ? product.priceHt : current.priceHt;
      const q = current.priceHt > 0 ? current.priceHt : product.priceHt;
      current.priceHt = p > 0 ? p : q;
    } else {
      grouped.set(key, { ...product });
    }
  }

  // Build mock monthly sales since there is no sales table yet.
  const currentYear = new Date().getFullYear();
  const template = Array.from(grouped.values());
  const rows: DashboardRow[] = template.flatMap((item, itemIndex) => {
    const monthCount = 3 + (itemIndex % 4);
    return Array.from({ length: monthCount }, (_, idx) => {
      const monthIndex = idx % 12;
      const multiplier = 0.35 + ((itemIndex + idx) % 5) * 0.15;
      const quantity = Math.max(1, Math.round(item.quantity * multiplier));
      // If DB has no unit price, use a stable demo HT so TOTAL HT is never 0 when qty > 0
      const unitHt =
        item.priceHt > 0
          ? item.priceHt
          : 18.5 + (itemIndex * 37 + idx * 11 + item.article.length) % 4200;
      const totalHt = Number((quantity * unitHt).toFixed(2));

      return {
        year: currentYear,
        monthIndex,
        monthLabel: MONTHS_FR[monthIndex] ?? "N/A",
        clientName: "SARL Martin",
        commercial: "Jean Dupont",
        familyCode: item.familyCode,
        familyLabel: item.familyLabel,
        brand: item.brand,
        article: item.article,
        quantity,
        totalHt,
      };
    });
  });

  const lastUpdated = products.length
    ? new Date(
      Math.max(
        ...products
          .map((p) => asDate(p.updated_at)?.getTime() ?? 0)
          .filter((value) => value > 0),
      ),
    )
    : new Date();

  return { rows, timestamp: Number.isNaN(lastUpdated.getTime()) ? new Date() : lastUpdated };
}

export default function CommercialDashboard() {
  const { theme } = useTheme();
  const pdfRootRef = useRef<HTMLDivElement>(null);
  const [pdfExporting, setPdfExporting] = useState(false);
  const [rows, setRows] = useState<DashboardRow[]>([]);
  /** null until data loads — avoids SSR/client `new Date()` hydration mismatch in the footer */
  const [timestamp, setTimestamp] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [filters, setFilters] = useState<Filters>({
    client: "",
    commercial: "",
    year: "",
    family: "",
    brand: "",
    search: "",
  });

  const loadDashboard = async () => {
    try {
      setLoading(true);
      setError(null);
      const payload = await fetchDashboardData();
      setRows(payload.rows);
      setTimestamp(payload.timestamp);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur de chargement");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadDashboard();
  }, []);

  const options = useMemo(() => {
    const uniq = (values: string[]) => Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
    return {
      clients: uniq(rows.map((r) => r.clientName)),
      commercials: uniq(rows.map((r) => r.commercial)),
      years: uniq(rows.map((r) => String(r.year))),
      families: uniq(rows.map((r) => r.familyLabel)),
      brands: uniq(rows.map((r) => r.brand)),
    };
  }, [rows]);

  const filteredRows = useMemo(() => {
    const normalizedSearch = filters.search.trim().toLowerCase();
    return rows.filter((row) => {
      if (filters.client && row.clientName !== filters.client) return false;
      if (filters.commercial && row.commercial !== filters.commercial) return false;
      if (filters.year && String(row.year) !== filters.year) return false;
      if (filters.family && row.familyLabel !== filters.family) return false;
      if (filters.brand && row.brand !== filters.brand) return false;
      if (!normalizedSearch) return true;
      return [row.clientName, row.commercial, row.familyLabel, row.brand, row.article]
        .join(" ")
        .toLowerCase()
        .includes(normalizedSearch);
    });
  }, [rows, filters]);

  const tableRows = useMemo(() => {
    const grouped = new Map<string, DashboardRow>();
    for (const row of filteredRows) {
      const key = `${row.year}|${row.monthIndex}|${row.familyLabel}|${row.brand}|${row.article}`;
      const current = grouped.get(key);
      if (current) {
        current.quantity += row.quantity;
        current.totalHt += row.totalHt;
      } else {
        grouped.set(key, { ...row });
      }
    }

    return Array.from(grouped.values()).sort((a, b) => {
      if (a.year !== b.year) return b.year - a.year;
      if (a.monthIndex !== b.monthIndex) return a.monthIndex - b.monthIndex;
      return a.brand.localeCompare(b.brand);
    });
  }, [filteredRows]);

  const pieData = useMemo(() => {
    const byBrand = new Map<string, number>();
    for (const row of filteredRows) {
      byBrand.set(row.brand, (byBrand.get(row.brand) ?? 0) + row.totalHt);
    }
    return Array.from(byBrand.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [filteredRows]);

  const pieTotal = useMemo(
    () => pieData.reduce((sum, d) => sum + d.value, 0),
    [pieData],
  );

  const totals = useMemo(
    () =>
      tableRows.reduce(
        (acc, row) => ({
          quantity: acc.quantity + row.quantity,
          totalHt: acc.totalHt + row.totalHt,
        }),
        { quantity: 0, totalHt: 0 },
      ),
    [tableRows],
  );

  const handleExportPdf = async () => {
    if (!pdfRootRef.current || pdfExporting) return;
    try {
      setPdfExporting(true);
      await exportElementToPdf(pdfRootRef.current, `tableau-commercial-${new Date().toISOString().slice(0, 10)}.pdf`);
    } catch (e) {
      console.error(e);
      window.alert("Export PDF impossible. Reessayez apres le chargement complet des graphiques.");
    } finally {
      setPdfExporting(false);
    }
  };

  const tooltipContentStyle = {
    borderRadius: 8,
    border: theme === "dark" ? "1px solid #334155" : "1px solid #d9e2ec",
    fontSize: 12,
    backgroundColor: theme === "dark" ? "#1e293b" : "#fff",
    color: theme === "dark" ? "#e2e8f0" : "#0f172a",
  };

  return (
    <div className="min-h-screen bg-[#f0f4f8] p-3 font-sans text-slate-700 dark:bg-slate-950 dark:text-slate-200">
      <div
        ref={pdfRootRef}
        className="mx-auto max-w-[1280px] rounded-lg border border-slate-300 bg-white shadow-sm dark:border-slate-600 dark:bg-slate-900"
      >
        <header className="rounded-t-lg bg-[#5b8dbd] px-4 py-2 text-center text-sm font-bold tracking-wide text-white uppercase">
          TABLEAU DE BORD COMMERCIAL - STATISTIQUES CLIENT
        </header>

        <section className="relative border-b border-slate-200 bg-slate-100 px-4 py-3 dark:border-slate-600 dark:bg-slate-800/80">
          <div className="mb-2 flex flex-wrap items-end gap-3 pr-40">
            <FilterSelect label="Nom du Client" value={filters.client} options={options.clients} onChange={(value) => setFilters((prev) => ({ ...prev, client: value }))} />
            <FilterSelect label="Commercial" value={filters.commercial} options={options.commercials} onChange={(value) => setFilters((prev) => ({ ...prev, commercial: value }))} />
            <div className="min-w-56 flex-1">
              <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">Search</label>
              <div className="flex items-center gap-2 rounded-md border border-slate-300 bg-white px-2 dark:border-slate-600 dark:bg-slate-900">
                <Search size={14} className="text-slate-500 dark:text-slate-400" />
                <input
                  value={filters.search}
                  onChange={(event) => setFilters((prev) => ({ ...prev, search: event.target.value }))}
                  placeholder="Search"
                  className="h-8 w-full bg-transparent text-xs text-slate-700 outline-none dark:text-slate-200"
                />
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-3 pr-40">
            <FilterSelect label="Année" value={filters.year} options={options.years} onChange={(value) => setFilters((prev) => ({ ...prev, year: value }))} />
            <FilterSelect label="Famille d'Articles" value={filters.family} options={options.families} onChange={(value) => setFilters((prev) => ({ ...prev, family: value }))} />
            <FilterSelect label="Marque" value={filters.brand} options={options.brands} onChange={(value) => setFilters((prev) => ({ ...prev, brand: value }))} />
          </div>

          <div className="absolute top-3 right-4 min-w-[200px] space-y-1 text-[11px] text-slate-600 dark:text-slate-300">
            {pieData.slice(0, 4).map((item, index) => (
              <div key={item.name} className="flex items-center justify-between gap-3">
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    className="inline-block size-2.5 shrink-0 rounded-sm"
                    style={{ backgroundColor: PIE_COLORS[index % PIE_COLORS.length] }}
                  />
                  <span className="truncate">{item.name}</span>
                </span>
                <span className="shrink-0 tabular-nums text-slate-800 dark:text-slate-200">
                  {formatCurrencyEur(item.value)}
                </span>
              </div>
            ))}
          </div>
        </section>

        {loading ? (
          <div className="flex h-80 items-center justify-center gap-2 text-sm text-slate-600 dark:text-slate-300">
            <Loader2 className="size-4 animate-spin" />
            Chargement des donnees...
          </div>
        ) : error ? (
          <div className="mx-4 my-4 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="mx-4 my-4 rounded-md border border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-600 dark:border-slate-600 dark:bg-slate-800/50 dark:text-slate-300">
            Aucune donnee disponible pour les filtres selectionnes.
          </div>
        ) : (
          <section className="grid grid-cols-1 gap-3 px-3 py-3 lg:grid-cols-5">
            <article className="rounded-md border border-slate-200 bg-white lg:col-span-3 dark:border-slate-600 dark:bg-slate-900">
              <h2 className="border-b border-slate-200 px-3 py-2 text-xs font-bold tracking-wide text-slate-700 uppercase dark:border-slate-600 dark:text-slate-200">
                DETAIL DES VENTES MENSUELLES PAR FAMILLE & MARQUE
              </h2>
              <div className="max-h-[430px] overflow-auto">
                <table className="w-full border-collapse text-[11px]">
                  <thead className="sticky top-0 bg-slate-100 text-[10px] font-bold tracking-wide text-[#4e78a3] uppercase dark:bg-slate-800 dark:text-sky-400">
                    <tr>
                      <th className="border-b border-slate-200 px-2 py-1 text-left dark:border-slate-600">ANNEE</th>
                      <th className="border-b border-slate-200 px-2 py-1 text-left dark:border-slate-600">MOIS</th>
                      <th className="border-b border-slate-200 px-2 py-1 text-left dark:border-slate-600">FAMILLE</th>
                      <th className="border-b border-slate-200 px-2 py-1 text-left dark:border-slate-600">MARQUE</th>
                      <th className="border-b border-slate-200 px-2 py-1 text-left dark:border-slate-600">ARTICLE</th>
                      <th className="border-b border-slate-200 px-2 py-1 text-right dark:border-slate-600">QTE VENDUE</th>
                      <th className="border-b border-slate-200 px-2 py-1 text-right dark:border-slate-600">TOTAL HT</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tableRows.map((row, index) => (
                      <tr key={`${row.year}-${row.monthIndex}-${row.familyCode}-${row.brand}-${row.article}-${index}`} className={index % 2 === 0 ? "bg-white dark:bg-slate-900" : "bg-slate-50 dark:bg-slate-800/40"}>
                        <td className="px-2 py-1">{row.year}</td>
                        <td className="px-2 py-1">{row.monthLabel}</td>
                        <td className="px-2 py-1">{row.familyLabel}</td>
                        <td className="px-2 py-1">{row.brand}</td>
                        <td className="max-w-[220px] truncate px-2 py-1 align-top" title={row.article}>
                          {row.article}
                        </td>
                        <td className="px-2 py-1 text-right tabular-nums">{formatIntegerFr(row.quantity)}</td>
                        <td className="px-2 py-1 text-right font-medium tabular-nums text-slate-900 dark:text-slate-100">
                          {formatCurrencyEur(row.totalHt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-slate-100 text-[11px] font-bold dark:bg-slate-800">
                    <tr>
                      <td colSpan={5} className="border-t border-slate-200 px-2 py-1 dark:border-slate-600">
                        Totals
                      </td>
                      <td className="border-t border-slate-200 px-2 py-1 text-right tabular-nums dark:border-slate-600">
                        {formatIntegerFr(totals.quantity)}
                      </td>
                      <td className="border-t border-slate-200 px-2 py-1 text-right text-base tabular-nums text-[#1f4f7a] dark:border-slate-600 dark:text-sky-300">
                        {formatCurrencyEur(totals.totalHt)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </article>

            <article className="rounded-md border border-slate-200 bg-white lg:col-span-2 dark:border-slate-600 dark:bg-slate-900">
              <h2 className="border-b border-slate-200 px-3 py-2 text-center text-xs font-bold tracking-wide text-slate-700 uppercase dark:border-slate-600 dark:text-slate-200">
                REPARTITION DU CHIFFRE D&apos;AFFAIRES (CA HT) PAR MARQUE
              </h2>
              <div className="h-[430px] min-h-[280px] w-full min-w-0 px-2 py-3">
                <ChartSizeGate className="h-full w-full">
                  {({ width, height }) => (
                    <ResponsiveContainer width={width} height={height}>
                      <PieChart margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
                        <Pie
                          data={pieData}
                          dataKey="value"
                          nameKey="name"
                          cx="50%"
                          cy="42%"
                          innerRadius={0}
                          outerRadius={88}
                          paddingAngle={pieData.length > 1 ? 1 : 0}
                          label={false}
                          stroke="#fff"
                          strokeWidth={1}
                        >
                          {pieData.map((entry, index) => (
                            <Cell key={entry.name} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip
                          formatter={(value) =>
                            formatCurrencyEur(Number(Array.isArray(value) ? value[0] : (value ?? 0)))
                          }
                          labelFormatter={(name) => String(name)}
                          contentStyle={tooltipContentStyle}
                        />
                        <Legend
                          verticalAlign="bottom"
                          align="center"
                          iconType="circle"
                          wrapperStyle={{
                            fontSize: "11px",
                            lineHeight: "16px",
                            paddingTop: "4px",
                          }}
                          formatter={(value, entry) => {
                            const raw = entry as { payload?: { value?: number } };
                            const v = raw?.payload?.value ?? 0;
                            const pct =
                              pieTotal > 0
                                ? new Intl.NumberFormat("fr-FR", {
                                    minimumFractionDigits: 1,
                                    maximumFractionDigits: 1,
                                  }).format((v / pieTotal) * 100)
                                : "0,0";
                            return `${String(value)} — ${formatCurrencyEur(v)} (${pct}%)`;
                          }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  )}
                </ChartSizeGate>
              </div>
            </article>
          </section>
        )}

        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-slate-100 px-4 py-2 dark:border-slate-600 dark:bg-slate-800/80">
          <p className="text-xs text-slate-600 dark:text-slate-300">
            Data Timestamp : {timestamp ? timestamp.toLocaleString("fr-FR") : "—"}
          </p>
          <div data-pdf-ignore className="flex flex-wrap items-center gap-2">
            <ActionButton icon={Download} label="Exporter Excel" />
            <ActionButton
              icon={Printer}
              label={pdfExporting ? "PDF..." : "Imprimer PDF"}
              onClick={handleExportPdf}
              disabled={pdfExporting}
            />
            <ActionButton icon={RefreshCw} label="Rafraîchir" onClick={loadDashboard} />
          </div>
        </footer>
      </div>
    </div>
  );
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="min-w-48 flex-1">
      <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">{label}</label>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-8 w-full rounded-md border border-slate-300 bg-white px-2 text-xs text-slate-700 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"
      >
        <option value="">Toutes</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </div>
  );
}

function ActionButton({
  icon: Icon,
  label,
  onClick,
  disabled,
}: {
  icon: typeof Download;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-8 items-center gap-1 rounded border border-slate-300 bg-white px-3 text-xs text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
    >
      <Icon size={14} />
      {label}
    </button>
  );
}
