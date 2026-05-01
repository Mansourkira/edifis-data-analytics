"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Printer } from "lucide-react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatCurrencyTnd } from "../lib/format-currency";
import { createBrowserSupabaseClient } from "../lib/supabase/client";
import { exportElementToPdf, waitForPdfDomStable } from "../lib/export-pdf";
import ChartSizeGate from "./ChartSizeGate";
import { useTheme } from "./ThemeProvider";

type ProductOption = { code: string; label: string };
type ClientOption = { ctNum: string; name: string };
type CommercialOption = { coNo: string; name: string };

type SalesFilters = {
  selectedProductCodes: string[];
  selectedClientCtNum: string;
  selectedCommercialCoNo: string;
  monthFrom: string;
  monthTo: string;
};

type SalesMonthlyRaw = Record<string, unknown>;
type MonthlyAgg = { monthStart: string; year: number; month: number; quantity: number; totalHt: number };

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function asNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(value);
}

function toMonthInputValue(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function startOfMonthIso(month: string): string {
  return `${month}-01`;
}

function endOfMonthIso(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const end = new Date(y, m, 0);
  return `${y}-${String(m).padStart(2, "0")}-${String(end.getDate()).padStart(2, "0")}`;
}

function normalizeMonthlyRows(rows: SalesMonthlyRaw[]): MonthlyAgg[] {
  const map = new Map<string, MonthlyAgg>();
  for (const r of rows) {
    const monthStartRaw = asString(r.month_start ?? r.month ?? r.period_start);
    if (!monthStartRaw) continue;

    const monthStart = monthStartRaw.slice(0, 10);
    const parts = monthStart.split("-").map(Number);
    if (parts.length < 2 || !parts[0] || !parts[1]) continue;
    const year = parts[0];
    const month = parts[1];
    if (month < 1 || month > 12) continue;
    const quantity = asNumber(r.qty_sold ?? r.quantity_sold ?? r.quantity ?? r.qte_vendue);
    const totalHt = asNumber(r.total_ht ?? r.totalHt ?? r.amount_ht);

    const key = `${year}|${month}`;
    const cur = map.get(key);
    if (cur) {
      cur.quantity += quantity;
      cur.totalHt += totalHt;
    } else {
      map.set(key, { monthStart, year, month, quantity, totalHt });
    }
  }
  return Array.from(map.values()).sort((a, b) => a.monthStart.localeCompare(b.monthStart));
}

async function fetchFilterOptions() {
  const supabase = createBrowserSupabaseClient();
  const [productsRes, clientsRes, commercialsRes] = await Promise.all([
    supabase.from("products").select("code, name").order("name", { ascending: true }),
    supabase.from("clients").select("ct_num, name").order("name", { ascending: true }),
    supabase.from("commercials").select("co_no, code, first_name").order("co_no", { ascending: true }),
  ]);

  if (productsRes.error) throw productsRes.error;
  if (clientsRes.error) throw clientsRes.error;
  if (commercialsRes.error) throw commercialsRes.error;

  const products: ProductOption[] = (productsRes.data ?? [])
    .map((r) => ({
      code: asString((r as Record<string, unknown>).code),
      label: asString((r as Record<string, unknown>).name, asString((r as Record<string, unknown>).code)),
    }))
    .filter((p) => p.code)
    .sort((a, b) => a.label.localeCompare(b.label));

  const clients: ClientOption[] = (clientsRes.data ?? [])
    .map((r) => ({
      ctNum: asString((r as Record<string, unknown>).ct_num),
      name: asString((r as Record<string, unknown>).name, asString((r as Record<string, unknown>).ct_num)),
    }))
    .filter((c) => c.ctNum)
    .sort((a, b) => a.name.localeCompare(b.name));

  const commercials: CommercialOption[] = (commercialsRes.data ?? [])
    .map((r) => {
      const coNo = (r as Record<string, unknown>).co_no;
      const code = asString((r as Record<string, unknown>).code);
      const firstName = asString((r as Record<string, unknown>).first_name);
      const label = [code, firstName].filter(Boolean).join(" ").trim();
      return {
        coNo: coNo === null || coNo === undefined ? "" : String(coNo),
        name: label || String(coNo ?? ""),
      };
    })
    .filter((c) => c.coNo)
    .sort((a, b) => a.name.localeCompare(b.name));

  return { products, clients, commercials };
}

async function fetchMonthlyStats(filters: SalesFilters): Promise<MonthlyAgg[]> {
  const supabase = createBrowserSupabaseClient();
  let query = supabase
    .from("v_sales_monthly")
    .select("month_start, product_code, client_ct_num, commercial_co_no, qty_sold, total_ht")
    .order("month_start", { ascending: true });

  if (filters.selectedClientCtNum) query = query.eq("client_ct_num", filters.selectedClientCtNum);
  if (filters.selectedCommercialCoNo) {
    const n = Number(filters.selectedCommercialCoNo);
    if (Number.isFinite(n)) query = query.eq("commercial_co_no", n);
  }
  if (filters.selectedProductCodes.length > 0) query = query.in("product_code", filters.selectedProductCodes);
  if (filters.monthFrom) query = query.gte("month_start", startOfMonthIso(filters.monthFrom));
  if (filters.monthTo) query = query.lte("month_start", endOfMonthIso(filters.monthTo));

  const { data, error } = await query;
  if (error) throw error;
  return normalizeMonthlyRows((data ?? []) as SalesMonthlyRaw[]);
}

export default function StatistiquesDeVente() {
  const { theme } = useTheme();
  const pdfRootRef = useRef<HTMLDivElement>(null);
  const [pdfExporting, setPdfExporting] = useState(false);
  const [loadingOptions, setLoadingOptions] = useState(true);
  const [loadingStats, setLoadingStats] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [productOptions, setProductOptions] = useState<ProductOption[]>([]);
  const [clientOptions, setClientOptions] = useState<ClientOption[]>([]);
  const [commercialOptions, setCommercialOptions] = useState<CommercialOption[]>([]);

  const now = new Date();
  const [filters, setFilters] = useState<SalesFilters>({
    selectedProductCodes: [],
    selectedClientCtNum: "",
    selectedCommercialCoNo: "",
    monthFrom: toMonthInputValue(new Date(now.getFullYear(), 0, 1)),
    monthTo: toMonthInputValue(now),
  });

  const [monthlyData, setMonthlyData] = useState<MonthlyAgg[]>([]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        setLoadingOptions(true);
        setError(null);
        const { products, clients, commercials } = await fetchFilterOptions();
        if (!active) return;
        setProductOptions(products);
        setClientOptions(clients);
        setCommercialOptions(commercials);
      } catch (e) {
        if (!active) return;
        setError(e instanceof Error ? e.message : "Erreur de chargement des filtres");
      } finally {
        if (active) setLoadingOptions(false);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        setLoadingStats(true);
        setError(null);
        const rows = await fetchMonthlyStats(filters);
        if (!active) return;
        setMonthlyData(rows);
      } catch (e) {
        if (!active) return;
        setError(e instanceof Error ? e.message : "Erreur de chargement des statistiques");
      } finally {
        if (active) setLoadingStats(false);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [filters]);

  const yearTotals = useMemo(() => {
    const totals = new Map<number, { quantity: number; totalHt: number }>();
    for (const row of monthlyData) {
      const cur = totals.get(row.year) ?? { quantity: 0, totalHt: 0 };
      cur.quantity += row.quantity;
      cur.totalHt += row.totalHt;
      totals.set(row.year, cur);
    }
    return totals;
  }, [monthlyData]);

  const selectedCommercialName = useMemo(() => {
    if (!filters.selectedCommercialCoNo) return "";
    return commercialOptions.find((c) => c.coNo === filters.selectedCommercialCoNo)?.name ?? "";
  }, [commercialOptions, filters.selectedCommercialCoNo]);

  const chartData = useMemo(() => {
    const years = Array.from(new Set(monthlyData.map((r) => r.year))).sort((a, b) => a - b);
    const byMonth = new Map<number, MonthlyAgg[]>();
    for (const row of monthlyData) {
      const arr = byMonth.get(row.month) ?? [];
      arr.push(row);
      byMonth.set(row.month, arr);
    }
    return Array.from({ length: 12 }, (_, idx) => {
      const month = idx + 1;
      const rows = byMonth.get(month) ?? [];
      const item: Record<string, number | string> = { month: String(month).padStart(2, "0") };
      for (const y of years) {
        item[`y${y}`] = rows.find((r) => r.year === y)?.quantity ?? 0;
      }
      return item;
    });
  }, [monthlyData]);

  const chartYears = useMemo(
    () => Array.from(new Set(monthlyData.map((r) => r.year))).sort((a, b) => a - b),
    [monthlyData],
  );

  const gridStroke = theme === "dark" ? "#334155" : "#e2e8f0";
  const axisColor = theme === "dark" ? "#94a3b8" : "#64748b";
  const tooltipStyle = {
    borderRadius: 8,
    border: theme === "dark" ? "1px solid #334155" : "1px solid #e2e8f0",
    backgroundColor: theme === "dark" ? "#1e293b" : "#fff",
    color: theme === "dark" ? "#e2e8f0" : "#0f172a",
    fontSize: 12,
  };

  const loading = loadingOptions || loadingStats;

  const handleExportPdf = async () => {
    if (!pdfRootRef.current || pdfExporting || loading || error) return;
    try {
      setPdfExporting(true);
      await waitForPdfDomStable();
      await exportElementToPdf(
        pdfRootRef.current,
        `statistiques-vente-${new Date().toISOString().slice(0, 10)}.pdf`,
      );
    } catch (e) {
      console.error(e);
    } finally {
      setPdfExporting(false);
    }
  };

  return (
    <div className="w-full">
      <section
        ref={pdfRootRef}
        className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-600 dark:bg-slate-900"
      >
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-4 dark:border-slate-600">
          <div>
            <h1 className="text-xl font-bold tracking-wide text-slate-900 uppercase dark:text-slate-100">
              1. STATISTIQUES DE VENTE
            </h1>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Statistiques mensuelles depuis Supabase (v_sales_monthly) avec filtres client, commercial, références et
              période.
            </p>
          </div>
          <div data-pdf-ignore className="flex justify-end">
            <button
              type="button"
              onClick={handleExportPdf}
              disabled={pdfExporting || loading || !!error || monthlyData.length === 0}
              className="inline-flex h-8 items-center gap-1 rounded border border-slate-300 bg-white px-3 text-xs text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              <Printer size={14} />
              {pdfExporting ? "PDF..." : "Exporter PDF"}
            </button>
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">Client</label>
            <select
              value={filters.selectedClientCtNum}
              onChange={(e) => setFilters((prev) => ({ ...prev, selectedClientCtNum: e.target.value }))}
              className="h-9 w-full rounded border border-slate-300 bg-white px-2 text-sm dark:border-slate-600 dark:bg-slate-950 dark:text-slate-200"
            >
              <option value="">Tous les clients</option>
              {clientOptions.map((c) => (
                <option key={c.ctNum} value={c.ctNum}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">Commercial</label>
            <select
              value={filters.selectedCommercialCoNo}
              onChange={(e) => setFilters((prev) => ({ ...prev, selectedCommercialCoNo: e.target.value }))}
              className="h-9 w-full rounded border border-slate-300 bg-white px-2 text-sm dark:border-slate-600 dark:bg-slate-950 dark:text-slate-200"
            >
              <option value="">Tous les commerciaux</option>
              {commercialOptions.map((c) => (
                <option key={c.coNo} value={c.coNo}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">Mois début</label>
            <input
              type="month"
              value={filters.monthFrom}
              onChange={(e) => setFilters((prev) => ({ ...prev, monthFrom: e.target.value }))}
              className="h-9 w-full rounded border border-slate-300 bg-white px-2 text-sm dark:border-slate-600 dark:bg-slate-950 dark:text-slate-200"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">Mois fin</label>
            <input
              type="month"
              value={filters.monthTo}
              onChange={(e) => setFilters((prev) => ({ ...prev, monthTo: e.target.value }))}
              className="h-9 w-full rounded border border-slate-300 bg-white px-2 text-sm dark:border-slate-600 dark:bg-slate-950 dark:text-slate-200"
            />
          </div>
        </div>

        <div className="mt-3">
          <p className="mb-1 text-xs font-semibold text-slate-600 dark:text-slate-300">
            Références produit (multi-sélection par code)
          </p>
          <div className="flex max-h-28 flex-wrap gap-2 overflow-auto rounded border border-slate-200 bg-slate-50 p-2 dark:border-slate-600 dark:bg-slate-800/60">
            <button
              type="button"
              onClick={() => setFilters((prev) => ({ ...prev, selectedProductCodes: [] }))}
              className={`rounded-full border px-3 py-1 text-xs ${filters.selectedProductCodes.length === 0
                  ? "border-[#5b8dbd] bg-[#e8f1fb] text-[#2f5f8f] dark:bg-sky-950/50 dark:text-sky-200"
                  : "border-slate-300 bg-white text-slate-600 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300"
                }`}
            >
              Toutes
            </button>
            {productOptions.map((p) => {
              const selected = filters.selectedProductCodes.includes(p.code);
              return (
                <button
                  key={p.code}
                  type="button"
                  onClick={() =>
                    setFilters((prev) => ({
                      ...prev,
                      selectedProductCodes: selected
                        ? prev.selectedProductCodes.filter((v) => v !== p.code)
                        : [...prev.selectedProductCodes, p.code],
                    }))
                  }
                  className={`rounded-full border px-3 py-1 text-xs ${selected
                      ? "border-[#5b8dbd] bg-[#e8f1fb] text-[#2f5f8f] dark:bg-sky-950/50 dark:text-sky-200"
                      : "border-slate-300 bg-white text-slate-600 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300"
                    }`}
                  title={p.label}
                >
                  {p.code}
                </button>
              );
            })}
          </div>
          <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            Commercial sélectionné: {selectedCommercialName || "Tous"} | Références:{" "}
            {filters.selectedProductCodes.length || "Toutes"}
          </p>
        </div>

        {loading ? (
          <div className="flex h-64 items-center justify-center gap-2 text-sm text-slate-600 dark:text-slate-300">
            <Loader2 className="size-4 animate-spin" />
            Chargement des statistiques...
          </div>
        ) : error ? (
          <div className="mt-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </div>
        ) : monthlyData.length === 0 ? (
          <div className="mt-4 rounded border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600 dark:border-slate-600 dark:bg-slate-800/50 dark:text-slate-300">
            Aucune ligne pour les filtres sélectionnés.
          </div>
        ) : (
          <>
            <div className="mt-4 overflow-hidden rounded-md border border-slate-200 dark:border-slate-600">
              <table className="w-full border-collapse text-xs">
                <thead className="bg-slate-100 text-[11px] font-semibold uppercase text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                  <tr>
                    <th className="border-b border-slate-200 px-2 py-2 text-left dark:border-slate-600">Année</th>
                    <th className="border-b border-slate-200 px-2 py-2 text-left dark:border-slate-600">Mois</th>
                    <th className="border-b border-slate-200 px-2 py-2 text-right dark:border-slate-600">
                      Quantité vendue
                    </th>
                    <th className="border-b border-slate-200 px-2 py-2 text-right dark:border-slate-600">Total HT</th>
                  </tr>
                </thead>
                <tbody>
                  {monthlyData.map((row, idx) => (
                    <tr
                      key={`${row.year}-${row.month}`}
                      className={idx % 2 === 0 ? "bg-white dark:bg-slate-900" : "bg-slate-50/70 dark:bg-slate-800/50"}
                    >
                      <td className="border-b border-slate-100 px-2 py-1.5 dark:border-slate-600 dark:text-slate-200">
                        {row.year}
                      </td>
                      <td className="border-b border-slate-100 px-2 py-1.5 dark:border-slate-600 dark:text-slate-200">
                        {String(row.month).padStart(2, "0")}
                      </td>
                      <td className="border-b border-slate-100 px-2 py-1.5 text-right dark:border-slate-600 dark:text-slate-200">
                        {formatNumber(row.quantity)}
                      </td>
                      <td className="border-b border-slate-100 px-2 py-1.5 text-right dark:border-slate-600 dark:text-slate-200">
                        {formatCurrencyTnd(row.totalHt)}
                      </td>
                    </tr>
                  ))}
                  {Array.from(yearTotals.entries()).map(([year, total]) => (
                    <tr key={`tot-${year}`} className="bg-[#dce9f7] font-semibold text-[#1f4f7a] dark:bg-sky-950/80 dark:text-sky-100">
                      <td className="border-y border-[#c7dbf1] px-2 py-1.5 dark:border-sky-800" colSpan={2}>
                        TOTAL {year}
                      </td>
                      <td className="border-y border-[#c7dbf1] px-2 py-1.5 text-right dark:border-sky-800">
                        {formatNumber(total.quantity)}
                      </td>
                      <td className="border-y border-[#c7dbf1] px-2 py-1.5 text-right dark:border-sky-800">
                        {formatCurrencyTnd(total.totalHt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-5 rounded-md border border-slate-200 bg-white p-3 dark:border-slate-600 dark:bg-slate-950">
              <h2 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
                Comparatif des ventes mensuelles (quantité)
              </h2>
              <div className="h-72 min-h-[288px] w-full min-w-0">
                <ChartSizeGate className="h-full w-full" fallbackClassName="h-72 min-h-[260px] w-full">
                  {({ width, height }) => (
                    <ResponsiveContainer width={width} height={height}>
                      <LineChart data={chartData} margin={{ top: 10, right: 16, left: 4, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                        <XAxis dataKey="month" tick={{ fontSize: 11, fill: axisColor }} stroke={axisColor} />
                        <YAxis tick={{ fontSize: 11, fill: axisColor }} stroke={axisColor} />
                        <Tooltip contentStyle={tooltipStyle} />
                        <Legend wrapperStyle={{ color: axisColor }} />
                        {chartYears.map((year, idx) => {
                          const colors = ["#3b82f6", "#f59e0b", "#22c55e", "#8b5cf6", "#ef4444", "#14b8a6"];
                          return (
                            <Line
                              key={year}
                              type="monotone"
                              dataKey={`y${year}`}
                              stroke={colors[idx % colors.length]}
                              strokeWidth={2}
                              dot={false}
                              name={String(year)}
                            />
                          );
                        })}
                      </LineChart>
                    </ResponsiveContainer>
                  )}
                </ChartSizeGate>
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
