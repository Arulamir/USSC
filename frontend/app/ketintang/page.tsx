"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function KetintangPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/lidah-wetan?loc=ketintang");
  }, [router]);

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ textAlign: "center", color: "#64748b" }}>
        <p>Memuat Pemantauan Lingkungan Ketintang...</p>
      </div>
    </div>
  );
}
