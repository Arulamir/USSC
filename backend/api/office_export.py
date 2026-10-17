"""Portable, dependency-free XLSX energy reports for the Smart Office page."""

import io
import math
import re
import zipfile
from datetime import date, datetime, timedelta, timezone
from xml.etree.ElementTree import Element, SubElement, tostring

import mysql.connector
from flask import Blueprint, current_app, jsonify, request, send_file

from .office_history import HistoryUnavailable, get_history


office_export_bp = Blueprint("office_export", __name__, url_prefix="/api")
NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
WIB = timezone(timedelta(hours=7))
PERIODS = {"daily": "Harian", "weekly": "Mingguan", "monthly": "Bulanan", "yearly": "Tahunan"}
MONTHS = ("Januari", "Februari", "Maret", "April", "Mei", "Juni",
          "Juli", "Agustus", "September", "Oktober", "November", "Desember")
QUALITY = {
    "complete": "Lengkap", "ok": "Lengkap", "partial": "Sebagian",
    "partial_estimated": "Sebagian / estimasi", "estimated": "Estimasi",
    "unavailable": "Tidak tersedia", "missing": "Tidak tersedia",
    "pending": "Belum tersedia", "reset": "Reset counter",
    "future": "Belum waktunya", "counter_reset": "Reset counter",
    "missing_baseline": "Baseline tidak tersedia", "missing_current": "Akhir belum tersedia",
    "conflict": "Counter tidak konsisten",
}


def _xml(value):
    # XML 1.0 forbids control characters even inside escaped text.
    return re.sub(r"[^\x09\x0A\x0D\x20-\uD7FF\uE000-\uFFFD\U00010000-\U0010FFFF]", "", str(value))


def _stamp(value):
    if value is None:
        return "Tidak tersedia"
    try:
        parsed = value if isinstance(value, datetime) else datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(WIB).strftime("%d/%m/%Y %H:%M WIB")
    except (TypeError, ValueError):
        return _xml(value)


def _long_date(value):
    return f"{value.day} {MONTHS[value.month - 1]} {value.year}"


def _selection(report):
    selected = str(report.get("date", ""))
    try:
        chosen = date.fromisoformat(selected)
    except ValueError:
        return selected
    if report.get("period") == "yearly":
        return f"Tahun: {chosen.year}"
    if report.get("period") == "monthly":
        return f"Bulan: {MONTHS[chosen.month - 1]} {chosen.year}"
    return f"{'Tanggal acuan' if report.get('period') == 'weekly' else 'Tanggal'}: {_long_date(chosen)}"


def _interval_label(bucket, period):
    label = str(bucket.get("label", ""))
    try:
        if period == "yearly":
            chosen = date.fromisoformat(label + "-01")
            return f"{MONTHS[chosen.month - 1]} {chosen.year}"
        if period in ("monthly", "weekly"):
            return _long_date(date.fromisoformat(label))
        if period == "daily":
            start = datetime.fromisoformat(str(bucket.get("start_utc", "")).replace("Z", "+00:00"))
            if start.tzinfo is None:
                start = start.replace(tzinfo=timezone.utc)
            return f"{_long_date(start.astimezone(WIB))}, {label}"
    except ValueError:
        pass
    return label


def _filename(report):
    selected = str(report["date"])
    if report["period"] == "monthly":
        selected = selected[:7]
    elif report["period"] == "yearly":
        selected = selected[:4]
    return f"USSC_Smart_Office_{report['period']}_{selected}.xlsx"


def _number(value):
    if value is None or isinstance(value, bool):
        return None
    try:
        number = float(value)
        return number if math.isfinite(number) and number >= 0 else None
    except (TypeError, ValueError, OverflowError):
        return None


def _col(index):
    name = ""
    while index:
        index, digit = divmod(index - 1, 26)
        name = chr(65 + digit) + name
    return name


def _cell(row, column, value, style=0, formula=None):
    cell = SubElement(row, "c", {"r": f"{_col(column)}{row.attrib['r']}", "s": str(style)})
    if formula is not None:
        if not isinstance(value, (int, float)):
            cell.set("t", "str")
        SubElement(cell, "f").text = formula
        SubElement(cell, "v").text = _xml(value)
    elif isinstance(value, (int, float)) and not isinstance(value, bool):
        SubElement(cell, "v").text = str(value)
    else:
        cell.set("t", "inlineStr")
        SubElement(SubElement(cell, "is"), "t", {"xml:space": "preserve"}).text = _xml(value if value is not None else "Tidak tersedia")


