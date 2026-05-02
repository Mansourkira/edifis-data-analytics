"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Download, Loader2, Printer, RefreshCw, Search } from "lucide-react";
import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import type { SupabaseClient } from "@supabase/supabase-js";
import { formatCurrencyTnd } from "../lib/format-currency";
import { parseSupabaseNumeric } from "../lib/parse-numeric";
import { createBrowserSupabaseClient } from "../lib/supabase/client";
import ChartSizeGate from "./ChartSizeGate";
import { exportElementToPdf, waitForPdfDomStable } from "../lib/export-pdf";
import { useTheme } from "./ThemeProvider";

type DashboardRow = {
  year: number;
  monthIndex: number;
  monthLabel: string;
  clientName: string;
  commercial: string;
  productCode: string;
  familyCode: string;
  familyLabel: string;
  brand: string;
  article: string;
  quantity: number;
  totalHt: number;
  city: string;
  region: string;
};

type DashboardPayload = {
  rows: DashboardRow[];
  timestamp: Date;
};

type Filters = {
  client: string;
  clientNameSearch: string;
  commercial: string;
  year: string;
  family: string;
  brand: string;
  articleRef: string;
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

/** Gouvernorats + ville principale (données dérivées / démo — à lier à la base si colonnes dispo) */
const TUNISIA_LOCATIONS: { city: string; region: string }[] = [
  { city: "Tunis", region: "Tunis" },
  { city: "Ariana", region: "Ariana" },
  { city: "Ben Arous", region: "Ben Arous" },
  { city: "Sfax", region: "Sfax" },
  { city: "Sousse", region: "Sousse" },
  { city: "Kairouan", region: "Kairouan" },
  { city: "Bizerte", region: "Bizerte" },
  { city: "Gabès", region: "Gabès" },
  { city: "Gafsa", region: "Gafsa" },
  { city: "Monastir", region: "Monastir" },
  { city: "Nabeul", region: "Nabeul" },
  { city: "Jendouba", region: "Jendouba" },
];

function cityRegionForLine(article: string, brand: string, monthIndex: number): { city: string; region: string } {
  const h = article.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  const b = brand.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  const i = Math.abs(h + b * 7 + monthIndex * 13) % TUNISIA_LOCATIONS.length;
  return TUNISIA_LOCATIONS[i]!;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function asDate(value: unknown): Date | null {
  if (typeof value !== "string" || !value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseDocYearMonth(docDate: string): { year: number; monthIndex: number } | null {
  const slice = docDate.slice(0, 10);
  const parts = slice.split("-").map(Number);
  if (parts.length < 2 || !parts[0] || parts[1] === undefined) return null;
  const year = parts[0];
  const month = parts[1];
  if (month < 1 || month > 12) return null;
  return { year, monthIndex: month - 1 };
}

async function fetchAllSageDocLignes(supabase: SupabaseClient): Promise<Record<string, unknown>[]> {
  const pageSize = 1000;
  let offset = 0;
  const all: Record<string, unknown>[] = [];
  for (; ;) {
    const { data, error } = await supabase
      .from("sage_doc_lignes")
      .select("doc_date, product_code, client_ct_num, commercial_co_no, quantity, total_ht")
      .order("doc_date", { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    const chunk = (data ?? []) as Record<string, unknown>[];
    all.push(...chunk);
    if (chunk.length < pageSize) break;
    offset += pageSize;
  }
  return all;
}

function formatIntegerFr(value: number): string {
  return new Intl.NumberFormat("fr-FR", {
    maximumFractionDigits: 0,
  }).format(value);
}

async function fetchDashboardData(): Promise<DashboardPayload> {
  const supabase = createBrowserSupabaseClient();

  const [lines, productsResult, familiesResult, clientsResult, commercialsResult] = await Promise.all([
    fetchAllSageDocLignes(supabase),
    supabase.from("products").select("*"),
    supabase.from("families").select("*"),
    supabase.from("clients").select("ct_num, name"),
    supabase.from("commercials").select("co_no, code, first_name"),
  ]);

  if (productsResult.error) throw productsResult.error;
  if (familiesResult.error) throw familiesResult.error;
  if (clientsResult.error) throw clientsResult.error;
  if (commercialsResult.error) throw commercialsResult.error;

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

  const productByCode = new Map<
    string,
    { familyCode: string; familyLabel: string; brand: string; article: string; unitPriceHt: number }
  >();
  for (const product of products) {
    const code = asString(product.code ?? product.product_code);
    if (!code) continue;
    const familyCode = asString(product.family_code ?? product.family ?? product.famille_code, "N/A");
    const familyLabel = familyByCode.get(familyCode) ?? familyCode;
    const brand = asString(product.brand ?? product.marque, "Sans marque");
    const article = asString(
      product.name ?? product.product_name ?? product.article ?? product.designation,
      code,
    );
    const unitPriceHt = parseSupabaseNumeric(
      product.price_ht ?? product.price ?? product.prix_ht ?? product.prix ?? product.unit_price_ht,
    );
    productByCode.set(code, { familyCode, familyLabel, brand, article, unitPriceHt });
  }

  const clientByCtNum = new Map<string, string>();
  for (const c of clientsResult.data ?? []) {
    const r = c as Record<string, unknown>;
    const ctNum = asString(r.ct_num);
    if (!ctNum) continue;
    clientByCtNum.set(ctNum, asString(r.name, ctNum));
  }

  const commercialByCoNo = new Map<number, string>();
  for (const cm of commercialsResult.data ?? []) {
    const r = cm as Record<string, unknown>;
    const coNo = r.co_no;
    const n = typeof coNo === "number" ? coNo : Number(coNo);
    if (!Number.isFinite(n)) continue;
    const code = asString(r.code);
    const firstName = asString(r.first_name);
    const label = [code, firstName].filter(Boolean).join(" ").trim();
    commercialByCoNo.set(n, label || String(n));
  }

  const rows: DashboardRow[] = [];
  let latestDocMs = 0;

  for (const line of lines) {
    const docRaw = asString(line.doc_date);
    const ym = docRaw ? parseDocYearMonth(docRaw) : null;
    if (!ym) continue;

    const t = asDate(docRaw)?.getTime() ?? 0;
    if (t > latestDocMs) latestDocMs = t;

    const productCode = asString(line.product_code);
    const enrich = productByCode.get(productCode);
    const familyCode = enrich?.familyCode ?? "N/A";
    const familyLabel = enrich?.familyLabel ?? "N/A";
    const brand = enrich?.brand ?? "Sans marque";
    const article = enrich?.article ?? (productCode || "Article");

    const quantity = Math.max(0, parseSupabaseNumeric(line.quantity));
    let totalHt = parseSupabaseNumeric(line.total_ht);
    if (totalHt === 0 && quantity > 0 && enrich && enrich.unitPriceHt > 0) {
      totalHt = quantity * enrich.unitPriceHt;
    }

    const clientCt = asString(line.client_ct_num);
    const clientName = clientCt ? (clientByCtNum.get(clientCt) ?? clientCt) : "Non renseigné";

    const coRaw = line.commercial_co_no;
    const coNo = typeof coRaw === "number" ? coRaw : coRaw != null ? Number(coRaw) : NaN;
    const commercial =
      Number.isFinite(coNo) ? (commercialByCoNo.get(coNo) ?? String(coNo)) : "Non renseigné";

    const { city, region } = cityRegionForLine(article, brand, ym.monthIndex);

    rows.push({
      year: ym.year,
      monthIndex: ym.monthIndex,
      monthLabel: MONTHS_FR[ym.monthIndex] ?? "N/A",
      clientName,
      commercial,
      productCode,
      familyCode,
      familyLabel,
      brand,
      article,
      quantity,
      totalHt,
      city,
      region,
    });
  }

  const productUpdatedMs = Math.max(
    0,
    ...products.map((p) => asDate(p.updated_at)?.getTime() ?? 0),
  );
  const lastUpdated =
    latestDocMs > 0
      ? new Date(Math.max(latestDocMs, productUpdatedMs))
      : productUpdatedMs > 0
        ? new Date(productUpdatedMs)
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
    clientNameSearch: "",
    commercial: "",
    year: "",
    family: "",
    brand: "",
    articleRef: "",
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
    const allClients = uniq(rows.map((r) => r.clientName));
    const q = filters.clientNameSearch.trim().toLowerCase();
    let clientsFiltered = q ? allClients.filter((name) => name.toLowerCase().includes(q)) : allClients;
    if (filters.client && !clientsFiltered.includes(filters.client)) {
      clientsFiltered = [filters.client, ...clientsFiltered];
    }
    return {
      clients: clientsFiltered,
      commercials: uniq(rows.map((r) => r.commercial)),
      years: uniq(rows.map((r) => String(r.year))),
      families: uniq(rows.map((r) => r.familyLabel)),
      brands: uniq(rows.map((r) => r.brand)),
    };
  }, [rows, filters.clientNameSearch, filters.client]);

  const filteredRows = useMemo(() => {
    const normalizedSearch = filters.search.trim().toLowerCase();
    const refQ = filters.articleRef.trim().toLowerCase();
    return rows.filter((row) => {
      if (filters.client && row.clientName !== filters.client) return false;
      if (filters.commercial && row.commercial !== filters.commercial) return false;
      if (filters.year && String(row.year) !== filters.year) return false;
      if (filters.family && row.familyLabel !== filters.family) return false;
      if (filters.brand && row.brand !== filters.brand) return false;
      if (refQ && !row.productCode.toLowerCase().includes(refQ)) return false;
      if (!normalizedSearch) return true;
      const haystack = [
        row.clientName,
        row.commercial,
        row.familyLabel,
        row.brand,
        row.article,
        row.productCode,
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(normalizedSearch);
    });
  }, [rows, filters]);

  const tableRows = useMemo(() => {
    const grouped = new Map<string, DashboardRow>();
    for (const row of filteredRows) {
      const key = `${row.year}|${row.monthIndex}|${row.familyLabel}|${row.brand}|${row.productCode}|${row.article}`;
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

  const rowsByMonthKey = useMemo(() => {
    const m = new Map<string, DashboardRow[]>();
    for (const r of tableRows) {
      const k = `${r.year}|${r.monthIndex}`;
      m.set(k, [...(m.get(k) ?? []), r]);
    }
    return m;
  }, [tableRows]);

  const monthSectionKeys = useMemo(() => {
    const set = new Set<string>();
    for (const r of tableRows) {
      set.add(`${r.year}|${r.monthIndex}`);
    }
    return Array.from(set).sort((a, b) => {
      const [ya, ma] = a.split("|").map(Number) as [number, number];
      const [yb, mb] = b.split("|").map(Number) as [number, number];
      if (ya !== yb) return yb - ya;
      return ma - mb;
    });
  }, [tableRows]);

  const regionRows = useMemo(() => {
    const m = new Map<string, { region: string; city: string; quantity: number; totalHt: number }>();
    for (const r of filteredRows) {
      const key = [r.region, r.city].join(":::");
      const cur = m.get(key);
      if (cur) {
        cur.quantity += r.quantity;
        cur.totalHt += r.totalHt;
      } else {
        m.set(key, {
          region: r.region,
          city: r.city,
          quantity: r.quantity,
          totalHt: r.totalHt,
        });
      }
    }
    return Array.from(m.values()).sort((a, b) => b.totalHt - a.totalHt);
  }, [filteredRows]);

  const handleExportPdf = async () => {
    if (!pdfRootRef.current || pdfExporting || loading || error) return;
    try {
      setPdfExporting(true);
      await waitForPdfDomStable();
      await exportElementToPdf(pdfRootRef.current, `tableau-commercial-${new Date().toISOString().slice(0, 10)}.pdf`);
    } catch (e) {
      console.error(e);
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
            <div className="min-w-48 flex-1">
              <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                Filtrer clients (nom)
              </label>
              <div className="flex items-center gap-2 rounded-md border border-slate-300 bg-white px-2 dark:border-slate-600 dark:bg-slate-900">
                <Search size={14} className="shrink-0 text-slate-500 dark:text-slate-400" />
                <input
                  value={filters.clientNameSearch}
                  onChange={(event) => setFilters((prev) => ({ ...prev, clientNameSearch: event.target.value }))}
                  placeholder="Tapez pour réduire la liste…"
                  className="h-8 w-full min-w-0 bg-transparent text-xs text-slate-700 outline-none dark:text-slate-200"
                />
              </div>
            </div>
            <FilterSelect
              label="Nom du Client"
              value={filters.client}
              options={options.clients}
              onChange={(value) => setFilters((prev) => ({ ...prev, client: value }))}
            />
            <FilterSelect label="Commercial" value={filters.commercial} options={options.commercials} onChange={(value) => setFilters((prev) => ({ ...prev, commercial: value }))} />
            <div className="min-w-44 flex-1">
              <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">Référence article</label>
              <div className="flex items-center gap-2 rounded-md border border-slate-300 bg-white px-2 dark:border-slate-600 dark:bg-slate-900">
                <Search size={14} className="shrink-0 text-slate-500 dark:text-slate-400" />
                <input
                  value={filters.articleRef}
                  onChange={(event) => setFilters((prev) => ({ ...prev, articleRef: event.target.value }))}
                  placeholder="Ex. TAG.116096"
                  className="h-8 w-full min-w-0 bg-transparent text-xs text-slate-700 outline-none dark:text-slate-200"
                />
              </div>
            </div>
            <div className="min-w-56 flex-1">
              <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">Recherche libre</label>
              <div className="flex items-center gap-2 rounded-md border border-slate-300 bg-white px-2 dark:border-slate-600 dark:bg-slate-900">
                <Search size={14} className="text-slate-500 dark:text-slate-400" />
                <input
                  value={filters.search}
                  onChange={(event) => setFilters((prev) => ({ ...prev, search: event.target.value }))}
                  placeholder="Marque, famille, article…"
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
                  {formatCurrencyTnd(item.value)}
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
          <section className="px-3 py-3">
            <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">
              Un tableau par mois calendaire (uniquement les mois ayant des lignes de vente dans Sage) — détail par famille, marque et article.
            </p>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <div className="space-y-4 lg:col-span-2">
                {monthSectionKeys.map((key) => {
                  const [ys, ms] = key.split("|");
                  const y = Number(ys);
                  const monthIndex = Number(ms);
                  const mRows = rowsByMonthKey.get(key) ?? [];
                  const st = mRows.reduce(
                    (a, r) => ({ q: a.q + r.quantity, ht: a.ht + r.totalHt }),
                    { q: 0, ht: 0 },
                  );
                  return (
                    <article
                      key={key}
                      className="overflow-hidden rounded-md border border-slate-200 bg-white dark:border-slate-600 dark:bg-slate-900"
                    >
                      <h2 className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold tracking-wide text-slate-800 uppercase dark:border-slate-600 dark:bg-slate-800/80 dark:text-slate-100">
                        {MONTHS_FR[monthIndex] ?? "—"} {y} — Détail familles & marques
                      </h2>
                      <div className="max-h-[380px] overflow-auto">
                        <table className="w-full min-w-[640px] border-collapse text-[11px]">
                          <thead className="sticky top-0 bg-slate-100 text-[10px] font-bold tracking-wide text-[#4e78a3] uppercase dark:bg-slate-800 dark:text-sky-400">
                            <tr>
                              <th className="border-b border-slate-200 px-2 py-1 text-left dark:border-slate-600">RÉF.</th>
                              <th className="border-b border-slate-200 px-2 py-1 text-left dark:border-slate-600">FAMILLE</th>
                              <th className="border-b border-slate-200 px-2 py-1 text-left dark:border-slate-600">MARQUE</th>
                              <th className="border-b border-slate-200 px-2 py-1 text-left dark:border-slate-600">ARTICLE</th>
                              <th className="border-b border-slate-200 px-2 py-1 text-left dark:border-slate-600">VILLE</th>
                              <th className="border-b border-slate-200 px-2 py-1 text-left dark:border-slate-600">RÉGION</th>
                              <th className="border-b border-slate-200 px-2 py-1 text-right dark:border-slate-600">QTE</th>
                              <th className="border-b border-slate-200 px-2 py-1 text-right dark:border-slate-600">TOTAL HT</th>
                            </tr>
                          </thead>
                          <tbody>
                            {mRows.map((row, index) => (
                              <tr
                                key={`${row.year}-${row.monthIndex}-${row.productCode}-${row.familyCode}-${row.brand}-${row.article}-${row.city}-${index}`}
                                className={index % 2 === 0 ? "bg-white dark:bg-slate-900" : "bg-slate-50 dark:bg-slate-800/40"}
                              >
                                <td className="max-w-[120px] truncate px-2 py-1 align-top font-mono text-[10px]" title={row.productCode}>
                                  {row.productCode}
                                </td>
                                <td className="px-2 py-1">{row.familyLabel}</td>
                                <td className="px-2 py-1">{row.brand}</td>
                                <td className="max-w-[200px] truncate px-2 py-1 align-top" title={row.article}>
                                  {row.article}
                                </td>
                                <td className="px-2 py-1">{row.city}</td>
                                <td className="px-2 py-1">{row.region}</td>
                                <td className="px-2 py-1 text-right tabular-nums">{formatIntegerFr(row.quantity)}</td>
                                <td className="px-2 py-1 text-right font-medium tabular-nums text-slate-900 dark:text-slate-100">
                                  {formatCurrencyTnd(row.totalHt)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                          <tfoot className="bg-amber-50/90 text-[11px] font-semibold dark:bg-amber-950/40">
                            <tr>
                              <td colSpan={6} className="border-t border-slate-200 px-2 py-1 dark:border-slate-600">
                                Sous-total {MONTHS_FR[monthIndex]} {y}
                              </td>
                              <td className="border-t border-slate-200 px-2 py-1 text-right tabular-nums dark:border-slate-600">
                                {formatIntegerFr(st.q)}
                              </td>
                              <td className="border-t border-slate-200 px-2 py-1 text-right tabular-nums text-[#1f4f7a] dark:border-slate-600 dark:text-sky-300">
                                {formatCurrencyTnd(st.ht)}
                              </td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    </article>
                  );
                })}

                <article className="overflow-hidden rounded-md border-2 border-[#5b8dbd]/30 bg-white dark:border-slate-600 dark:bg-slate-900">
                  <h2 className="border-b border-slate-200 bg-slate-100 px-3 py-2 text-xs font-bold tracking-wide text-slate-800 uppercase dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
                    Total général (filtre actif)
                  </h2>
                  <div className="overflow-x-auto p-2">
                    <table className="w-full border-collapse text-[11px]">
                      <tbody>
                        <tr className="bg-slate-50 font-bold dark:bg-slate-800">
                          <td className="px-2 py-2">Toutes périodes affichées</td>
                          <td className="px-2 py-2 text-right tabular-nums">{formatIntegerFr(totals.quantity)}</td>
                          <td className="px-2 py-2 text-right text-base tabular-nums text-[#1f4f7a] dark:text-sky-300">
                            {formatCurrencyTnd(totals.totalHt)}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </article>

                <article className="overflow-hidden rounded-md border border-slate-200 bg-white dark:border-slate-600 dark:bg-slate-900">
                  <h2 className="border-b border-slate-200 px-3 py-2 text-xs font-bold tracking-wide text-slate-700 uppercase dark:border-slate-600 dark:text-slate-200">
                    RAPPORT PAR VILLE / RÉGION (CA HT)
                  </h2>
                  <div className="max-h-[320px] overflow-auto">
                    <table className="w-full min-w-[480px] border-collapse text-[11px]">
                      <thead className="sticky top-0 bg-slate-100 text-[10px] font-bold uppercase text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                        <tr>
                          <th className="border-b border-slate-200 px-2 py-1 text-left dark:border-slate-600">Région</th>
                          <th className="border-b border-slate-200 px-2 py-1 text-left dark:border-slate-600">Ville</th>
                          <th className="border-b border-slate-200 px-2 py-1 text-right dark:border-slate-600">Qté</th>
                          <th className="border-b border-slate-200 px-2 py-1 text-right dark:border-slate-600">CA HT</th>
                        </tr>
                      </thead>
                      <tbody>
                        {regionRows.map((rr) => (
                          <tr
                            key={`${rr.region}-${rr.city}`}
                            className="border-b border-slate-100 dark:border-slate-700/80"
                          >
                            <td className="px-2 py-1.5">{rr.region}</td>
                            <td className="px-2 py-1.5">{rr.city}</td>
                            <td className="px-2 py-1.5 text-right tabular-nums">{formatIntegerFr(rr.quantity)}</td>
                            <td className="px-2 py-1.5 text-right font-medium tabular-nums">
                              {formatCurrencyTnd(rr.totalHt)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="border-t border-slate-200 px-3 py-2 text-[10px] text-slate-500 dark:border-slate-600 dark:text-slate-400">
                    Ville / région : répartition indicative (à remplacer par des champs `city` / `region` côté clients ou produits lorsqu’ils seront disponibles).
                  </p>
                </article>
              </div>

              <article className="h-fit rounded-md border border-slate-200 bg-white lg:sticky lg:top-2 dark:border-slate-600 dark:bg-slate-900">
                <h2 className="border-b border-slate-200 px-3 py-2 text-center text-xs font-bold tracking-wide text-slate-700 uppercase dark:border-slate-600 dark:text-slate-200">
                  RÉPARTITION CA HT PAR MARQUE
                </h2>
                <div className="h-[min(60vh,430px)] min-h-[280px] w-full min-w-0 px-2 py-3">
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
                              formatCurrencyTnd(Number(Array.isArray(value) ? value[0] : (value ?? 0)))
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
                              return `${String(value)} — ${formatCurrencyTnd(v)} (${pct}%)`;
                            }}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                    )}
                  </ChartSizeGate>
                </div>
              </article>
            </div>
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
              disabled={pdfExporting || loading || !!error}
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
