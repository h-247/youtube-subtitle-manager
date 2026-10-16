"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function DashboardVideosPage() {
  const router = useRouter();
  useEffect(() => { router.replace("/dashboard"); }, [router]);
  return <div className="min-h-screen bg-[#212121]" />;
}
