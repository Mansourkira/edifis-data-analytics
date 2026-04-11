import Image from "next/image";
import RevenueChart from "./components/RevenueChart";
export default function Home() {
  return (
    <div className="flex flex-col flex-1 items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <RevenueChart />
    </div>
  );
}
