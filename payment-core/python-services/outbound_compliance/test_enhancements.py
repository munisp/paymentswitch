"""Tests for world-class compliance enhancements"""

import unittest
from datetime import datetime, date, timezone

from outbound_compliance.sar_filing import SARFilingService, SARPriority, SARStatus
from outbound_compliance.sanctions_rescreening import (
    SanctionsRescreeningService,
    ListUpdateType,
    BeneficiaryRecord,
    RescreeningStatus,
)
from outbound_compliance.cbn_reporting import CBNReportingService, ReportType, ReportStatus


class TestSARFiling(unittest.TestCase):
    def setUp(self):
        self.service = SARFilingService()

    def test_generate_from_escalation(self):
        sar = self.service.generate_from_escalation(
            transfer_ref="TXN-PAYAPP-005",
            participant_id=1,
            participant_name="PayApp Nigeria Ltd",
            screening_result={
                "score": 0.82,
                "list": "OFAC SDN",
                "matched_entity": "Chen Wei (partial match)",
            },
            transfer_details={
                "amount_ngn": 15_800_000,
                "corridor": "NG-CN",
                "beneficiary_name": "Chen Wei",
                "beneficiary_account": "CN-6621-0042-8891",
                "dest_country": "CN",
                "purpose": "business_payment",
                "status": "manual_review",
                "timestamp": datetime.now(timezone.utc).isoformat(),
            },
        )

        self.assertIsNotNone(sar)
        self.assertEqual(sar.status, SARStatus.DRAFT)
        self.assertEqual(sar.priority, SARPriority.MEDIUM)
        self.assertIn("OFAC", sar.narrative)
        self.assertEqual(len(sar.subjects), 1)
        self.assertEqual(len(sar.transactions), 1)
        self.assertTrue(len(sar.indicators) > 0)

    def test_submit_to_nfiu(self):
        sar = self.service.generate_from_escalation(
            transfer_ref="TXN-001",
            participant_id=1,
            participant_name="PayApp",
            screening_result={"score": 0.95, "list": "OFAC SDN", "matched_entity": "Test"},
            transfer_details={
                "amount_ngn": 50_000_000,
                "corridor": "NG-AE",
                "beneficiary_name": "Test",
                "beneficiary_account": "AE-001",
                "dest_country": "AE",
                "purpose": "personal",
                "status": "blocked",
            },
        )

        result = self.service.submit_to_nfiu(sar.id)
        self.assertTrue(result["success"])
        self.assertIn("nfiu_reference", result)
        self.assertEqual(sar.status, SARStatus.SUBMITTED)

    def test_priority_classification(self):
        # Critical: score >= 0.95
        sar = self.service.generate_from_escalation(
            transfer_ref="CRIT-001",
            participant_id=1,
            participant_name="Test",
            screening_result={"score": 0.96, "list": "OFAC SDN", "matched_entity": "Match"},
            transfer_details={"amount_ngn": 1000, "corridor": "NG-US", "beneficiary_name": "X",
                            "beneficiary_account": "A", "dest_country": "US", "purpose": "p", "status": "b"},
        )
        self.assertEqual(sar.priority, SARPriority.CRITICAL)

    def test_overdue_detection(self):
        sar = self.service.generate_from_escalation(
            transfer_ref="OLD-001",
            participant_id=1,
            participant_name="Test",
            screening_result={"score": 0.80, "list": "CBN", "matched_entity": "M"},
            transfer_details={"amount_ngn": 1000, "corridor": "NG-GH", "beneficiary_name": "X",
                            "beneficiary_account": "A", "dest_country": "GH", "purpose": "p", "status": "b"},
        )
        # Manually set deadline to past
        sar.deadline = datetime(2020, 1, 1)
        overdue = self.service.get_overdue_sars()
        self.assertEqual(len(overdue), 1)


class TestSanctionsRescreening(unittest.TestCase):
    def setUp(self):
        self.service = SanctionsRescreeningService()
        # Add beneficiaries
        self.service.beneficiaries = [
            BeneficiaryRecord(
                id="bene-001",
                name="Kwame Asante",
                account="GH-0012-3456-7890",
                country="GH",
                participant_id=1,
                first_transfer_at=datetime(2025, 1, 1),
                last_transfer_at=datetime(2025, 4, 15),
                total_transfers=12,
                total_amount_ngn=60_000_000,
                last_screening_score=0.10,
            ),
            BeneficiaryRecord(
                id="bene-002",
                name="Chen Wei",
                account="CN-6621-0042-8891",
                country="CN",
                participant_id=1,
                first_transfer_at=datetime(2025, 3, 1),
                last_transfer_at=datetime(2025, 4, 20),
                total_transfers=3,
                total_amount_ngn=45_000_000,
                last_screening_score=0.45,
            ),
        ]

    def test_ingest_list_update(self):
        update = self.service.ingest_list_update(
            "OFAC SDN",
            [{"name": "Chen Wei", "id": "SDN-12345"}],
            ListUpdateType.ADDITION,
        )
        self.assertIsNotNone(update)
        self.assertEqual(update.list_name, "OFAC SDN")
        self.assertEqual(update.entries_affected, 1)

    def test_trigger_rescreening(self):
        update = self.service.ingest_list_update(
            "OFAC SDN",
            [{"name": "Chen Wei"}],
        )
        batch = self.service.trigger_rescreening(update)
        self.assertEqual(batch.status, RescreeningStatus.QUEUED)
        self.assertEqual(batch.total_beneficiaries, 2)

    def test_execute_batch_with_match(self):
        update = self.service.ingest_list_update(
            "OFAC SDN",
            [{"name": "Chen Wei"}],
        )
        batch = self.service.trigger_rescreening(update)
        result = self.service.execute_batch(batch.id, [{"name": "Chen Wei"}])

        self.assertEqual(result.status, RescreeningStatus.COMPLETED)
        self.assertTrue(result.new_matches > 0 or result.screened_count > 0)

    def test_no_duplicate_ingestion(self):
        entries = [{"name": "Test Entity"}]
        update1 = self.service.ingest_list_update("UN", entries)
        update2 = self.service.ingest_list_update("UN", entries)
        self.assertIsNotNone(update1)
        self.assertIsNone(update2)  # Same checksum, no change


