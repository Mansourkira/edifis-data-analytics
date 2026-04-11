'use client';
import { AreaChart, Card, Title } from "@tremor/react";

const data = [
    { Month: "Jan", "Ventes 2025": 2890, "Ventes 2024": 2332 },
    { Month: "Feb", "Ventes 2025": 2756, "Ventes 2024": 2103 },
    // ...
];

export default function SalesChart() {
    return (
        <Card>
            <Title>Évolution des Ventes (TND)</Title>
            <AreaChart
                className="h-72 mt-4"
                data={data}
                index="Month"
                categories={["Ventes 2025", "Ventes 2024"]}
                colors={["blue", "slate"]}
            />
        </Card>
    );
}