# Digital Twin CCTV playback

The player keeps WebRTC for low latency and switches to same-origin HLS when
negotiation fails, no video arrives within 12 seconds, or the connection fails.
Streamless WebRTC video tracks are attached explicitly. Browsers with MSE/MMS
use hls.js; browsers without it can use native HLS. Muted inline playback,
an explicit play button for autoplay restrictions, and a retry button replace
silent black-screen failures. A LIVE indicator appears only after playback.

Only `lidah_h264` and `ketintang_h264` are exposed through the public HLS proxy.
They are H.264 Constrained Baseline, 720p, without B-frames. Viewer credentials
remain in the existing camera backend environment and are never sent to the
browser. MediaMTX HLS sessions use playlist query parameters in cookieless mode;
all playlist and segment requests must preserve those parameters. Requests
cannot select another host, private stream, arbitrary file, or redirect target.

Routes:

- Browser: `/api/cctv/hls/<stream>/index.m3u8`.
- Next.js proxies to the camera backend `/hls/<stream>/<asset>` on port 5003.
- The main Flask backend also routes the public camera list, the two WHEP
  streams, and the two HLS streams when Nginx sends `/api/` to port 5000.
- Camera backend authenticates to MediaMTX HLS on localhost:8888.

The existing Digital Twin page also depends on its local PhotoViewer,
GaussianSplatViewer, Leaflet rotation types, and related package dependencies.
These accompany the current page in Git so this playback change can be built
without reverting that existing viewer work. The server's Google-session helper
already exists; the Git version includes the minimal server-role lookup needed
by the current page without replacing its existing login flow.

Validation includes public-path restrictions, upstream auth, query and Range
forwarding, bounded response size, sanitized failures, and browser playback of
both real streams with failed/unavailable/stalled WebRTC and retry recovery.
Android viewport emulation does not replace testing on a physical Android or
iPhone device; Linux WebKit likewise is not the Safari media stack on iOS.
