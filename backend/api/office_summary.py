"""Monthly energy/emissions facts, with a short server-side Qwen narrative."""

from collections import OrderedDict
from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
import json
import re
from threading import Lock
from time import monotonic

import requests
from flask import Blueprint, current_app, jsonify, request

from .office_export import MONTHS
from .office_history import HistoryUnavailable, WIB, get_history

office_summary_bp = Blueprint("office_summary", __name__, url_prefix="/api")
FACTOR = Decimal("0.87")  # tCO2/MWh, numerically equal to kgCO2/kWh.
FACTOR_SOURCE = "https://gatrik.esdm.go.id/gatrik/gatrik-api/storage/migrasi/download_index/files/96d7c-nilai-fe-grk-sistem-ketenagalistrikan-tahun-2019.pdf"
CACHE_SECONDS = 1800
_cache = OrderedDict()
_lock = Lock()
_next_generation = 0.0


def _rounded(value, places="0.001"):
    return float(value.quantize(Decimal(places), rounding=ROUND_HALF_UP))


def monthly_facts(report):
    """Sum distinct-counter energy buckets, never repeated daily snapshots."""
    totals = report["totals"]
    energies = {name: None if totals[name + "_wh"] is None else
                Decimal(str(totals[name + "_wh"])) / 1000 for name in ("ac", "lamp")}
    available = [value for value in energies.values() if value is not None]
    total = sum(available, Decimal(0)) if available else None
    month = report["date"][:7]
    non_future = [row for row in report["data"]
                  if row["ac_status"] != "future" or row["lamp_status"] != "future"]
    partial = any(totals[name + "_status"] in ("partial", "partial_estimated", "unavailable")
                  for name in energies)
    return {
        "month": month, "month_label": f"{MONTHS[int(month[5:7]) - 1]} {month[:4]}",
        "ac_kwh": None if energies["ac"] is None else _rounded(energies["ac"]),
        "lamp_kwh": None if energies["lamp"] is None else _rounded(energies["lamp"]),
        "total_kwh": None if total is None else _rounded(total),
        "emissions_kg_co2": None if total is None else _rounded(total * FACTOR),
        "emissions_t_co2": None if total is None else _rounded(total * FACTOR / 1000, "0.000001"),
        "partial": partial, "in_progress": any(row["in_progress"] for row in report["data"]),
        "estimated": any("estimated" in totals[name + "_status"] for name in energies),
        "days_with_ac": totals["ac_available_buckets"],
        "days_with_lamp": totals["lamp_available_buckets"], "elapsed_days": len(non_future),
        "factor": {"grid": "Jamali", "value": float(FACTOR), "unit": "tCO₂/MWh",
                   "reference_year": 2019, "source_url": FACTOR_SOURCE},
        "data_generated_at_utc": report["generated_at_utc"],
    }


def _format(value):
    return f"{value:,.3f}".replace(",", "_").replace(".", ",").replace("_", ".")


def coverage_sentence(facts):
    notes = []
    if facts["in_progress"]:
        notes.append("bulan masih berjalan")
    if facts["partial"]:
        notes.append("sebagian data meter atau hari belum tersedia sehingga nilainya merupakan subtotal")
    if facts["estimated"]:
        notes.append("sebagian batas pembacaan energi menggunakan interpolasi")
    return ("Catatan: " + "; ".join(notes) + ".") if notes else "Perhitungan mengikuti data meter yang tersedia untuk bulan tersebut."


def fallback_summary(facts):
    if facts["total_kwh"] is None:
        return "Data energi untuk bulan ini belum tersedia; total konsumsi dan estimasi emisi belum dapat dihitung."
    return (f"Konsumsi energi AC dan lampu yang tercatat pada {facts['month_label']} adalah "
            f"{_format(facts['total_kwh'])} kWh. Estimasi emisi konsumsi listrik AC dan lampu sebesar "
            f"{_format(facts['emissions_kg_co2'])} kg CO₂ menggunakan faktor referensi "
            "0,87 tCO₂/MWh tahun 2019. " + coverage_sentence(facts))


