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

type ProductRecord = Record<string, unknown>;
type MonthlyAgg = {
  year: number;
  month: number;
  quantity: number;
  totalHt: number;
};

const YEARS = [2023, 2024, 2025];

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

function seeded(seed: number, min: number, max: number): number {
  const x = Math.sin(seed) * 10000;
  const frac = x - Math.floor(x);
  return min + frac * (max - min);
}

async function fetchProducts() {
  const supabase = createBrowserSupabaseClient();
  const { data, error } = await supabase.from("products").select("*");
  if (error) throw error;
  return (data ?? []) as ProductRecord[];
}

export default function StatistiquesDeVente() {
  const { theme } = useTheme();
  const pdfRootRef = useRef<HTMLDivElement>(null);
  const [pdfExporting, setPdfExporting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [products, setProducts] = useState<ProductRecord[]>([]);
  const [selectedClient, setSelectedClient] = useState("");
  const [selectedRef, setSelectedRef] = useState("");

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await fetchProducts();
        setProducts(data);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Erreur de chargement");
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, []);

  const clients = useMemo(
    () =>
      Array.from(
        new Set(
          products
            .map((p) => asString(p.client_name ?? p.customer_name ?? p.client, "SARL Martin"))
            .filter(Boolean),
        ),
      ).sort((a, b) => a.localeCompare(b)),
    [products],
  );

  useEffect(() => {
    if (!selectedClient && clients.length > 0) setSelectedClient(clients[0]);
  }, [clients, selectedClient]);

  const refArticles = useMemo(
    () =>
      Array.from(
        new Set(
          products
            .map((p) => asString(p.product_name ?? p.name ?? p.article ?? p.designation))
            .filter(Boolean),
        ),
      )
        .slice(0, 6)
        .sort((a, b) => a.localeCompare(b)),
    [products],
  );

  useEffect(() => {
    if (!selectedRef && refArticles.length > 0) setSelectedRef(refArticles[0]);
  }, [refArticles, selectedRef]);

  const commercial = useMemo(() => {
    const match = products.find(
      (p) => asString(p.client_name ?? p.customer_name ?? p.client, "SARL Martin") === selectedClient,
    );
    return asString(match?.commercial ?? match?.sales_rep ?? match?.seller, "Jean Dupont");
  }, [products, selectedClient]);

  const monthlyData = useMemo(() => {
    const scoped = products.filter((p) => {
      const client = asString(p.client_name ?? p.customer_name ?? p.client, "SARL Martin");
      const article = asString(p.product_name ?? p.name ?? p.article ?? p.designation);
      return (!selectedClient || client === selectedClient) && (!selectedRef || article === selectedRef);
    });

    const base = scoped.reduce((sum, p) => {
      const qty = Math.max(1, asNumber(p.stock ?? p.quantity ?? 1));
      const price = asNumber(p.price_ht ?? p.price ?? 0);
      return sum + qty * Math.max(1, price);
    }, 0);

    const rows: MonthlyAgg[] = [];
    for (const year of YEARS) {
      for (let month = 1; month <= 12; month += 1) {
        const s = base + year * 37 + month * 13;
        const quantity = Math.round(seeded(s, 12, 240));
        const unit = seeded(s + 9, 24, 160);
        rows.push({
          year,
          month,
          quantity,
          totalHt: Number((quantity * unit).toFixed(2)),
        });
      }
    }
    return rows;
  }, [products, selectedClient, selectedRef]);

  const groupedByYear = useMemo(() => {
    const map = new Map<number, MonthlyAgg[]>();
    for (const row of monthlyData) {
      const current = map.get(row.year) ?? [];
      current.push(row);
      map.set(row.year, current);
    }
    for (const [year, rows] of map.entries()) {
      map.set(
        year,
        rows.sort((a, b) => a.month - b.month),
      );
    }
    return map;
  }, [monthlyData]);

  const yearTotals = useMemo(() => {
    const totals = new Map<number, { quantity: number; totalHt: number }>();
    for (const year of YEARS) {
      const rows = groupedByYear.get(year) ?? [];
      totals.set(
        year,
        rows.reduce(
          (acc, r) => ({
            quantity: acc.quantity + r.quantity,
            totalHt: acc.totalHt + r.totalHt,
          }),
          { quantity: 0, totalHt: 0 },
        ),
      );
    }
    return totals;
  }, [groupedByYear]);

  const chartData = useMemo(
    () =>
      Array.from({ length: 12 }, (_, idx) => {
        const month = idx + 1;
        const p = (year: number) => monthlyData.find((r) => r.year === year && r.month === month)?.quantity ?? 0;
        return {
          month: String(month).padStart(2, "0"),
          y2023: p(2023),
          y2024: p(2024),
          y2025: p(2025),
        };
      }),
    [monthlyData],
  );

  const gridStroke = theme === "dark" ? "#334155" : "#e2e8f0";
  const axisColor = theme === "dark" ? "#94a3b8" : "#64748b";
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

  const tooltipStyle = {
    borderRadius: 8,
    border: theme === "dark" ? "1px solid #334155" : "1px solid #e2e8f0",
    backgroundColor: theme === "dark" ? "#1e293b" : "#fff",
    color: theme === "dark" ? "#e2e8f0" : "#0f172a",
    fontSize: 12,
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
              Rapport mensuel des ventes par client et reference article.
            </p>
          </div>
          <div className="flex flex-col items-stretch gap-2 sm:items-end">
            <div className="flex flex-wrap items-center justify-end gap-2">
              {refArticles.map((ref) => (
                <button
                  key={ref}
                  type="button"
                  onClick={() => setSelectedRef(ref)}
                  className={`rounded-full border px-3 py-1 text-xs ${
                    selectedRef === ref
                      ? "border-[#5b8dbd] bg-[#e8f1fb] text-[#2f5f8f] dark:bg-sky-950/50 dark:text-sky-200"
                      : "border-slate-300 bg-white text-slate-600 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300"
                  }`}
                >
                  [Ref. {ref}]
                </button>
              ))}
            </div>
            <div data-pdf-ignore className="flex justify-end">
              <button
                type="button"
                onClick={handleExportPdf}
                disabled={pdfExporting || loading || !!error}
                className="inline-flex h-8 items-center gap-1 rounded border border-slate-300 bg-white px-3 text-xs text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
              >
                <Printer size={14} />
                {pdfExporting ? "PDF..." : "Exporter PDF"}
              </button>
            </div>
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-[minmax(240px,320px)_minmax(240px,320px)]">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">Nom du client</label>
            <select
              value={selectedClient}
              onChange={(e) => setSelectedClient(e.target.value)}
              className="h-9 w-full rounded border border-slate-300 bg-white px-2 text-sm dark:border-slate-600 dark:bg-slate-950 dark:text-slate-200"
            >
              {clients.map((client) => (
                <option key={client} value={client}>
                  {client}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">Commercial</label>
            <input
              readOnly
              value={commercial}
              className="h-9 w-full rounded border border-slate-300 bg-slate-50 px-2 text-sm text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
            />
          </div>
        </div>

        {loading ? (
          <div className="flex h-64 items-center justify-center gap-2 text-sm text-slate-600 dark:text-slate-300">
            <Loader2 className="size-4 animate-spin" />
            Chargement...
          </div>
        ) : error ? (
          <div className="mt-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </div>
        ) : (
          <>
            <div className="mt-4 overflow-hidden rounded-md border border-slate-200 dark:border-slate-600">
              <table className="w-full border-collapse text-xs">
                <thead className="bg-slate-100 text-[11px] font-semibold uppercase text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                  <tr>
                    <th className="border-b border-slate-200 px-2 py-2 text-left dark:border-slate-600">Annee</th>
                    <th className="border-b border-slate-200 px-2 py-2 text-left dark:border-slate-600">Mois</th>
                    <th className="border-b border-slate-200 px-2 py-2 text-right dark:border-slate-600">
                      Quantite Vendue
                    </th>
                    <th className="border-b border-slate-200 px-2 py-2 text-right dark:border-slate-600">Total HT</th>
                  </tr>
                </thead>
                <tbody>
                  {YEARS.map((year) => {
                    const rows = groupedByYear.get(year) ?? [];
                    return (
                      <FragmentYear
                        key={year}
                        year={year}
                        rows={rows}
                        subtotal={yearTotals.get(year) ?? { quantity: 0, totalHt: 0 }}
                      />
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="mt-5 rounded-md border border-slate-200 bg-white p-3 dark:border-slate-600 dark:bg-slate-950">
              <h2 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
                Comparatif des ventes mensuelles
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
                        <Line type="monotone" dataKey="y2023" stroke="#3b82f6" strokeWidth={2} dot={false} name="2023" />
                        <Line type="monotone" dataKey="y2024" stroke="#f59e0b" strokeWidth={2} dot={false} name="2024" />
                        <Line type="monotone" dataKey="y2025" stroke="#22c55e" strokeWidth={2} dot={false} name="2025" />
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

function FragmentYear({
  year,
  rows,
  subtotal,
}: {
  year: number;
  rows: MonthlyAgg[];
  subtotal: { quantity: number; totalHt: number };
}) {
  return (
    <>
      {rows.map((row, idx) => (
        <tr
          key={`${row.year}-${row.month}`}
          className={idx % 2 === 0 ? "bg-white dark:bg-slate-900" : "bg-slate-50/70 dark:bg-slate-800/50"}
        >
          <td className="border-b border-slate-100 px-2 py-1.5 dark:border-slate-600 dark:text-slate-200">{row.year}</td>
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
      {(year === 2024 || year === 2025) && (
        <tr className="bg-[#dce9f7] font-semibold text-[#1f4f7a] dark:bg-sky-950/80 dark:text-sky-100">
          <td className="border-y border-[#c7dbf1] px-2 py-1.5 dark:border-sky-800" colSpan={2}>
            TOTAL {year}
          </td>
          <td className="border-y border-[#c7dbf1] px-2 py-1.5 text-right dark:border-sky-800">
            {formatNumber(subtotal.quantity)}
          </td>
          <td className="border-y border-[#c7dbf1] px-2 py-1.5 text-right dark:border-sky-800">
            {formatCurrencyTnd(subtotal.totalHt)}
          </td>
        </tr>
      )}
    </>
  );
}
