"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight, Loader2, Minus, Printer, TrendingDown } from "lucide-react";
import { Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { createBrowserSupabaseClient } from "../lib/supabase/client";
import { exportElementToPdf } from "../lib/export-pdf";
import ChartSizeGate from "./ChartSizeGate";
import { useTheme } from "./ThemeProvider";

type ProductRecord = Record<string, unknown>;
type ResellerRow = {
  rank: number;
  reseller: string;
  monthly: number[];
  total2024: number;
  total2025: number;
  total2026: number;
  evolVs2025: number;
  evolVs2024: number;
};

const MONTHS = ["Jan", "Fev", "Mar", "Avr", "Mai", "Jun", "Jul", "Aou", "Sep", "Oct", "Nov", "Dec"];
const DONUT_COLORS = ["#4f86c6", "#6baed6", "#9ecae1", "#f5b14c", "#f08080", "#9aa5b1", "#5f9ea0", "#cfa3ff"];
const RESELLER_NAMES = [
  "Atlas Distribution",
  "Nova Retail",
  "Espace Commerce",
  "Medina Market",
  "Alfa Partners",
  "Sigma Pro",
  "Cap Sud Trading",
  "Riviera Vente",
  "Tunisie Grossiste",
  "Urban Supply",
];

function asNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(value);
}