def _row(sheet_data, index, values, styles=None, height=25):
    row = SubElement(sheet_data, "row", {"r": str(index), "ht": str(height), "customHeight": "1"})
    for column, value in enumerate(values, 1):
        _cell(row, column, value, styles[column - 1] if styles else 0)
    return row


def _sheet(widths, last_row, freeze=0):
    sheet = Element("worksheet", {"xmlns": NS})
    props = SubElement(sheet, "sheetPr")
    SubElement(props, "pageSetUpPr", {"fitToPage": "1"})
    SubElement(sheet, "dimension", {"ref": f"A1:{_col(len(widths))}{last_row}"})
    view = SubElement(SubElement(sheet, "sheetViews"), "sheetView", {"workbookViewId": "0", "showGridLines": "0"})
    if freeze:
        SubElement(view, "pane", {"ySplit": str(freeze), "topLeftCell": f"A{freeze + 1}", "activePane": "bottomLeft", "state": "frozen"})
        SubElement(view, "selection", {"pane": "bottomLeft", "activeCell": f"A{freeze + 1}", "sqref": f"A{freeze + 1}"})
    SubElement(sheet, "sheetFormatPr", {"defaultRowHeight": "25"})
    columns = SubElement(sheet, "cols")
    for index, width in enumerate(widths, 1):
        SubElement(columns, "col", {"min": str(index), "max": str(index), "width": str(width), "customWidth": "1"})
    return sheet, SubElement(sheet, "sheetData")


def _finish(sheet, merges, print_landscape=False):
    if merges:
        merged = SubElement(sheet, "mergeCells", {"count": str(len(merges))})
        for ref in merges:
            SubElement(merged, "mergeCell", {"ref": ref})
    SubElement(sheet, "pageMargins", {"left": "0.3", "right": "0.3", "top": "0.4", "bottom": "0.4", "header": "0.2", "footer": "0.2"})
    SubElement(sheet, "pageSetup", {"paperSize": "9", "orientation": "landscape" if print_landscape else "portrait", "fitToWidth": "1", "fitToHeight": "0"})
    footer = SubElement(sheet, "headerFooter")
    SubElement(footer, "oddFooter").text = "&LUSSC | Smart Office Monitoring&RHalaman &P dari &N"


def _styles():
    root = Element("styleSheet", {"xmlns": NS})
    formats = SubElement(root, "numFmts", {"count": "1"})
    SubElement(formats, "numFmt", {"numFmtId": "164", "formatCode": '#,##0.00;[Red](#,##0.00);0.00'})
    fonts = SubElement(root, "fonts", {"count": "5"})
    for size, color, bold in [(10, "FF0F172A", False), (22, "FFFFFFFF", True), (11, "FFFFFFFF", True), (10, "FF047857", True), (10, "FF64748B", False)]:
        font = SubElement(fonts, "font")
        SubElement(font, "sz", {"val": str(size)})
        SubElement(font, "color", {"rgb": color})
        SubElement(font, "name", {"val": "Calibri"})
        if bold:
            SubElement(font, "b")
    fills = SubElement(root, "fills", {"count": "6"})
    for pattern, color in [("none", None), ("gray125", None), ("solid", "FF047857"), ("solid", "FFF1F5F9"), ("solid", "FFECFDF5"), ("solid", "FF0F172A")]:
        fill = SubElement(SubElement(fills, "fill"), "patternFill", {"patternType": pattern})
        if color:
            SubElement(fill, "fgColor", {"rgb": color})
            SubElement(fill, "bgColor", {"indexed": "64"})
    borders = SubElement(root, "borders", {"count": "1"})
    border = SubElement(borders, "border")
    for edge in ("left", "right", "top", "bottom", "diagonal"):
        SubElement(border, edge)
    base = SubElement(root, "cellStyleXfs", {"count": "1"})
    SubElement(base, "xf", {"numFmtId": "0", "fontId": "0", "fillId": "0", "borderId": "0"})
    styles = SubElement(root, "cellXfs", {"count": "11"})
    # normal, title, header, numeric, alternating text/numeric, subtotal text/numeric, note, unavailable, navy
    for font, fill, num, horizontal in [(0,0,0,"left"),(1,2,0,"left"),(2,2,0,"left"),(0,0,164,"right"),(0,3,0,"left"),(0,3,164,"right"),(3,4,0,"left"),(3,4,164,"right"),(4,0,0,"left"),(4,0,0,"right"),(2,5,0,"left")]:
        xf = SubElement(styles, "xf", {"numFmtId": str(num), "fontId": str(font), "fillId": str(fill), "borderId": "0", "xfId": "0", "applyAlignment": "1", "applyNumberFormat": "1"})
        SubElement(xf, "alignment", {"horizontal": horizontal, "vertical": "center", "wrapText": "1"})
    named = SubElement(root, "cellStyles", {"count": "1"})
    SubElement(named, "cellStyle", {"name": "Normal", "xfId": "0", "builtinId": "0"})
    return root


