"use client";

import dynamic from "next/dynamic";

const Game = dynamic(() => import("@/components/game/Game").then((mod) => mod.Game), {
  ssr: false,
  loading: () => (
    <div className="w-full h-screen bg-black" />
  ),
});

export default function Home() {
  return (
    <main className="w-full h-screen overflow-hidden">
      <Game />
    </main>
  );
}
