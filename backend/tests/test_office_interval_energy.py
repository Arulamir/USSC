import unittest
from datetime import timedelta
from flask import Flask

from backend.api.smart_office import AC_METERS, minute_power_data
from backend.tests.test_office_minute_power import NOW, packet


def energy_packet(offsets=(-1200, -600, 0), values=(1000, 1100, 1110)):
    data = packet()
    for record in data['records']:
        record['power_w'] = 2
        if record['device_eui'] in AC_METERS:
            record['energy_points'] = [
                {'at': (NOW + timedelta(seconds=offset)).isoformat(), 'wh': value}
                for offset, value in zip(offsets, values)
            ]
    return data


class IntervalEnergyTests(unittest.TestCase):
    def setUp(self):
        context = Flask(__name__).app_context()
        context.push()
        self.addCleanup(context.pop)

    def test_only_latest_ten_minute_not_counter_or_earlier_usage_or_active_power(self):
        data = minute_power_data(energy_packet(), NOW)
        self.assertEqual(data['ac_interval_wh'], 40)  # 4 x (1110 - 1100)
        self.assertEqual(data['ac_power_w'], 8)
        self.assertEqual(data['lamp_power_w'], 8)
        self.assertEqual(data['ac_interval_start_utc'], '2026-10-17T05:50:00.000Z')
        self.assertFalse(data['ac_interval_quality']['estimated'])

    def test_real_zero_valid_but_missing_is_not_zero(self):
        self.assertEqual(minute_power_data(energy_packet(values=(0, 0, 0)), NOW)['ac_interval_wh'], 0)
        self.assertIsNone(minute_power_data(packet(), NOW)['ac_interval_wh'])

    def test_old_future_and_republished_counters_do_not_renew_age(self):
        payload = energy_packet(offsets=(-2400, -1800, -1200))
        self.assertIsNone(minute_power_data(payload, NOW)['ac_interval_wh'])
        for record in payload['records']:
            if record['device_eui'] in AC_METERS:
                record['energy_points'][-1]['at'] = (NOW + timedelta(seconds=1)).isoformat()
        self.assertIsNone(minute_power_data(payload, NOW)['ac_interval_wh'])

    def test_twenty_minute_reports_keep_actual_delta_and_duration(self):
        data = minute_power_data(energy_packet(offsets=(-2400, -1200, 0)), NOW)
        self.assertEqual(data['ac_interval_wh'], 40)
        self.assertEqual(data['ac_interval_minutes'], 20)

    def test_user_report_1199_seconds_and_zero_wh_is_valid(self):
        payload = packet()
        record = next(r for r in payload['records'] if r['device_eui'] == '24E12414806031FC')
        record['energy_points'] = [
            {'at': (NOW - timedelta(seconds=1199.767)).isoformat(), 'wh': 222525},
            {'at': NOW.isoformat(), 'wh': 222525},
        ]
        data = minute_power_data(payload, NOW)
        self.assertEqual(data['ac_interval_wh'], 0)
        self.assertEqual(data['ac_interval_minutes'], 20)
        self.assertEqual(data['ac_interval_quality']['meter_used'], 1)
        self.assertFalse(data['ac_interval_stale'])

    def test_twenty_minute_value_survives_until_next_expected_report(self):
        payload = energy_packet(offsets=(-3600, -2400, -1200))
        data = minute_power_data(payload, NOW)
        self.assertEqual(data['ac_interval_wh'], 40)
        self.assertEqual(data['ac_interval_end_utc'], '2026-10-17T05:40:00.000Z')
        self.assertIsNone(minute_power_data(energy_packet(offsets=(-3960, -2760, -1560)), NOW)['ac_interval_wh'])

    def test_mixed_ten_and_twenty_minute_values_are_never_summed_together(self):
        payload = energy_packet()
        ac = [r for r in payload['records'] if r['device_eui'] in AC_METERS]
        ac[0]['energy_points'] = [
            {'at': (NOW - timedelta(minutes=20)).isoformat(), 'wh': 1000},
            {'at': NOW.isoformat(), 'wh': 1999},
        ]
        data = minute_power_data(payload, NOW)
        self.assertEqual(data['ac_interval_wh'], 30)
        self.assertEqual(data['ac_interval_minutes'], 10)
        self.assertEqual(data['ac_interval_quality']['meter_used'], 3)

    def test_thirty_minute_gap_is_not_claimed_as_ten_or_twenty(self):
        self.assertIsNone(minute_power_data(energy_packet(offsets=(-3600, -1800, 0)), NOW)['ac_interval_wh'])

    def test_retained_old_packet_cannot_become_fresh_minute_wh(self):
        payload = energy_packet(offsets=(-1500, -900, -300))
        payload['sampled_at_utc'] = (NOW - timedelta(seconds=151)).isoformat()
        for record in payload['records']:
            record['power_w_at'] = payload['sampled_at_utc']
            if record['device_eui'] in AC_METERS:
                record['energy_points'][-1]['at'] = payload['sampled_at_utc']
        data = minute_power_data(payload, NOW)
        self.assertEqual(data['lamp_power_w'], 8)
        self.assertTrue(data['power_previous'])
        self.assertIsNone(data['ac_interval_wh'])

    def test_reset_needs_new_full_minute(self):
        payload = energy_packet(values=(1000, 1100, 5))
        self.assertIsNone(minute_power_data(payload, NOW)['ac_interval_wh'])
        self.assertEqual(minute_power_data(energy_packet(values=(1100, 5, 15)), NOW)['ac_interval_wh'], 40)

    def test_independent_actual_intervals_without_interpolation(self):
        payload = energy_packet()
        ac = [r for r in payload['records'] if r['device_eui'] in AC_METERS]
        ac[0]['energy_points'] = [
            {'at': (NOW + timedelta(seconds=s)).isoformat(), 'wh': w}
            for s, w in [(-1220, 0), (-620, 6), (-20, 12)]
        ]
        data = minute_power_data(payload, NOW)
        self.assertEqual(data['ac_interval_wh'], 36)  # 3 x 10 + 6
        self.assertEqual(data['ac_interval_end_utc'], '2026-10-17T05:59:40.000Z')
        self.assertFalse(data['ac_interval_quality']['estimated'])

    def test_between_reports_value_is_kept_with_original_timestamp(self):
        payload = energy_packet(offsets=(-1790, -1190, -590))
        data = minute_power_data(payload, NOW)
        self.assertEqual(data['ac_interval_wh'], 40)
        self.assertEqual(data['ac_interval_end_utc'], '2026-10-17T05:50:10.000Z')

    def test_old_ac_watts_do_not_make_fresh_lamp_readings_previous(self):
        payload = energy_packet()
        for record in payload['records']:
            if record['device_eui'] in AC_METERS:
                record['power_w_at'] = (NOW - timedelta(minutes=10)).isoformat()
        data = minute_power_data(payload, NOW)
        self.assertEqual(data['ac_interval_wh'], 40)
        self.assertTrue(data['power_previous'])
        self.assertFalse(data['lamp_power_previous'])

    def test_actual_counter_delta_not_divided_by_ten_despite_timing_jitter(self):
        data = minute_power_data(energy_packet(offsets=(-1200, -605, -3)), NOW)
        self.assertEqual(data['ac_interval_wh'], 40)
        self.assertTrue(all(i['duration_seconds'] == 602 for i in data['ac_interval_quality']['intervals']))
        self.assertFalse(data['ac_interval_quality']['estimated'])

    def test_one_minute_reports_not_claimed_as_ten_minute_actual_pair(self):
        self.assertIsNone(minute_power_data(energy_packet(offsets=(-120, -60, 0)), NOW)['ac_interval_wh'])

    def test_partial_duplicate_and_conflicting_meter_excluded(self):
        payload = energy_packet()
        ac = [r for r in payload['records'] if r['device_eui'] in AC_METERS]
        ac[0]['energy_points'].append({**ac[0]['energy_points'][-1], 'wh': 9999})
        ac[1]['energy_points'] = []
        data = minute_power_data(payload, NOW)
        self.assertEqual(data['ac_interval_wh'], 20)
        self.assertEqual(data['ac_interval_quality']['meter_used'], 2)
        ac[0]['device_eui'] = ac[2]['device_eui']
        self.assertEqual(minute_power_data(payload, NOW)['ac_interval_wh'], 10)

    def test_invalid_unbounded_and_boolean_values_unavailable(self):
        for points in ([{'at': NOW.isoformat(), 'wh': True}] * 2,
                       [{'at': NOW.isoformat(), 'wh': 1}] * 17,
                       [None, None], [{'at': 'bad', 'wh': 1}] * 2):
            with self.subTest(points=points):
                payload = energy_packet()
                for r in payload['records']:
                    r['energy_points'] = points
                self.assertIsNone(minute_power_data(payload, NOW)['ac_interval_wh'])


if __name__ == '__main__':
    unittest.main()
