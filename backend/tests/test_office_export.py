"""XLSX packaging, formulas, gap semantics, and HTTP integration."""

import copy
import io
import unittest
import zipfile
from unittest.mock import patch
from xml.etree import ElementTree as ET

import mysql.connector
from flask import Flask

from backend.api.office_export import HistoryUnavailable, create_workbook, office_export_bp


NS = {"s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}


def fixture():
    return {
        "status": "success", "period": "daily", "date": "2026-10-17",
        "start_wib": "2026-10-17T00:00:00+07:00",
        "end_wib": "2026-10-18T00:00:00+07:00",
        "generated_at_utc": "2026-10-17T05:00:00Z", "unit": "Wh",
        "data": [
            {"label": "00:00", "start_utc": "2026-10-16T17:00:00Z", "end_utc": "2026-10-16T18:00:00Z", "ac_wh": 100.5, "lamp_wh": 0, "ac_status": "complete", "lamp_status": "complete", "ac_detail": {"meter_used": 4,"meter_expected": 4}, "lamp_detail": {"meter_used": 4,"meter_expected": 4}, "in_progress": False},
            {"label": "01:00", "start_utc": "2026-10-16T18:00:00Z", "end_utc": "2026-10-16T19:00:00Z", "ac_wh": None, "lamp_wh": 10.75, "ac_status": "unavailable", "lamp_status": "partial", "ac_detail": {"meter_used": 0,"meter_expected": 4}, "lamp_detail": {"meter_used": 2,"meter_expected": 4}, "in_progress": True},
        ],
        "totals": {"ac_wh": 100.5,"lamp_wh": 10.75,"ac_available_buckets": 1,"lamp_available_buckets": 2,"bucket_count": 2},
    }


def unpack(report):
    with zipfile.ZipFile(io.BytesIO(create_workbook(report))) as archive:
        return {name: ET.fromstring(archive.read(name)) for name in archive.namelist()}


def cell(sheet, address):
    return sheet.find(f".//s:c[@r='{address}']", NS)


def text(sheet, address):
    node = cell(sheet, address)
    return "".join(node.itertext()) if node is not None else ""


class ExportWorkbookTests(unittest.TestCase):
    def test_package_relationships_styles_and_print_layout(self):
        parts = unpack(fixture())
        self.assertEqual(len(parts), 7)
        workbook = parts["xl/workbook.xml"]
        self.assertEqual([sheet.attrib["name"] for sheet in workbook.find("s:sheets", NS)], ["Ringkasan","Energi"])
        self.assertEqual(len(parts["xl/_rels/workbook.xml.rels"]), 3)
        self.assertEqual(parts["xl/styles.xml"].find("s:numFmts/s:numFmt", NS).attrib["numFmtId"], "164")
        for path in ("xl/worksheets/sheet1.xml", "xl/worksheets/sheet2.xml"):
            sheet = parts[path]
            self.assertIsNotNone(sheet.find("s:dimension", NS))
            self.assertIsNotNone(sheet.find("s:mergeCells", NS))
            setup = sheet.find("s:pageSetup", NS)
            self.assertEqual(setup.attrib["fitToHeight"], "0")
            self.assertEqual(setup.attrib["fitToWidth"], "1")
        detail = parts["xl/worksheets/sheet2.xml"]
        self.assertEqual(detail.find("s:sheetViews/s:sheetView/s:pane", NS).attrib["ySplit"], "7")
        self.assertEqual(detail.find("s:autoFilter", NS).attrib["ref"], "A7:J9")
        self.assertIn("'Energi'!$7:$7", [node.text for node in workbook.find("s:definedNames", NS)])
        self.assertEqual(detail.find("s:pageSetup", NS).attrib["orientation"], "landscape")

    def test_formulas_have_correct_cached_totals_and_counts(self):
        parts = unpack(fixture())
        detail, summary = parts["xl/worksheets/sheet2.xml"], parts["xl/worksheets/sheet1.xml"]
        self.assertEqual(cell(detail, "D11").find("s:v", NS).text, "100.5")
        self.assertEqual(cell(detail, "E11").find("s:v", NS).text, "10.75")
        self.assertEqual(cell(detail, "D11").find("s:f", NS).text, 'IF(COUNT(D8:D9)=0,"Tidak tersedia",SUM(D8:D9))')
        self.assertEqual(cell(summary,"B9").find("s:f", NS).text, "'Energi'!D11")
        self.assertEqual(cell(summary,"B11").find("s:v", NS).text, "111.25")
        self.assertEqual(text(summary, "C9"), "1 dari 2")
        self.assertEqual(text(summary, "D9"), "Sebagian / belum final")
        self.assertEqual(text(summary, "D10"), "Sebagian / belum final")

    def test_zero_is_numeric_missing_is_text_and_current_bucket_flagged(self):
        parts = unpack(fixture())
        sheet = parts["xl/worksheets/sheet2.xml"]
        self.assertEqual(cell(sheet,"E8").find("s:v", NS).text,"0.0")
        self.assertEqual(cell(sheet,"D9").attrib["t"],"inlineStr")
        self.assertEqual(text(sheet,"D9"), "Tidak tersedia")
        self.assertEqual(text(sheet,"F9"), "Tidak tersedia")
        self.assertEqual(text(sheet,"G9"), "Sebagian")
        self.assertIn("sedang berjalan", text(sheet,"J9"))
        self.assertIn("2/4", text(sheet,"I9"))

    def test_all_missing_and_empty_data_do_not_become_zero(self):
        for rows in ([], [{"label":"A","ac_wh":None,"lamp_wh":None}]):
            report = fixture()
            report["data"] = rows
            parts = unpack(report)
            summary = parts["xl/worksheets/sheet1.xml"]
            for address in ("B9","B10","B11"):
                self.assertEqual(cell(summary,address).attrib["t"],"str")
                self.assertEqual(cell(summary,address).find("s:v", NS).text,"Tidak tersedia")
            self.assertEqual(text(summary,"D9"), "Tidak tersedia")

    def test_date_bounds_wib_and_counter_method_are_explicit(self):
        parts = unpack(fixture())
        summary, detail = parts["xl/worksheets/sheet1.xml"], parts["xl/worksheets/sheet2.xml"]
        self.assertIn("17/10/2026 00:00 WIB",text(summary,"A5"))
        self.assertIn("18/10/2026 00:00 WIB",text(summary,"A5"))
        self.assertIn("12:00 WIB",text(summary,"A6"))
        self.assertIn("selisih counter",text(summary,"A16"))
        self.assertEqual(text(detail,"B8"), "17/10/2026 00:00 WIB")
        self.assertIn("Wh",text(detail,"D7"))
        self.assertIn("WIB",text(detail,"B7"))

    def test_inline_strings_prevent_formula_injection_and_xml_is_escaped(self):
        report = fixture()
        report["data"][0]["label"] = '=HYPERLINK("https://evil.invalid", "A&B <sensor>")\x00'
        detail = unpack(report)["xl/worksheets/sheet2.xml"]
        node = cell(detail,"A8")
        self.assertEqual(node.attrib["t"], "inlineStr")
        self.assertIsNone(node.find("s:f", NS))
        self.assertIn("A&B <sensor>",text(detail,"A8"))
        self.assertNotIn("\x00",text(detail,"A8"))

    def test_input_rows_are_chronological_without_mutating_report(self):
        report = fixture()
        report["data"].reverse()
        before = copy.deepcopy(report)
        detail = unpack(report)["xl/worksheets/sheet2.xml"]
        self.assertEqual(text(detail,"A8"),"00:00")
        self.assertEqual(report,before)

    def test_unavailable_reasons_are_readable_and_exclusion_counts_present(self):
        report = fixture()
        report["data"][0].update(ac_wh=None, ac_status="counter_reset", ac_detail={"meter_used":0,"meter_expected":4,"excluded":[{"device_eui":"abc","reason":"counter_reset"}]})
        detail = unpack(report)["xl/worksheets/sheet2.xml"]
        self.assertEqual(text(detail,"F8"), "Reset counter")
        self.assertIn("1 meter reset counter",text(detail,"J8"))


class ExportRouteTests(unittest.TestCase):
    def setUp(self):
        app = Flask(__name__)
        app.register_blueprint(office_export_bp)
        self.client = app.test_client()

    @patch("backend.api.office_export.get_history")
    def test_download_headers_and_query(self, history):
        history.return_value = fixture()
        response = self.client.get("/api/smart-office/export?period=daily&date=2026-10-17")
        self.assertEqual(response.status_code,200)
        history.assert_called_once_with("daily","2026-10-17")
        self.assertEqual(response.mimetype,"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        self.assertIn("attachment;",response.headers["Content-Disposition"])
        self.assertIn("USSC_Smart_Office_daily_2026-10-17.xlsx",response.headers["Content-Disposition"])
        self.assertEqual(response.headers["Cache-Control"],"no-store")
        self.assertTrue(zipfile.is_zipfile(io.BytesIO(response.data)))

    @patch("backend.api.office_export.get_history")
    def test_validation_failure(self,history):
        history.side_effect = ValueError("Periode tidak valid")
        response = self.client.get("/api/smart-office/export?period=oops")
        self.assertEqual(response.status_code,400)
        self.assertEqual(response.json["status"],"error")

    @patch("backend.api.office_export.get_history")
    def test_database_failure(self,history):
        history.side_effect = mysql.connector.Error("private DB error")
        response = self.client.get("/api/smart-office/export")
        self.assertEqual(response.status_code,503)
        self.assertNotIn("private DB",response.get_data(as_text=True))

    @patch("backend.api.office_export.get_history")
    def test_history_storage_failure(self,history):
        history.side_effect = HistoryUnavailable("private DB error")
        response = self.client.get("/api/smart-office/export")
        self.assertEqual(response.status_code,503)
        self.assertNotIn("private DB",response.get_data(as_text=True))


if __name__ == "__main__":
    unittest.main()
