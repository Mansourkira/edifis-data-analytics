"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight, Loader2, Minus, Printer, Search, TrendingDown } from "lucide-react";
import { Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import type { SupabaseClient } from "@supabase/supabase-js";
import { formatCurrencyTnd } from "../lib/format-currency";
import { parseSupabaseNumeric } from "../lib/parse-numeric";
import { createBrowserSupabaseClient } from "../lib/supabase/client";
import { exportElementToPdf, waitForPdfDomStable } from "../lib/export-pdf";
import ChartSizeGate from "./ChartSizeGate";
import { useTheme } from "./ThemeProvider";

type ProductRecord = Record<string, unknown>;

type ResellerRow = {
  rank: number;
  clientCtNum: string;
  reseller: string;
  monthly: number[];
  totalSelected: number;
  totalPrev: number;
  totalPrev2: number;
  evolVsPrev: number;
  evolVsPrev2: number;
};

const MONTHS = ["Jan", "Fev", "Mar", "Avr", "Mai", "Jun", "Jul", "Aou", "Sep", "Oct", "Nov", "Dec"];
const DONUT_COLORS = ["#4f86c6", "#6baed6", "#9ecae1", "#f5b14c", "#f08080", "#9aa5b1", "#5f9ea0", "#cfa3ff"];

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function formatPct(value: number): string {
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function pctEvolution(current: number, previous: number): number {
  if (previous <= 0) return current > 0 ? 100 : 0;
  return ((current - previous) / previous) * 100;
}

type ArticleChoice = { code: string; label: string };

async function fetchCatalog() {
  const supabase = createBrowserSupabaseClient();
  const [productsRes, clientsRes] = await Promise.all([
    supabase.from("products").select("*"),
    supabase.from("clients").select("ct_num, name"),
  ]);
  if (productsRes.error) throw productsRes.error;
  if (clientsRes.error) throw clientsRes.error;

  const products = (productsRes.data ?? []) as ProductRecord[];
  const articleChoices: ArticleChoice[] = products
    .map((p) => {
      const code = asString(p.code ?? p.product_code);
      const name = asString(p.product_name ?? p.name ?? p.article ?? p.designation, code);
      return { code, label: code ? `${code} — ${name}` : name };
    })
    .filter((a) => a.code)
    .sort((a, b) => a.label.localeCompare(b.label));

  const clientByCt = new Map<string, string>();
  for (const c of clientsRes.data ?? []) {
    const r = c as Record<string, unknown>;
    const ct = asString(r.ct_num);
    if (!ct) continue;
    clientByCt.set(ct, asString(r.name, ct));
  }

  return { products, articleChoices, clientByCt };
}

async function fetchSageLines(supabase: SupabaseClient, productCode: string): Promise<Record<string, unknown>[]> {
  const pageSize = 1000;
  let offset = 0;
  const all: Record<string, unknown>[] = [];
  for (;;) {
    let q = supabase
      .from("sage_doc_lignes")
      .select("doc_date, product_code, client_ct_num, quantity, total_ht")
      .order("doc_date", { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (productCode) q = q.eq("product_code", productCode);
    const { data, error } = await q;
    if (error) throw error;
    const chunk = (data ?? []) as Record<string, unknown>[];
    all.push(...chunk);
    if (chunk.length < pageSize) break;
    offset += pageSize;
  }
  return all;
}

function buildProductPriceMap(products: ProductRecord[]): Map<string, { unitPriceHt: number }> {
  const m = new Map<string, { unitPriceHt: number }>();
  for (const product of products) {
    const code = asString(product.code ?? product.product_code);
    if (!code) continue;
    const unitPriceHt = parseSupabaseNumeric(
      product.price_ht ?? product.price ?? product.prix_ht ?? product.prix ?? product.unit_price_ht,
    );
    m.set(code, { unitPriceHt });
  }
  return m;
}

function buildResellerRows(
  lines: Record<string, unknown>[],
  clientByCt: Map<string, string>,
  productPrices: Map<string, { unitPriceHt: number }>,
  selectedYear: number,
  articleFilter: string,
): ResellerRow[] {
  type Acc = { name: string; byYear: Record<number, number[]> };
  const acc = new Map<string, Acc>();

  const ensureYear = (a: Acc, y: number) => {
    if (!a.byYear[y]) a.byYear[y] = Array.from({ length: 12 }, () => 0);
  };

  for (const line of lines) {
    const pcode = asString(line.product_code);
    if (articleFilter && pcode !== articleFilter) continue;

    const docRaw = asString(line.doc_date);
    const slice = docRaw.slice(0, 10);
    const parts = slice.split("-").map(Number);
    if (parts.length < 3 || !parts[0] || !parts[1] || parts[2] === undefined) continue;
    const y = parts[0];
    const mo = parts[1];
    if (mo < 1 || mo > 12) continue;

    const ct = asString(line.client_ct_num);
    const key = ct || "__none__";
    const name = ct ? (clientByCt.get(ct) ?? ct) : "Client non renseigné";

    let row = acc.get(key);
    if (!row) {
      row = { name, byYear: {} };
      acc.set(key, row);
    }
    ensureYear(row, y);

    const qty = Math.max(0, parseSupabaseNumeric(line.quantity));
    let ht = parseSupabaseNumeric(line.total_ht);
    if (ht === 0 && qty > 0) {
      const px = productPrices.get(pcode)?.unitPriceHt ?? 0;
      if (px > 0) ht = qty * px;
    }
    row.byYear[y][mo - 1] += ht;
  }

  const y = selectedYear;
  const y1 = y - 1;
  const y2 = y - 2;

  const sumYear = (data: Acc, year: number) =>
    (data.byYear[year] ?? Array.from({ length: 12 }, () => 0)).reduce((s, v) => s + v, 0);

  const rows: ResellerRow[] = [];
  for (const [ctKey, data] of acc) {
    const monthly = data.byYear[y] ? [...data.byYear[y]] : Array.from({ length: 12 }, () => 0);
    const totalSelected = sumYear(data, y);
    const totalPrev = sumYear(data, y1);
    const totalPrev2 = sumYear(data, y2);

    rows.push({
      rank: 0,
      clientCtNum: ctKey === "__none__" ? "" : ctKey,
      reseller: data.name,
      monthly,
      totalSelected,
      totalPrev,
      totalPrev2,
      evolVsPrev: pctEvolution(totalSelected, totalPrev),
      evolVsPrev2: pctEvolution(totalSelected, totalPrev2),
    });
  }

  rows.sort((a, b) => b.totalSelected - a.totalSelected);
  return rows.map((r, i) => ({ ...r, rank: i + 1 }));
}

export default function PalmaresRevendeurs() {
  const { theme } = useTheme();
  const pdfRootRef = useRef<HTMLDivElement>(null);
  const [pdfExporting, setPdfExporting] = useState(false);
  const [loadingCatalog, setLoadingCatalog] = useState(true);
  const [loadingLines, setLoadingLines] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [products, setProducts] = useState<ProductRecord[]>([]);
  const [clientByCt, setClientByCt] = useState<Map<string, string>>(new Map());
  const [lines, setLines] = useState<Record<string, unknown>[]>([]);
  const [articleChoices, setArticleChoices] = useState<ArticleChoice[]>([]);
  const [articleSearch, setArticleSearch] = useState("");
  const [articleCode, setArticleCode] = useState("");
  const [year, setYear] = useState("2026");
  const [generatedAt, setGeneratedAt] = useState(new Date());

  const yearNum = Number(year);
  const prevYearLabel = String(yearNum - 1);
  const prev2YearLabel = String(yearNum - 2);

  const visibleArticleChoices = useMemo(() => {
    const q = articleSearch.trim().toLowerCase();
    if (!q) return articleChoices;
    return articleChoices.filter(
      (a) => a.code.toLowerCase().includes(q) || a.label.toLowerCase().includes(q),
    );
  }, [articleChoices, articleSearch]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        setLoadingCatalog(true);
        setError(null);
        const payload = await fetchCatalog();
        if (cancelled) return;
        setProducts(payload.products);
        setArticleChoices(payload.articleChoices);
        setClientByCt(payload.clientByCt);
        setGeneratedAt(new Date());
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Erreur de chargement");
      } finally {
        if (!cancelled) setLoadingCatalog(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        setLoadingLines(true);
        setError(null);
        const supabase = createBrowserSupabaseClient();
        const data = await fetchSageLines(supabase, articleCode);
        if (cancelled) return;
        setLines(data);
        setGeneratedAt(new Date());
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Erreur de chargement des ventes");
      } finally {
        if (!cancelled) setLoadingLines(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [articleCode]);

  const productPrices = useMemo(() => buildProductPriceMap(products), [products]);

  const rows = useMemo(
    () => buildResellerRows(lines, clientByCt, productPrices, yearNum, articleCode),
    [lines, clientByCt, productPrices, yearNum, articleCode],
  );

  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, row) => ({
          totalSelected: acc.totalSelected + row.totalSelected,
          totalPrev: acc.totalPrev + row.totalPrev,
          totalPrev2: acc.totalPrev2 + row.totalPrev2,
          monthly: acc.monthly.map((v, i) => v + row.monthly[i]),
        }),
        {
          totalSelected: 0,
          totalPrev: 0,
          totalPrev2: 0,
          monthly: Array.from({ length: 12 }, () => 0),
        },
      ),
    [rows],
  );

  const donutData = useMemo(
    () => rows.slice(0, 6).map((row) => ({ name: row.reseller, value: row.totalSelected })),
    [rows],
  );

  const loading = loadingCatalog || loadingLines;

  const handleExportPdf = async () => {
    if (!pdfRootRef.current || pdfExporting || loading || error) return;
    try {
      setPdfExporting(true);
      await waitForPdfDomStable();
      await exportElementToPdf(
        pdfRootRef.current,
        `palmares-revendeurs-${new Date().toISOString().slice(0, 10)}.pdf`,
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
    <div className="min-h-screen bg-[#f7f9fc] p-4 text-slate-700 dark:bg-slate-950 dark:text-slate-200">
      <div
        ref={pdfRootRef}
        className="mx-auto max-w-[1500px] rounded-md border border-slate-200 bg-white shadow-sm dark:border-slate-600 dark:bg-slate-900"
      >
        <header className="border-b border-slate-200 px-5 py-4 dark:border-slate-600">
          <h1 className="text-2xl font-semibold tracking-wide text-slate-900 uppercase dark:text-slate-100">
            PALMARES REVENDEURS
          </h1>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Classement des clients par CA HT (lignes Sage). Données réelles — aucun nom factice.
          </p>
        </header>

        <section className="flex flex-wrap items-end gap-3 border-b border-slate-200 bg-slate-50 px-5 py-3 dark:border-slate-600 dark:bg-slate-800/80">
          <div className="min-w-72 flex-1">
            <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
              Rechercher référence ou libellé
            </label>
            <div className="flex items-center gap-2 rounded border border-slate-300 bg-white px-2 dark:border-slate-600 dark:bg-slate-900">
              <Search size={14} className="shrink-0 text-slate-500 dark:text-slate-400" />
              <input
                type="search"
                value={articleSearch}
                onChange={(e) => setArticleSearch(e.target.value)}
                placeholder="Réf. article ou nom…"
                className="h-9 w-full min-w-0 bg-transparent text-sm outline-none dark:text-slate-200"
              />
            </div>
          </div>
          <div className="min-w-72 flex-1">
            <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">Article</label>
            <select
              value={articleCode}
              onChange={(e) => setArticleCode(e.target.value)}
              className="h-9 w-full rounded border border-slate-300 bg-white px-2 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"
            >
              <option value="">Tous les articles</option>
              {articleCode && !visibleArticleChoices.some((a) => a.code === articleCode) ? (
                <option value={articleCode}>{articleChoices.find((a) => a.code === articleCode)?.label ?? articleCode}</option>
              ) : null}
              {visibleArticleChoices.map((a) => (
                <option key={a.code} value={a.code}>
                  {a.label}
                </option>
              ))}
            </select>
            {articleSearch.trim() && visibleArticleChoices.length === 0 ? (
              <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-400">Aucun article ne correspond.</p>
            ) : null}
          </div>
          <div className="min-w-44">
            <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">Année</label>
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
        ) : rows.length === 0 ? (
          <div className="m-4 rounded border border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-600 dark:border-slate-600 dark:bg-slate-800/50 dark:text-slate-300">
            Aucune ligne de vente pour ces filtres (Sage).
          </div>
        ) : (
          <>
            <div className="overflow-x-auto px-5 py-4">
              <table className="min-w-[1200px] w-full border-collapse text-[10px]">
                <thead className="bg-slate-100 text-[9px] font-bold uppercase tracking-wide text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                  <tr>
                    <th
                      className="sticky left-0 z-10 min-w-[36px] border border-slate-200 bg-slate-100 px-1 py-2 text-left dark:border-slate-600 dark:bg-slate-800"
                      rowSpan={2}
                    >
                      N°
                    </th>
                    <th
                      className="sticky left-[2.2rem] z-10 min-w-[120px] max-w-[160px] border border-slate-200 bg-slate-100 px-1 py-2 text-left dark:border-slate-600 dark:bg-slate-800"
                      rowSpan={2}
                    >
                      Client (revendeur)
                    </th>
                    <th
                      className="border border-slate-200 px-0 py-1 text-center text-[8px] dark:border-slate-600"
                      colSpan={12}
                    >
                      Détail mensuel (CA HT) — {year}
                    </th>
                    <th className="border border-slate-200 px-1 py-2 text-right dark:border-slate-600" rowSpan={2}>
                      Total {year}
                    </th>
                    <th className="border border-slate-200 px-1 py-2 text-right dark:border-slate-600" rowSpan={2}>
                      % {prevYearLabel}
                    </th>
                    <th className="border border-slate-200 px-1 py-2 text-right dark:border-slate-600" rowSpan={2}>
                      % {prev2YearLabel}
                    </th>
                    <th className="border border-slate-200 px-0 py-2 text-center dark:border-slate-600" rowSpan={2}>
                      Courbe
                    </th>
                    <th className="border border-slate-200 px-0 py-2 text-center dark:border-slate-600" rowSpan={2}>
                      Indic.
                    </th>
                  </tr>
                  <tr>
                    {MONTHS.map((m) => (
                      <th
                        key={m}
                        className="min-w-[56px] border border-slate-200 px-0.5 py-1 text-right font-bold normal-case text-slate-600 dark:border-slate-600 dark:text-slate-300"
                        title={m}
                      >
                        {m}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, idx) => {
                    const indicator =
                      row.evolVsPrev >= 6
                        ? { icon: ArrowUpRight, color: "text-emerald-600", label: "Hausse" }
                        : row.evolVsPrev >= 0
                          ? { icon: Minus, color: "text-orange-500", label: "Stable" }
                          : { icon: TrendingDown, color: "text-red-500", label: "Baisse" };

                    const Indicator = indicator.icon;

                    return (
                      <tr
                        key={`${row.clientCtNum || "none"}-${row.rank}`}
                        className={idx % 2 === 0 ? "bg-white dark:bg-slate-900" : "bg-slate-50 dark:bg-slate-800/40"}
                      >
                        <td className="sticky left-0 z-[1] border border-slate-200 bg-inherit px-1 py-1.5 text-center dark:border-slate-600">
                          {row.rank}
                        </td>
                        <td
                          className="sticky left-[2.2rem] z-[1] max-w-[160px] border border-slate-200 bg-inherit py-1.5 pl-1 pr-2 text-[10px] font-medium leading-tight dark:border-slate-600"
                          title={row.clientCtNum ? `${row.reseller} (${row.clientCtNum})` : row.reseller}
                        >
                          {row.reseller}
                          {row.clientCtNum ? (
                            <span className="mt-0.5 block font-normal text-[9px] text-slate-500 dark:text-slate-400">
                              {row.clientCtNum}
                            </span>
                          ) : null}
                        </td>
                        {row.monthly.map((m, mIdx) => (
                          <td
                            key={mIdx}
                            className="whitespace-nowrap border border-slate-200 py-1.5 pr-1 text-right tabular-nums text-[9px] text-slate-800 dark:border-slate-600 dark:text-slate-200"
                          >
                            {formatCurrencyTnd(m, 0)}
                          </td>
                        ))}
                        <td className="border border-slate-200 px-1 py-1.5 text-right tabular-nums dark:border-slate-600">
                          {formatCurrencyTnd(row.totalSelected, 0)}
                        </td>
                        <td className={`border border-slate-200 px-2 py-1.5 text-right dark:border-slate-600 ${row.evolVsPrev >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                          {formatPct(row.evolVsPrev)}
                        </td>
                        <td className={`border border-slate-200 px-2 py-1.5 text-right dark:border-slate-600 ${row.evolVsPrev2 >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                          {formatPct(row.evolVsPrev2)}
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
                    <td
                      className="sticky left-0 z-[1] border border-slate-300 bg-slate-100 px-1 py-2 text-center dark:border-slate-600 dark:bg-slate-800"
                      colSpan={2}
                    >
                      TOTAL GLOBAL
                    </td>
                    {totals.monthly.map((m, i) => (
                      <td
                        key={MONTHS[i]}
                        className="border border-slate-300 py-2 pr-1 text-right text-[9px] tabular-nums dark:border-slate-600"
                      >
                        {formatCurrencyTnd(m, 0)}
                      </td>
                    ))}
                    <td className="border border-slate-300 px-2 py-2 text-right dark:border-slate-600">
                      {formatCurrencyTnd(totals.totalSelected, 0)}
                    </td>
                    <td className="border border-slate-300 px-2 py-2 text-right text-emerald-700 dark:border-slate-600 dark:text-emerald-400">
                      {formatPct(pctEvolution(totals.totalSelected, totals.totalPrev))}
                    </td>
                    <td className="border border-slate-300 px-2 py-2 text-right text-emerald-700 dark:border-slate-600 dark:text-emerald-400">
                      {formatPct(pctEvolution(totals.totalSelected, totals.totalPrev2))}
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
                  Part de marché top clients ({year})
                </p>
                <ChartSizeGate className="min-h-0 flex-1 w-full" fallbackClassName="min-h-[180px] w-full">
                  {({ width, height }) => (
                    <ResponsiveContainer width={width} height={height}>
                      <PieChart>
                        <Pie data={donutData} dataKey="value" nameKey="name" innerRadius={52} outerRadius={82} label>
                          {donutData.map((d, i) => (
                            <Cell key={`${d.name}-${i}`} fill={DONUT_COLORS[i % DONUT_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip
                          formatter={(v) => formatCurrencyTnd(Number(v), 0)}
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
                disabled={pdfExporting || loading || !!error || rows.length === 0}
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