def _quality(bucket, kind):
    value = _number(bucket.get(f"{kind}_wh"))
    status = bucket.get(f"{kind}_status", "unavailable")
    quality = QUALITY.get(status, "Sebagian" if value is not None else "Tidak tersedia")
    if value is None and status not in QUALITY:
        quality = "Tidak tersedia"
    return quality


def _exclusions(bucket):
    descriptions = []
    for kind, title in (("ac", "AC"), ("lamp", "Lampu")):
        detail = bucket.get(f"{kind}_detail") or {}
        reasons = {}
        for exclusion in detail.get("excluded", []):
            reason = QUALITY.get(exclusion.get("reason"), "Tidak tersedia")
            reasons[reason] = reasons.get(reason, 0) + 1
        if reasons:
            descriptions.append(f"{title}: " + "; ".join(f"{number} meter {reason.lower()}" for reason, number in sorted(reasons.items())))
    return ". ".join(descriptions)


def _meters(detail):
    if not isinstance(detail, dict):
        return "Tidak tersedia"
    used, expected = detail.get("meter_used"), detail.get("meter_expected")
    return f"{used}/{expected}" if used is not None and expected is not None else "Tidak tersedia"


def _subtotal(rows, kind):
    values = [_number(row.get(f"{kind}_wh")) for row in rows]
    valid = [value for value in values if value is not None]
    return (sum(valid) if valid else "Tidak tersedia"), len(valid)


