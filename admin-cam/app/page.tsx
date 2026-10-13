
"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";

interface Camera {
  id: number;
  public_code: string;
  public_name: string | null;
  source_type: "DSS" | "TAILSCALE";
  source_id: number;
  status: string | null;
  enabled: number;
  latitude: number | string | null;
  longitude: number | string | null;
}

interface StreamInfo {
  type: string;
  path: string;
  rtsp: string;
  webrtc: string;
}

interface StartStreamResponse {
  success: boolean;
  camera: Camera;
  stream: StreamInfo;
  error?: string;
}

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

const API_URL = "/api/cctv";

const inputStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  boxSizing: "border-box",
  padding: "12px",
  marginTop: "6px",
  border: "1px solid #cbd5e1",
  borderRadius: "8px",
  background: "#ffffff",
  color: "#1e293b",
  fontSize: "14px",
};

const panelStyle: React.CSSProperties = {
  background: "#ffffff",
  padding: "22px",
  borderRadius: "14px",
  border: "1px solid #e2e8f0",
  boxShadow: "0 2px 8px rgba(15, 23, 42, 0.04)",
};

export default function CamerasPage() {
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [selectedCamera, setSelectedCamera] =
    useState<Camera | null>(null);

  const [loading, setLoading] = useState(true);
  const [streamLoading, setStreamLoading] = useState(false);
  const [streamInfo, setStreamInfo] =
    useState<StreamInfo | null>(null);

  const [editName, setEditName] = useState("");
  const [editLatitude, setEditLatitude] = useState("");
  const [editLongitude, setEditLongitude] = useState("");

  const [savingCamera, setSavingCamera] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const [saveError, setSaveError] = useState("");
  const [error, setError] = useState("");

  const videoRef = useRef<HTMLVideoElement>(null);
  const peerConnectionRef =useRef<RTCPeerConnection | null>(null);
  const webRTCSessionRef = useRef(0);
  const router = useRouter();

  const [authChecking, setAuthChecking] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);

  function getCameraDisplayName(camera: Camera): string {
    return camera.public_name?.trim() || camera.public_code;
  }

  useEffect(() => {
    
    let cancelled = false;

    async function checkSession() {
      try {
        const response = await fetch("/api/cctv/auth/me", {
          credentials: "same-origin",
          cache: "no-store",
        });

        if (cancelled) return;

        if (!response.ok) {
          router.replace("/login");
          return;
        }

        const result = await response.json();

        if (!result.success || !result.user) {
          router.replace("/login");
          return;
        }

        setAuthenticated(true);
      } catch {
        if (!cancelled) {
          router.replace("/login");
        }
      } finally {
        if (!cancelled) {
          setAuthChecking(false);
        }
      }
    }

    void checkSession();

    return () => {
      cancelled = true;
    };
  }, [router]);

  function cleanupWebRTC() {
    console.log("[WEBRTC] Cleanup");

    webRTCSessionRef.current += 1;

    const pc = peerConnectionRef.current;

    if (pc) {
      pc.ontrack = null;
      pc.onconnectionstatechange = null;
      pc.oniceconnectionstatechange = null;
      pc.onicecandidate = null;
      pc.onicecandidateerror = null;

      if (pc.connectionState !== "closed") {
        pc.close();
      }

      peerConnectionRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }

  // ========================================================
  // LOAD CAMERA LIST
  // ========================================================

  useEffect(() => {
    if (!authenticated) return;
    let cancelled = false;

    async function loadCameras() {
      try {
        setLoading(true);
        setError("");

        const response = await fetch(
          `${API_URL}/admin/cameras`
        );

        const result: ApiResponse<Camera[]> =
          await response.json();

        if (!response.ok || !result.success) {
          throw new Error(
            result.error || `HTTP ${response.status}`
          );
        }

        const cameraList = result.data ?? [];

        if (cancelled) return;

        setCameras(cameraList);

        setSelectedCamera((current) => {
          if (!cameraList.length) return null;

          if (current) {
            const existing = cameraList.find(
              (camera) =>
                camera.public_code === current.public_code
            );

            if (existing) return existing;
          }

          return cameraList[0];
        });

        console.log("[CAMERAS COUNT]", cameraList.length);
      } catch (err) {
        if (cancelled) return;

        console.error("[LOAD CAMERAS ERROR]", err);
        setError(
          err instanceof Error
            ? err.message
            : "Tidak dapat mengambil data kamera."
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadCameras();

    return () => {
      cancelled = true;
    };
  }, [authenticated]);

  // ========================================================
  // POPULATE EDIT FORM
  // Terpisah dari effect startCamera.
  // ========================================================

  useEffect(() => {
    if (!selectedCamera) {
      setEditName("");
      setEditLatitude("");
      setEditLongitude("");
      setSaveMessage("");
      setSaveError("");
      return;
    }

    setEditName(selectedCamera.public_name ?? "");

    setEditLatitude(
      selectedCamera.latitude == null
        ? ""
        : String(selectedCamera.latitude)
    );

    setEditLongitude(
      selectedCamera.longitude == null
        ? ""
        : String(selectedCamera.longitude)
    );

    setSaveMessage("");
    setSaveError("");
  }, [selectedCamera]);

  // ========================================================
  // START CAMERA
  // Bergantung pada kode kamera, bukan object kamera,
  // agar menyimpan nama/koordinat tidak memulai ulang stream.
  // ========================================================

  useEffect(() => {
    if (!selectedCamera) {
      setStreamInfo(null);
      setStreamLoading(false);
      cleanupWebRTC();
      return;
    }

    let cancelled = false;
    const publicCode = selectedCamera.public_code;

    async function startCamera() {
      try {
        setStreamLoading(true);
        setError("");
        setStreamInfo(null);

        console.log("[CAMERA] Starting:", publicCode);

        const response = await fetch(
          `${API_URL}/admin/cameras/` +
            `${encodeURIComponent(publicCode)}/start`,
          { method: "POST" }
        );

        const result: StartStreamResponse =
          await response.json();

        if (!response.ok || !result.success) {
          throw new Error(
            result.error || `HTTP ${response.status}`
          );
        }

        if (cancelled) return;

        setStreamInfo(result.stream);
      } catch (err) {
        if (cancelled) return;

        console.error("[START CAMERA ERROR]", err);

        setError(
          err instanceof Error
            ? err.message
            : "Kamera gagal dijalankan."
        );
      } finally {
        if (!cancelled) setStreamLoading(false);
      }
    }

    startCamera();

    return () => {
      cancelled = true;
    };
  }, [selectedCamera?.public_code]);

  // ========================================================
  // WEBRTC / WHEP
  // ========================================================

  useEffect(() => {
    if (!streamInfo) return;

    const video = videoRef.current;
    if (!video) return;

    let cancelled = false;
    let localPc: RTCPeerConnection | null = null;

    const sessionId = ++webRTCSessionRef.current;

    async function startWebRTC() {
      try {
        console.log("[WEBRTC] Starting:", sessionId);
        console.log("[WEBRTC] Path:", streamInfo!.path);

        const pc = new RTCPeerConnection({
          iceServers: [],
        });

        localPc = pc;
        peerConnectionRef.current = pc;

        pc.onicecandidate = (event) => {
          if (event.candidate) {
            console.log(
              "[WEBRTC] ICE candidate:",
              event.candidate.candidate
            );
          } else {
            console.log("[WEBRTC] ICE gathering complete");
          }
        };

        pc.onicecandidateerror = (event) => {
          console.error("[WEBRTC] ICE candidate error:", event);
        };

        pc.oniceconnectionstatechange = () => {
          if (
            cancelled ||
            sessionId !== webRTCSessionRef.current
          ) return;

          console.log("[WEBRTC] ICE:", pc.iceConnectionState);
        };

        pc.onconnectionstatechange = () => {
          if (
            cancelled ||
            sessionId !== webRTCSessionRef.current
          ) return;

          console.log(
            "[WEBRTC] Connection:",
            pc.connectionState
          );

          if (pc.connectionState === "failed") {
            setError("Koneksi WebRTC gagal.");
          }
        };

        pc.addTransceiver("video", {
          direction: "recvonly",
        });

        pc.addTransceiver("audio", {
          direction: "recvonly",
        });

        
      pc.ontrack = (event) => {
        if (
          cancelled ||
          sessionId !== webRTCSessionRef.current
        ) {
          return;
        }

        // Pastikan elemen video masih tersedia
        const currentVideo = videoRef.current;

        if (!currentVideo) {
          console.warn("[WEBRTC] Elemen video tidak tersedia");
          return;
        }

        const remoteStream = event.streams[0];

        if (!remoteStream) {
          console.warn("[WEBRTC] No remote stream");
          return;
        }

        if (currentVideo.srcObject !== remoteStream) {
          currentVideo.srcObject = remoteStream;
        }

        currentVideo.play().catch((err: unknown) => {
          if (
            err instanceof DOMException &&
            err.name === "AbortError"
          ) {
            return;
          }

          console.warn("[VIDEO PLAY ERROR]", err);
        });
      };



        const offer = await pc.createOffer();

        if (
          cancelled ||
          sessionId !== webRTCSessionRef.current
        ) {
          pc.close();
          return;
        }

        await pc.setLocalDescription(offer);
        await waitForIceGatheringComplete(pc);

        if (
          cancelled ||
          sessionId !== webRTCSessionRef.current
        ) return;

        const localDescription = pc.localDescription;

        if (!localDescription?.sdp) {
          throw new Error("WebRTC SDP tidak tersedia.");
        }

        const response = await fetch(
          `/api/cctv/whep/${encodeURIComponent(
            streamInfo!.path
          )}`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/sdp",
            },
            body: localDescription.sdp,
          }
        );

        if (!response.ok) {
          const responseText = await response.text();

          throw new Error(
            `WHEP HTTP ${response.status}: ${responseText}`
          );
        }

        const answer = await response.text();

        if (
          cancelled ||
          sessionId !== webRTCSessionRef.current
        ) return;

        await pc.setRemoteDescription({
          type: "answer",
          sdp: answer,
        });

        console.log("[WEBRTC] Remote description set");
      } catch (err) {
        if (
          cancelled ||
          sessionId !== webRTCSessionRef.current
        ) return;

        console.error("[WEBRTC ERROR]", err);

        setError(
          err instanceof Error
            ? err.message
            : "WebRTC gagal."
        );
      }
    }

    startWebRTC();

    return () => {
      cancelled = true;

      if (
        localPc &&
        peerConnectionRef.current === localPc
      ) {
        cleanupWebRTC();
      }
    };
  }, [streamInfo]);

  // ========================================================
  // ICE GATHERING
  // ========================================================

  function waitForIceGatheringComplete(
    pc: RTCPeerConnection
  ): Promise<void> {
    return new Promise((resolve) => {
      if (pc.iceGatheringState === "complete") {
        resolve();
        return;
      }

      const timeout = setTimeout(() => {
        console.warn("[WEBRTC] ICE gathering timeout");

        pc.removeEventListener(
          "icegatheringstatechange",
          checkState
        );

        resolve();
      }, 5000);

      function checkState() {
        if (pc.iceGatheringState === "complete") {
          clearTimeout(timeout);

          pc.removeEventListener(
            "icegatheringstatechange",
            checkState
          );

          resolve();
        }
      }

      pc.addEventListener(
        "icegatheringstatechange",
        checkState
      );
    });
  }

  // ========================================================
  // SAVE CAMERA DETAILS
  // ========================================================

  async function saveCamera(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    if (!selectedCamera || savingCamera) return;

    const name = editName.trim();

    if (name.length > 100) {
      setSaveError("Nama kamera maksimal 100 karakter.");
      return;
    }

    const latitudeText = editLatitude.trim();
    const longitudeText = editLongitude.trim();

    const latitude =
      latitudeText === "" ? null : Number(latitudeText);

    const longitude =
      longitudeText === "" ? null : Number(longitudeText);

    if (
      latitude !== null &&
      (!Number.isFinite(latitude) ||
        latitude < -90 ||
        latitude > 90)
    ) {
      setSaveError("Latitude harus berada di antara -90 dan 90.");
      return;
    }

    if (
      longitude !== null &&
      (!Number.isFinite(longitude) ||
        longitude < -180 ||
        longitude > 180)
    ) {
      setSaveError(
        "Longitude harus berada di antara -180 dan 180."
      );
      return;
    }

    setSavingCamera(true);
    setSaveMessage("");
    setSaveError("");

    try {
      const response = await fetch(
        `${API_URL}/admin/cameras/${encodeURIComponent(
          selectedCamera.public_code
        )}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            public_name: name || null,
            latitude,
            longitude,
          }),
        }
      );

      const result: ApiResponse<Camera> =
        await response.json();

      if (!response.ok || !result.success || !result.data) {
        throw new Error(
          result.error || `HTTP ${response.status}`
        );
      }

      const updatedCamera = result.data;

      setCameras((previous) =>
        previous.map((camera) =>
          camera.public_code === updatedCamera.public_code
            ? { ...camera, ...updatedCamera }
            : camera
        )
      );

      setSelectedCamera((previous) =>
        previous?.public_code === updatedCamera.public_code
          ? { ...previous, ...updatedCamera }
          : previous
      );

      setSaveMessage("Data kamera berhasil disimpan.");
    } catch (err) {
      console.error("[SAVE CAMERA ERROR]", err);

      setSaveError(
        err instanceof Error
          ? err.message
          : "Gagal menyimpan data kamera."
      );
    } finally {
      setSavingCamera(false);
    }
  }

  // ========================================================
  // DASHBOARD SUMMARY
  // ========================================================

  const onlineCount = cameras.filter(
    (camera) =>
      (camera.status ?? "").toUpperCase() === "ONLINE"
  ).length;

  const offlineCount = cameras.length - onlineCount;

  // ========================================================
  // UI
  // ========================================================
  if (authChecking || !authenticated) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-100">
        <p className="text-sm text-slate-600">
          Memeriksa sesi login...
        </p>
      </main>
    );
  }
  
  return (
    <main
      style={{
        padding: "clamp(16px, 3vw, 32px)",
        background: "#f5f7fb",
        minHeight: "100vh",
        color: "#0f172a",
      }}
    >
      <header
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "16px",
          marginBottom: "24px",
        }}
      >
        <div>
          <p
            style={{
              color: "#2563eb",
              fontWeight: 700,
              fontSize: "12px",
              letterSpacing: "1.5px",
              marginBottom: "6px",
            }}
          >
            USSC SMART MONITORING
          </p>

          <h1 style={{ fontSize: "28px", fontWeight: 800 }}>
            CCTV Monitoring
          </h1>

          <p style={{ color: "#64748b", marginTop: "5px" }}>
            Pemantauan kamera dan informasi lokasi.
          </p>
        </div>

        <div style={{ color: "#64748b", fontSize: "13px" }}>
          {loading ? "Memuat kamera..." : `${cameras.length} kamera terdaftar`}
        </div>
      </header>

      {/* SUMMARY CARDS */}

      <section
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          gap: "14px",
          marginBottom: "24px",
        }}
      >
        {[
          {
            label: "Total Kamera",
            value: cameras.length,
            color: "#2563eb",
          },
          {
            label: "Status ONLINE",
            value: onlineCount,
            color: "#059669",
          },
          {
            label: "Status Lainnya",
            value: offlineCount,
            color: "#d97706",
          },
        ].map((item) => (
          <div key={item.label} style={panelStyle}>
            <p style={{ color: "#64748b", fontSize: "13px" }}>
              {item.label}
            </p>

            <p
              style={{
                fontSize: "30px",
                fontWeight: 800,
                color: item.color,
                marginTop: "8px",
              }}
            >
              {item.value}
            </p>
          </div>
        ))}
      </section>

      {error && (
        <div
          role="alert"
          style={{
            padding: "14px",
            background: "#fee2e2",
            color: "#991b1b",
            borderRadius: "10px",
            marginBottom: "20px",
            overflowWrap: "anywhere",
          }}
        >
          {error}
        </div>
      )}

      {/* CAMERA SELECTOR */}

      <section style={{ ...panelStyle, marginBottom: "24px" }}>
        <label
          htmlFor="camera-selector"
          style={{ display: "block", fontWeight: 700 }}
        >
          Pilih Kamera
        </label>

        <select
          id="camera-selector"
          value={selectedCamera?.public_code ?? ""}
          onChange={(event) => {
            const camera = cameras.find(
              (item) =>
                item.public_code === event.target.value
            );

            setSelectedCamera(camera ?? null);
          }}
          disabled={loading || cameras.length === 0}
          style={{
            ...inputStyle,
            maxWidth: "700px",
          }}
        >
          {loading && (
            <option value="">Memuat kamera...</option>
          )}

          {!loading && cameras.length === 0 && (
            <option value="">Tidak ada kamera</option>
          )}

          {cameras.map((camera) => (
            <option
              key={camera.public_code}
              value={camera.public_code}
            >
              {getCameraDisplayName(camera)} (
              {camera.public_code}) - {camera.source_type}
            </option>
          ))}
        </select>
      </section>

      {/* VIDEO PLAYER */}

      <section style={{ ...panelStyle, marginBottom: "24px" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            flexWrap: "wrap",
            alignItems: "center",
            gap: "12px",
            marginBottom: "16px",
          }}
        >
          <div>
            <h2 style={{ fontSize: "19px", fontWeight: 700 }}>
              {selectedCamera
                ? getCameraDisplayName(selectedCamera)
                : "Pemutar Kamera"}
            </h2>

            <p
              style={{
                fontSize: "13px",
                color: "#64748b",
                marginTop: "4px",
              }}
            >
              {selectedCamera?.public_code ?? "Belum ada kamera dipilih"}
            </p>
          </div>

          <span
            style={{
              background:
                selectedCamera?.status?.toUpperCase() === "ONLINE"
                  ? "#dcfce7"
                  : "#fef3c7",
              color:
                selectedCamera?.status?.toUpperCase() === "ONLINE"
                  ? "#166534"
                  : "#92400e",
              padding: "6px 10px",
              borderRadius: "999px",
              fontSize: "12px",
              fontWeight: 700,
            }}
          >
            {selectedCamera?.status ?? "UNKNOWN"}
          </span>
        </div>

        <div
          style={{
            position: "relative",
            background: "#020617",
            borderRadius: "10px",
            overflow: "hidden",
            aspectRatio: "16 / 9",
          }}
        >
          <video
            ref={videoRef}
            controls
            muted
            playsInline
            style={{
              display: "block",
              width: "100%",
              height: "100%",
              objectFit: "contain",
            }}
          />

          {streamLoading && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "white",
                background: "rgba(2, 6, 23, 0.65)",
                pointerEvents: "none",
              }}
            >
              Menghubungkan ke kamera...
            </div>
          )}

          {!selectedCamera && !loading && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "white",
              }}
            >
              Tidak ada kamera tersedia.
            </div>
          )}
        </div>

        {streamInfo && (
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "18px",
              marginTop: "14px",
              color: "#64748b",
              fontSize: "12px",
            }}
          >
            <span>Stream: {streamInfo.type}</span>
            <span>Path: {streamInfo.path}</span>
          </div>
        )}
      </section>

      {/* CAMERA INFORMATION */}

      {selectedCamera && (
        <section style={{ ...panelStyle, marginBottom: "24px" }}>
          <h2 style={{ fontSize: "19px", fontWeight: 700 }}>
            Informasi Kamera
          </h2>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
              gap: "18px",
              marginTop: "18px",
            }}
          >
            <div>
              <p style={{ color: "#64748b", fontSize: "12px" }}>
                Nama Tampilan
              </p>
              <p style={{ fontWeight: 600, marginTop: "4px" }}>
                {getCameraDisplayName(selectedCamera)}
              </p>
            </div>

            <div>
              <p style={{ color: "#64748b", fontSize: "12px" }}>
                Kode Kamera
              </p>
              <p
                style={{
                  fontWeight: 600,
                  marginTop: "4px",
                  overflowWrap: "anywhere",
                }}
              >
                {selectedCamera.public_code}
              </p>
            </div>

            <div>
              <p style={{ color: "#64748b", fontSize: "12px" }}>
                Sumber
              </p>
              <p style={{ fontWeight: 600, marginTop: "4px" }}>
                {selectedCamera.source_type}
              </p>
            </div>

            <div>
              <p style={{ color: "#64748b", fontSize: "12px" }}>
                Latitude
              </p>
              <p style={{ fontWeight: 600, marginTop: "4px" }}>
                {selectedCamera.latitude ?? "Belum diatur"}
              </p>
            </div>

            <div>
              <p style={{ color: "#64748b", fontSize: "12px" }}>
                Longitude
              </p>
              <p style={{ fontWeight: 600, marginTop: "4px" }}>
                {selectedCamera.longitude ?? "Belum diatur"}
              </p>
            </div>
          </div>
        </section>
      )}

      {/* EDIT CAMERA FORM */}

      {selectedCamera && (
        <section style={panelStyle}>
          <h2 style={{ fontSize: "20px", fontWeight: 800 }}>
            Pengaturan Kamera
          </h2>

          <p
            style={{
              color: "#64748b",
              fontSize: "13px",
              marginTop: "6px",
              marginBottom: "20px",
            }}
          >
            Ubah nama tampilan dan koordinat lokasi. Kode kamera
            dan konfigurasi stream tidak akan diubah.
          </p>

          <form
            onSubmit={saveCamera}
            style={{
              display: "grid",
              gap: "16px",
              maxWidth: "650px",
            }}
          >
            <label style={{ fontSize: "14px", fontWeight: 600 }}>
              Nama Tampilan Kamera
              <input
                value={editName}
                onChange={(event) => setEditName(event.target.value)}
                maxLength={100}
                placeholder="Contoh: CCTV Gerbang Utama"
                style={inputStyle}
              />
            </label>

            <label style={{ fontSize: "14px", fontWeight: 600 }}>
              Latitude
              <input
                type="number"
                step="any"
                min="-90"
                max="90"
                value={editLatitude}
                onChange={(event) =>
                  setEditLatitude(event.target.value)
                }
                placeholder="-7.2756"
                style={inputStyle}
              />
            </label>

            <label style={{ fontSize: "14px", fontWeight: 600 }}>
              Longitude
              <input
                type="number"
                step="any"
                min="-180"
                max="180"
                value={editLongitude}
                onChange={(event) =>
                  setEditLongitude(event.target.value)
                }
                placeholder="112.7945"
                style={inputStyle}
              />
            </label>

            <button
              type="submit"
              disabled={savingCamera}
              style={{
                padding: "12px 18px",
                background: savingCamera ? "#94a3b8" : "#2563eb",
                color: "#ffffff",
                border: 0,
                borderRadius: "8px",
                cursor: savingCamera ? "wait" : "pointer",
                fontWeight: 700,
                fontSize: "14px",
              }}
            >
              {savingCamera
                ? "Menyimpan..."
                : "Simpan Perubahan"}
            </button>

            {saveMessage && (
              <p
                role="status"
                style={{
                  padding: "12px",
                  borderRadius: "8px",
                  background: "#dcfce7",
                  color: "#166534",
                  fontSize: "14px",
                }}
              >
                {saveMessage}
              </p>
            )}

            {saveError && (
              <p
                role="alert"
                style={{
                  padding: "12px",
                  borderRadius: "8px",
                  background: "#fee2e2",
                  color: "#991b1b",
                  fontSize: "14px",
                }}
              >
                {saveError}
              </p>
            )}
          </form>
        </section>
      )}
    </main>
  );
}