def qwen_summary(facts, key, model):
    # Only aggregate monthly facts leave the server; no keys, raw rows, device IDs,
    # operator identities, reference prose, or worked examples enter the prompt.
    payload = {name: facts[name] for name in ("month_label", "ac_kwh", "lamp_kwh", "total_kwh",
               "emissions_kg_co2", "partial", "in_progress")}
    prompt = (
        "Tulis ringkasan Smart Office dalam bahasa Indonesia, tepat 3 kalimat singkat, maksimal 100 kata. "
        "Kembalikan JSON dengan satu properti sentences berupa array 3 string, masing-masing satu kalimat. "
        "Kalimat pertama menjelaskan total konsumsi energi bulanan AC dan lampu dalam kWh. "
        "Kalimat kedua menjelaskan estimasi emisi CO₂ dari konsumsi listrik AC dan lampu dalam kg CO₂; "
        "gunakan istilah emisi konsumsi listrik, bukan emisi jaringan listrik. "
        "Kalimat ketiga memberi saran penghematan umum yang relevan tanpa mengarang kondisi ruangan. "
        "Gunakan hanya angka yang sudah dihitung pada data, jangan menghitung ulang, membulatkan ke nol, "
        "memproyeksikan sebulan penuh, membandingkan dengan bulan lain, atau menyatakan pengurangan emisi. "
        "Jika partial=true sebut subtotal; jika in_progress=true sebut bulan berjalan. "
        "Nilai null berarti belum tersedia, bukan nol. Gunakan koma sebagai desimal, tanpa markdown, "
        "judul, penomoran, atau penjelasan proses berpikir. Data agregat: " + json.dumps(payload)
    )
    with requests.Session() as session:
        session.trust_env = False
        response = session.post("https://api.groq.com/openai/v1/chat/completions",
            headers={"Authorization": "Bearer " + key}, json={
                "model": model, "messages": [{"role": "user", "content": prompt}],
                "reasoning_effort": "none", "reasoning_format": "hidden",
                "temperature": 0.5, "max_completion_tokens": 500,
                "response_format": {"type": "json_object"}},
            timeout=(4, 18), allow_redirects=False)
        if response.status_code != 200 or len(response.content) > 32768:
            raise ValueError("Summary provider unavailable")
        body = response.json()
        choice = body["choices"][0]
        if choice.get("finish_reason") != "stop":
            raise ValueError("Incomplete summary")
        sentences = json.loads(choice["message"]["content"])["sentences"]
        if (not isinstance(sentences, list) or len(sentences) != 3
                or any(not isinstance(s, str) or not s.strip() or len(s) > 600
                       or "<" in s or ">" in s for s in sentences)
                or len(" ".join(sentences).split()) > 120):
            raise ValueError("Invalid summary")
        return " ".join(s.strip() for s in sentences) + " " + coverage_sentence(facts)


@office_summary_bp.route("/smart-office/summary", methods=["GET"])
def summary_route():
    global _next_generation
    now = datetime.now(timezone.utc)
    month = request.args.get("month", now.astimezone(WIB).strftime("%Y-%m"))
    if (not re.fullmatch(r"[0-9]{4}-(0[1-9]|1[0-2])", month)
            or month < "1970-01" or month > now.astimezone(WIB).strftime("%Y-%m")):
        return jsonify(status="error", message="Pilih bulan yang valid hingga bulan berjalan."), 400
    model = current_app.config.get("GROQ_SUMMARY_MODEL", "qwen/qwen3.8-27b")
    cache_key = (month, model)
    # Bound provider usage globally, not by IP, and coalesce concurrent requests.
    if not _lock.acquire(blocking=False):
        return jsonify(status="error", message="Ringkasan sedang disiapkan. Coba lagi sebentar."), 503
    try:
        cached = _cache.get(cache_key)
        tick = monotonic()
        if cached and tick < cached[0]:
            response = jsonify(**cached[1], cached=True)
        elif tick < _next_generation:
            if cached:
                response = jsonify(**{**cached[1], "stale": True}, cached=True)
            else:
                return jsonify(status="error", message="Tunggu sebentar sebelum memilih bulan lainnya."), 429, {"Retry-After": "30"}
        else:
            _next_generation = tick + 30
            try:
                facts = monthly_facts(get_history("monthly", month + "-01", now))
            except HistoryUnavailable:
                if cached:
                    return jsonify(**{**cached[1], "stale": True}, cached=True)
                return jsonify(status="error", message="Data energi bulanan belum dapat dibaca."), 503
            text = fallback_summary(facts)
            mode = "no_data" if facts["total_kwh"] is None else "calculated"
            key = current_app.config.get("GROQ_API_KEY", "")
            if key and facts["total_kwh"] is not None:
                try:
                    text = qwen_summary(facts, key, model)
                    mode = "qwen"
                except (requests.RequestException, ValueError, KeyError, TypeError, IndexError):
                    current_app.logger.warning("Smart Office AI summary unavailable; calculated facts retained")
            result = {"status": "success", "facts": facts, "summary": text, "mode": mode,
                      "model": model if mode == "qwen" else None, "stale": False,
                      "generated_at_utc": datetime.now(timezone.utc).isoformat()}
            ttl = CACHE_SECONDS if mode in ("qwen", "no_data") else 300
            _cache[cache_key] = (monotonic() + ttl, result)
            _cache.move_to_end(cache_key)
            while len(_cache) > 36:
                _cache.popitem(last=False)
            response = jsonify(**result, cached=False)
        response.headers["Cache-Control"] = "no-store"
        return response
    finally:
        _lock.release()
