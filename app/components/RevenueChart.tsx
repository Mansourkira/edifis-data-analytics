"use client";

import { useEffect, useState } from "react";
import {
    Area,
    AreaChart,
    CartesianGrid,
    Legend,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from "recharts";

const data = [
    { Month: "Jan", "Ventes 2025": 2890, "Ventes 2024": 2332 },
    { Month: "Feb", "Ventes 2025": 2756, "Ventes 2024": 2103 },
    // ...
];

export default function SalesChart() {
    const [mounted, setMounted] = useState(false);
    useEffect(() => {
        setMounted(true);
    }, []);

    return (
        <div className="w-full min-w-0 max-w-4xl rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
            <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                Évolution des Ventes (TND)
            </h3>
            <div className="mt-4 h-72 min-h-72 w-full min-w-0">
                {mounted ? (
                    <ResponsiveContainer width="100%" height="100%">
                        <AreaChart
                            data={data}
                            margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
                        >
                            <CartesianGrid
                                strokeDasharray="3 3"
                                className="stroke-zinc-200 dark:stroke-zinc-800"
                            />
                            <XAxis dataKey="Month" tick={{ fontSize: 12 }} stroke="#71717a" />
                            <YAxis tick={{ fontSize: 12 }} stroke="#71717a" />
                            <Tooltip
                                contentStyle={{
                                    borderRadius: "0.5rem",
                                    border: "1px solid rgb(228 228 231)",
                                }}
                            />
                            <Legend />
                            <Area
                                type="monotone"
                                dataKey="Ventes 2025"
                                stroke="#2563eb"
                                fill="#3b82f6"
                                fillOpacity={0.25}
                            />
                            <Area
                                type="monotone"
                                dataKey="Ventes 2024"
                                stroke="#475569"
                                fill="#64748b"
                                fillOpacity={0.25}
                            />
                        </AreaChart>
                    </ResponsiveContainer>
                ) : (
                    <div
                        className="h-full w-full rounded-lg bg-zinc-100 dark:bg-zinc-900"
                        aria-hidden
                    />
                )}
            </div>
        </div>
    );
}