function formatPct(value: number): string {
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function pctEvolution(current: number, previous: number): number {
  if (previous <= 0) return current > 0 ? 100 : 0;
  return ((current - previous) / previous) * 100;
}

function seededValue(seed: number, min: number, max: number): number {
  const x = Math.sin(seed) * 10000;
  const frac = x - Math.floor(x);
  return min + frac * (max - min);
}

async function fetchReportData() {
  const supabase = createBrowserSupabaseClient();
  const { data, error } = await supabase.from("products").select("*");
  if (error) throw error;

  const products = (data ?? []) as ProductRecord[];
  const articleOptions = Array.from(
    new Set(
      products
        .map((p) => asString(p.product_name ?? p.name ?? p.article ?? p.designation))
        .filter(Boolean),
    ),
  ).sort((a, b) => a.localeCompare(b));

  return { products, articleOptions };
}

function buildMockResellers(products: ProductRecord[], selectedArticle: string, selectedYear: number): ResellerRow[] {
  const scoped = selectedArticle
    ? products.filter((p) =>
      asString(p.product_name ?? p.name ?? p.article ?? p.designation).toLowerCase() ===
      selectedArticle.toLowerCase(),
    )
    : products;

  const baseValue =
    scoped.reduce((sum, p) => sum + asNumber(p.price_ht ?? p.price ?? 0) * Math.max(1, asNumber(p.stock ?? 1)), 0) ||
    20000;

  const resellerCount = 5 + (Math.round(baseValue) % 6); // 5-10

  const rows: ResellerRow[] = Array.from({ length: resellerCount }, (_, idx) => {
    const seedBase = baseValue + idx * 11 + selectedYear * 3;
    const monthly = MONTHS.map((_, monthIdx) => {
      const v = seededValue(seedBase + monthIdx * 7, 800, 9500);
      return Math.round(v);
    });

    const total2026 = monthly.reduce((a, b) => a + b, 0);
    const total2025 = Math.round(total2026 * seededValue(seedBase + 101, 0.78, 0.98));
    const total2024 = Math.round(total2025 * seededValue(seedBase + 207, 0.84, 0.99));

    return {
      rank: idx + 1,
      reseller: RESELLER_NAMES[idx] ?? `Revendeur ${idx + 1}`,
      monthly,
      total2024,
      total2025,
      total2026,
      evolVs2025: pctEvolution(total2026, total2025),
      evolVs2024: pctEvolution(total2026, total2024),
    };
  });

  return rows.sort((a, b) => b.total2026 - a.total2026).map((row, i) => ({ ...row, rank: i + 1 }));
}

export default function PalmaresRevendeurs() {
  const { theme } = useTheme();
  const pdfRootRef = useRef<HTMLDivElement>(null);
  const [pdfExporting, setPdfExporting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [products, setProducts] = useState<ProductRecord[]>([]);
  const [articleOptions, setArticleOptions] = useState<string[]>([]);
  const [article, setArticle] = useState("");
  const [year, setYear] = useState("2026");
  const [generatedAt, setGeneratedAt] = useState(new Date());

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        setError(null);
        const payload = await fetchReportData();
        setProducts(payload.products);
        setArticleOptions(payload.articleOptions);
        setGeneratedAt(new Date());
      } catch (e) {
        setError(e instanceof Error ? e.message : "Erreur de chargement");
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, []);

  const rows = useMemo(
    () => buildMockResellers(products, article, Number(year)),
    [products, article, year],
  );

  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, row) => ({
          y2024: acc.y2024 + row.total2024,
          y2025: acc.y2025 + row.total2025,
          y2026: acc.y2026 + row.total2026,
          monthly: acc.monthly.map((v, i) => v + row.monthly[i]),
        }),
        { y2024: 0, y2025: 0, y2026: 0, monthly: Array.from({ length: 12 }, () => 0) },
      ),
    [rows],
  );

  const donutData = useMemo(
    () => rows.slice(0, 6).map((row) => ({ name: row.reseller, value: row.total2026 })),
    [rows],
  );

  const handleExportPdf = async () => {
    if (!pdfRootRef.current || pdfExporting) return;
    try {
      setPdfExporting(true);
      await exportElementToPdf(
        pdfRootRef.current,
        `palmares-revendeurs-${new Date().toISOString().slice(0, 10)}.pdf`,
      );
    } catch (e) {
      console.error(e);
      window.alert("Export PDF impossible. Reessayez apres le chargement complet des graphiques.");
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
    <div className="min-h-screen bg-[#f7f9fc] p-4 text-slate-700 dark:bg-slate-950 dark:text-slate-200">
      <div
        ref={pdfRootRef}
        className="mx-auto max-w-[1500px] rounded-md border border-slate-200 bg-white shadow-sm dark:border-slate-600 dark:bg-slate-900"
      >
        <header className="border-b border-slate-200 px-5 py-4 dark:border-slate-600">
          <h1 className="text-2xl font-semibold tracking-wide text-slate-900 uppercase dark:text-slate-100">
            PALMARES REVENDEURS
          </h1>
        </header>

        <section className="flex flex-wrap items-end gap-3 border-b border-slate-200 bg-slate-50 px-5 py-3 dark:border-slate-600 dark:bg-slate-800/80">
          <div className="min-w-72">
            <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">Article</label>
            <select
              value={article}
              onChange={(e) => setArticle(e.target.value)}
              className="h-9 w-full rounded border border-slate-300 bg-white px-2 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"
            >
              <option value="">Tous les articles</option>
              {articleOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>
          <div className="min-w-44">
            <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">Year</label>
            <select
              value={year}
              onChange={(e) => setYear(e.target.value)}
              className="h-9 w-full rounded border border-slate-300 bg-white px-2 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"
            >
              <option value="2026">2026</option>
              <option value="2025">2025</option>
              <option value="2024">2024</option>
            </select>
          </div>
        </section>

        {loading ? (
          <div className="flex h-80 items-center justify-center gap-2 text-sm text-slate-600 dark:text-slate-300">
            <Loader2 className="size-4 animate-spin" /> Chargement du rapport...
          </div>
        ) : error ? (
          <div className="m-4 rounded border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </div>
        ) : (
          <>
            <div className="overflow-x-auto px-5 py-4">
              <table className="min-w-[1450px] w-full border-collapse text-[11px]">
                <thead className="bg-slate-100 text-[10px] font-bold uppercase tracking-wide text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                  <tr>
                    <th className="border border-slate-200 px-2 py-2 text-left dark:border-slate-600">Classement</th>
                    <th className="border border-slate-200 px-2 py-2 text-left dark:border-slate-600">Revendeur</th>
                    <th className="border border-slate-200 px-2 py-2 text-left dark:border-slate-600">
                      Monthly Detail (Jan-Dec)
                    </th>
                    <th className="border border-slate-200 px-2 py-2 text-right dark:border-slate-600">Total 2026</th>
                    <th className="border border-slate-200 px-2 py-2 text-right dark:border-slate-600">% Evol vs 2025</th>
                    <th className="border border-slate-200 px-2 py-2 text-right dark:border-slate-600">% Evol vs 2024</th>
                    <th className="border border-slate-200 px-2 py-2 text-center dark:border-slate-600">Tendance</th>
                    <th className="border border-slate-200 px-2 py-2 text-center dark:border-slate-600">Indicateur</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, idx) => {
                    const indicator =
                      row.evolVs2025 >= 6
                        ? { icon: ArrowUpRight, color: "text-emerald-600", label: "Hausse" }
                        : row.evolVs2025 >= 0
                          ? { icon: Minus, color: "text-orange-500", label: "Stable" }
                          : { icon: TrendingDown, color: "text-red-500", label: "Baisse" };

                    const Indicator = indicator.icon;

                    return (
                      <tr key={row.reseller} className={idx % 2 === 0 ? "bg-white dark:bg-slate-900" : "bg-slate-50 dark:bg-slate-800/40"}>
                        <td className="border border-slate-200 px-2 py-1.5 dark:border-slate-600">{row.rank}</td>
                        <td className="border border-slate-200 px-2 py-1.5 font-medium dark:border-slate-600">
                          {row.reseller}
                        </td>
                        <td className="border border-slate-200 px-2 py-1.5 text-[10px] dark:border-slate-600">
                          {row.monthly.map((m, mIdx) => `${MONTHS[mIdx]}:${formatCurrency(m)}`).join(" | ")}
                        </td>
                        <td className="border border-slate-200 px-2 py-1.5 text-right dark:border-slate-600">
                          {formatCurrency(row.total2026)}
                        </td>
                        <td className={`border border-slate-200 px-2 py-1.5 text-right dark:border-slate-600 ${row.evolVs2025 >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                          {formatPct(row.evolVs2025)}
                        </td>
                        <td className={`border border-slate-200 px-2 py-1.5 text-right dark:border-slate-600 ${row.evolVs2024 >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                          {formatPct(row.evolVs2024)}
                        </td>
                        <td className="border border-slate-200 px-2 py-1.5 dark:border-slate-600">
                          <div className="mx-auto block" style={{ width: 160, height: 36 }}>
                            <ResponsiveContainer width={160} height={36}>
                              <LineChart data={row.monthly.map((v, i) => ({ m: i, v }))}>
                                <Line
                                  type="monotone"
                                  dataKey="v"
                                  stroke={theme === "dark" ? "#7eb8e8" : "#5b8dbd"}
                                  strokeWidth={1.5}
                                  dot={false}
                                />
                              </LineChart>
                            </ResponsiveContainer>
                          </div>
                        </td>
                        <td className={`border border-slate-200 px-2 py-1.5 text-center dark:border-slate-600 ${indicator.color}`}>
                          <span className="inline-flex items-center gap-1">
                            <Indicator className="size-3.5" />
                            {indicator.label}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                  <tr className="bg-slate-100 font-semibold dark:bg-slate-800">
                    <td className="border border-slate-300 px-2 py-2 dark:border-slate-600" colSpan={2}>
                      TOTAL GLOBAL
                    </td>
                    <td className="border border-slate-300 px-2 py-2 text-[10px] dark:border-slate-600">
                      {totals.monthly.map((m, i) => `${MONTHS[i]}:${formatCurrency(m)}`).join(" | ")}
                    </td>
                    <td className="border border-slate-300 px-2 py-2 text-right dark:border-slate-600">
                      {formatCurrency(totals.y2026)}
                    </td>
                    <td className="border border-slate-300 px-2 py-2 text-right text-emerald-700 dark:border-slate-600 dark:text-emerald-400">
                      {formatPct(pctEvolution(totals.y2026, totals.y2025))}
                    </td>
                    <td className="border border-slate-300 px-2 py-2 text-right text-emerald-700 dark:border-slate-600 dark:text-emerald-400">
                      {formatPct(pctEvolution(totals.y2026, totals.y2024))}
                    </td>
                    <td className="border border-slate-300 px-2 py-2 dark:border-slate-600" />
                    <td className="border border-slate-300 px-2 py-2 dark:border-slate-600" />
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="grid gap-4 border-t border-slate-200 px-5 py-4 dark:border-slate-600 md:grid-cols-[1fr_360px]">
              <div />
              <div className="flex h-64 min-h-[256px] flex-col rounded border border-slate-200 bg-white p-3 dark:border-slate-600 dark:bg-slate-900">
                <p className="mb-1 shrink-0 text-xs font-semibold uppercase text-slate-600 dark:text-slate-300">
                  Part de marche top revendeurs
                </p>
                <ChartSizeGate className="min-h-0 flex-1 w-full" fallbackClassName="min-h-[180px] w-full">
                  {({ width, height }) => (
                    <ResponsiveContainer width={width} height={height}>
                      <PieChart>
                        <Pie data={donutData} dataKey="value" nameKey="name" innerRadius={52} outerRadius={82} label>
                          {donutData.map((d, i) => (
                            <Cell key={d.name} fill={DONUT_COLORS[i % DONUT_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip
                          formatter={(v) => formatCurrency(Number(v))}
                          contentStyle={tooltipStyle}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  )}
                </ChartSizeGate>
              </div>
            </div>
          </>
        )}

        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-slate-50 px-5 py-2 text-xs text-slate-600 dark:border-slate-600 dark:bg-slate-800/80 dark:text-slate-300">
          <span>Date de generation: {generatedAt.toLocaleString("fr-FR")}</span>
          <div className="flex flex-wrap items-center gap-2">
            <div data-pdf-ignore>
              <button
                type="button"
                onClick={handleExportPdf}
                disabled={pdfExporting || loading}
                className="inline-flex h-8 items-center gap-1 rounded border border-slate-300 bg-white px-3 text-xs text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
              >
                <Printer size={14} />
                {pdfExporting ? "PDF..." : "Exporter PDF"}
              </button>
            </div>
            <span>Confidentialite: Interne</span>
          </div>
        </footer>
      </div>
    </div>
  );
}