def create_workbook(report):
    """Return a valid XLSX. Missing intervals remain unavailable, including totals."""
    buckets = sorted(report.get("data") or [], key=lambda item: str(item.get("start_utc") or item.get("label") or ""))
    ac_total, ac_count = _subtotal(buckets, "ac")
    lamp_total, lamp_count = _subtotal(buckets, "lamp")
    count = len(buckets)
    last_data = 7 + max(count, 1)
    total_row = last_data + 2
    detail, data = _sheet([21,25,25,19,19,18,18,13,13,32], total_row + 3, freeze=7)
    _row(data, 1, ["SMART OFFICE MONITORING"] + [""] * 9, [1] * 10, 40)
    period = PERIODS.get(report.get("period"), report.get("period", ""))
    selected = _selection(report)
    _row(data, 2, [f"Laporan energi {period.lower()} | {selected}"] + [""] * 9, [6] * 10, 28)
    bounds = f"Rentang WIB: {_stamp(report.get('start_wib'))} s.d. {_stamp(report.get('end_wib'))} (batas akhir eksklusif)"
    _row(data, 3, [bounds] + [""] * 9, [8] * 10, 29)
    _row(data, 4, [f"Diekspor: {_stamp(report.get('generated_at_utc'))}"] + [""] * 9, [8] * 10)
    _row(data, 5, ["Energi = selisih counter kumulatif tiap meter; dijumlah antar meter dan interval yang tersedia. Bukan penjumlahan nilai counter."] + [""] * 9, [8] * 10, 30)
    _row(data, 7, ["Interval (WIB)", "Mulai (WIB)", "Akhir (WIB), eksklusif", "Energi AC (Wh)", "Energi lampu (Wh)", "Kualitas AC", "Kualitas lampu", "Meter AC", "Meter lampu", "Catatan"], [2] * 10, 36)
    for index, bucket in enumerate(buckets, 8):
        shade, numeric = (4, 5) if index % 2 else (0, 3)
        note = "Interval sedang berjalan; energi belum final." if bucket.get("in_progress") else ""
        if any(_quality(bucket, kind) != "Lengkap" for kind in ("ac", "lamp")):
            note = (note + " Data tidak lengkap; lihat kualitas dan cakupan meter.").strip()
        exclusions = _exclusions(bucket)
        if exclusions:
            note += " " + exclusions
        values = [_interval_label(bucket, report.get("period")), _stamp(bucket.get("start_utc")), _stamp(bucket.get("end_utc")), _number(bucket.get("ac_wh")), _number(bucket.get("lamp_wh")), _quality(bucket, "ac"), _quality(bucket, "lamp"), _meters(bucket.get("ac_detail")), _meters(bucket.get("lamp_detail")), note]
        height = max(42, min(180, 14 * (math.ceil(len(note) / 29) + 1)))
        _row(data, index, values, [shade,shade,shade,numeric,numeric,shade,shade,shade,shade,shade], height)
    if not buckets:
        _row(data, 8, ["Tidak ada data"] + [None] * 8 + ["Tidak ada interval pembacaan yang tersedia."], [8] * 10, 32)
    totals = _row(data, total_row, ["SUBTOTAL TERSEDIA", "", ""], [6] * 3, 30)
    for column, total in [(4, ac_total), (5, lamp_total)]:
        letter = _col(column)
        span = f"{letter}8:{letter}{last_data}"
        _cell(totals, column, total, 7, f'IF(COUNT({span})=0,"Tidak tersedia",SUM({span}))')
    _row(data, total_row + 2, ["Subtotal hanya mencakup data yang tersedia. Nilai 0 adalah pembacaan sah; 'Tidak tersedia' bukan nol. Interval berjalan dan kualitas sebagian bukan konsumsi periode penuh."] + [""] * 9, [8] * 10, 32)
    SubElement(detail, "autoFilter", {"ref": f"A7:J{last_data}"})
    detail_merges = [f"A{r}:J{r}" for r in (1,2,3,4,5,total_row + 2)] + [f"A{total_row}:C{total_row}"]
    _finish(detail, detail_merges, True)

    summary, data = _sheet([28,30,23,42], 23)
    _row(data, 1, ["SMART OFFICE MONITORING", "", "", ""], [1] * 4, 42)
    _row(data, 2, ["USSC | Universitas Negeri Surabaya", "", "", ""], [6] * 4, 27)
    _row(data, 4, [f"Periode: {period} | {selected}", "", "", ""], [0] * 4)
    _row(data, 5, [bounds, "", "", ""], [8] * 4, 34)
    _row(data, 6, [f"Diekspor: {_stamp(report.get('generated_at_utc'))}", "", "", ""], [8] * 4)
    _row(data, 8, ["Kategori", "Subtotal tersedia (Wh)", "Interval tersedia", "Cakupan laporan"], [2] * 4, 30)
    for row_index, title, kind, total, available, column in [(9,"AC","ac",ac_total,ac_count,"D"),(10,"Lampu","lamp",lamp_total,lamp_count,"E")]:
        row = _row(data, row_index, [title], [6], 36)
        _cell(row, 2, total, 7, f"'Energi'!{column}{total_row}")
        _cell(row, 3, f"{available} dari {count}")
        partial = available < count or any(_quality(bucket, kind) != "Lengkap" or bucket.get("in_progress") for bucket in buckets)
        coverage = "Tidak tersedia" if not available else "Sebagian / belum final" if partial else "Data tersedia lengkap"
        _cell(row, 4, coverage)
    valid_totals = [value for value in (ac_total, lamp_total) if isinstance(value, (int,float))]
    row = _row(data, 11, ["Gabungan tersedia"], [6], 30)
    _cell(row, 2, sum(valid_totals) if valid_totals else "Tidak tersedia", 7, 'IF(COUNT(B9:B10)=0,"Tidak tersedia",SUM(B9:B10))')
    _cell(row, 4, "Subtotal AC + lampu yang tersedia; cek cakupan masing-masing.", 8)
    notes = [
        (14, "CARA MEMBACA LAPORAN", 10),
        (15, "Satuan Wh menyatakan energi. Daya sesaat dalam W berbeda dan tidak dijumlahkan antar waktu menjadi Wh.", 8),
        (16, "Energi dihitung dari selisih counter kumulatif per meter dalam batas waktu WIB, kemudian dijumlahkan untuk AC dan lampu.", 8),
        (17, "Nilai 0 adalah hasil pembacaan sah. 'Tidak tersedia' menandai data hilang, tidak valid, atau tidak cukup untuk menghitung energi.", 8),
        (18, "Subtotal tersedia dapat lebih kecil dari konsumsi sebenarnya jika interval atau meter belum lengkap. Lihat sheet Energi sebelum memakai hasil untuk pelaporan.", 8),
        (19, "Periode harian berisi interval jam; mingguan dan bulanan berisi tanggal; tahunan berisi bulan. Batas akhir setiap interval bersifat eksklusif.", 8),
        (20, "Interval sedang berjalan belum final. Estimasi batas waktu ditandai pada kualitas; gap yang tidak memenuhi syarat dibiarkan tidak tersedia.", 8),
        (22, "Sumber: snapshot telemetri office1 / device_samples. Seluruh waktu ditampilkan dalam WIB (UTC+07:00).", 8),
    ]
    for index, text, style in notes:
        _row(data, index, [text,"","",""], [style] * 4, 30 if index == 14 else 38)
    _finish(summary, [f"A{r}:D{r}" for r in (1,2,4,5,6,14,15,16,17,18,19,20,22)])

    workbook = Element("workbook", {"xmlns": NS, "xmlns:r": REL})
    sheets = SubElement(workbook, "sheets")
    for index, name in enumerate(("Ringkasan", "Energi"), 1):
        SubElement(sheets, "sheet", {"name": name, "sheetId": str(index), "r:id": f"rId{index}"})
    names = SubElement(workbook, "definedNames")
    SubElement(names, "definedName", {"name": "_xlnm.Print_Titles", "localSheetId": "1"}).text = "'Energi'!$7:$7"
    SubElement(names, "definedName", {"name": "_xlnm.Print_Area", "localSheetId": "0"}).text = "'Ringkasan'!$A$1:$D$23"
    SubElement(names, "definedName", {"name": "_xlnm.Print_Area", "localSheetId": "1"}).text = f"'Energi'!$A$1:$J${total_row + 3}"
    SubElement(workbook, "calcPr", {"calcId": "191029", "fullCalcOnLoad": "1"})
    rels = Element("Relationships", {"xmlns": "http://schemas.openxmlformats.org/package/2006/relationships"})
    for index, kind, target in [(1,"worksheet","worksheets/sheet1.xml"),(2,"worksheet","worksheets/sheet2.xml"),(3,"styles","styles.xml")]:
        SubElement(rels, "Relationship", {"Id": f"rId{index}", "Type": f"{REL}/{kind}", "Target": target})
    root_rels = Element("Relationships", {"xmlns": "http://schemas.openxmlformats.org/package/2006/relationships"})
    SubElement(root_rels, "Relationship", {"Id": "rId1", "Type": f"{REL}/officeDocument", "Target": "xl/workbook.xml"})
    content = Element("Types", {"xmlns": "http://schemas.openxmlformats.org/package/2006/content-types"})
    for extension, content_type in [("rels","application/vnd.openxmlformats-package.relationships+xml"),("xml","application/xml")]:
        SubElement(content, "Default", {"Extension": extension, "ContentType": content_type})
    for path, kind in [("workbook.xml","sheet"),("styles.xml","styles"),("worksheets/sheet1.xml","worksheet"),("worksheets/sheet2.xml","worksheet")]:
        SubElement(content, "Override", {"PartName": f"/xl/{path}", "ContentType": f"application/vnd.openxmlformats-officedocument.spreadsheetml.{kind}+xml" if kind != "sheet" else "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"})
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        for path, node in [("[Content_Types].xml",content),("_rels/.rels",root_rels),("xl/workbook.xml",workbook),("xl/_rels/workbook.xml.rels",rels),("xl/styles.xml",_styles()),("xl/worksheets/sheet1.xml",summary),("xl/worksheets/sheet2.xml",detail)]:
            archive.writestr(path, tostring(node, encoding="utf-8", xml_declaration=True))
    return output.getvalue()


@office_export_bp.get("/smart-office/export")
def export_smart_office():
    try:
        report = get_history(request.args.get("period", "daily"), request.args.get("date"))
    except ValueError as error:
        return jsonify({"status": "error", "message": str(error)}), 400
    except (HistoryUnavailable, mysql.connector.Error):
        current_app.logger.exception("Smart Office report database unavailable")
        return jsonify({"status": "error", "message": "Data Smart Office belum dapat diakses."}), 503
    filename = _filename(report)
    response = send_file(io.BytesIO(create_workbook(report)), mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", as_attachment=True, download_name=filename, max_age=0)
    response.headers["Cache-Control"] = "no-store"
    return response