class TestCBNReporting(unittest.TestCase):
    def setUp(self):
        self.service = CBNReportingService()

    def test_generate_daily_transaction_report(self):
        transactions = [
            {
                "transfer_ref": "TXN-001",
                "participant_code": "PAYAPP",
                "participant_name": "PayApp Nigeria Ltd",
                "corridor": "NG-GH",
                "amount_ngn": 2_500_000,
                "amount_dest": 5_000,
                "dest_currency": "GHS",
                "fx_rate": 0.002,
                "cbn_spread_bps": 60,
                "beneficiary_country": "GH",
                "purpose_code": "family_support",
                "status": "completed",
                "provider": "Flutterwave",
                "settlement_time_hrs": 1.5,
            },
            {
                "transfer_ref": "TXN-002",
                "participant_code": "PAYAPP",
                "participant_name": "PayApp Nigeria Ltd",
                "corridor": "NG-GB",
                "amount_ngn": 12_000_000,
                "amount_dest": 9500,
                "dest_currency": "GBP",
                "fx_rate": 0.000792,
                "cbn_spread_bps": 80,
                "beneficiary_country": "GB",
                "purpose_code": "education",
                "status": "completed",
                "provider": "Wise",
                "settlement_time_hrs": 0.5,
            },
        ]

        report = self.service.generate_daily_transaction_report(
            date(2025, 5, 1),
            transactions,
        )

        self.assertEqual(report.report_type, ReportType.DAILY_TRANSACTION)
        self.assertEqual(report.row_count, 2)
        self.assertEqual(report.format, "csv")
        self.assertIn("TXN-001", report.content)
        self.assertIn("TXN-002", report.content)

    def test_validate_report(self):
        report = self.service.generate_daily_transaction_report(
            date(2025, 5, 1),
            [{"transfer_ref": "TXN-001", "participant_code": "PAYAPP",
              "participant_name": "PayApp", "corridor": "NG-GH",
              "amount_ngn": 1000, "amount_dest": 2, "dest_currency": "GHS",
              "fx_rate": 0.002, "cbn_spread_bps": 60, "beneficiary_country": "GH",
              "purpose_code": "p", "status": "completed", "provider": "FW",
              "settlement_time_hrs": 1}],
        )

        errors = self.service.validate_report(report.id)
        self.assertEqual(len(errors), 0)
        self.assertEqual(report.status, ReportStatus.VALIDATED)

    def test_submit_report(self):
        report = self.service.generate_daily_transaction_report(
            date(2025, 5, 1),
            [{"transfer_ref": "TXN-001", "participant_code": "PAYAPP",
              "participant_name": "PayApp", "corridor": "NG-GH",
              "amount_ngn": 1000, "amount_dest": 2, "dest_currency": "GHS",
              "fx_rate": 0.002, "cbn_spread_bps": 60, "beneficiary_country": "GH",
              "purpose_code": "p", "status": "completed", "provider": "FW",
              "settlement_time_hrs": 1}],
        )

        self.service.validate_report(report.id)
        result = self.service.submit_report(report.id)
        self.assertTrue(result["success"])
        self.assertIn("cbn_reference", result)

    def test_fx_utilization_report(self):
        corridor_data = [
            {
                "corridor": "NG-GH",
                "total_ngn_volume": 500_000_000,
                "total_dest_volume": 1_000_000,
                "dest_currency": "GHS",
                "avg_rate": 0.002,
                "cbn_rate": 0.00195,
                "spread_bps": 60,
                "spread_cap_bps": 80,
                "transaction_count": 150,
            },
        ]

        report = self.service.generate_fx_utilization_report(date(2025, 5, 1), corridor_data)
        self.assertEqual(report.report_type, ReportType.DAILY_FX_UTILIZATION)
        self.assertIn("NG-GH", report.content)

    def test_compliance_report(self):
        data = {
            "total_screenings": 1500,
            "auto_cleared": 1420,
            "escalated": 65,
            "blocked": 15,
            "sars_filed": 3,
            "avg_screening_time_ms": 12,
            "false_positive_rate": 0.04,
            "lists_updated_count": 14,
            "beneficiaries_rescreened": 890,
            "new_matches_detected": 2,
        }

        report = self.service.generate_monthly_compliance_report(2025, 5, data)
        self.assertEqual(report.report_type, ReportType.MONTHLY_COMPLIANCE)
        self.assertEqual(report.format, "json")


if __name__ == "__main__":
    unittest.main()
